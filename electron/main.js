const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const https = require("https");
const fs = require("fs");
const crypto = require("crypto");
const { execFile, spawn } = require("child_process");
const { google } = require("googleapis");
const oauth = require("./oauth");

let pollingTimer = null;
let lastCategory = null;
let lastTitle = null;
let pollingStartTime = null;

function extractChannelId(url) {
  const match = url.match(/chzzk\.naver\.com\/(?:live\/)?([a-f0-9]{32})/);
  return match ? match[1] : null;
}

/* ──────────────────────────────────────────────
 * AI provider 공통 HTTPS 헬퍼
 * ──────────────────────────────────────────────
 */
function httpsRequest(urlString, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const reqOptions = {
      method: options.method || "GET",
      hostname: u.hostname,
      path: u.pathname + (u.search || ""),
      port: u.port || 443,
      headers: options.headers || {}
    };
    const req = https.request(reqOptions, (res) => {
      let chunks = "";
      res.on("data", (c) => { chunks += c; });
      res.on("end", () => {
        resolve({ status: res.statusCode, headers: res.headers, body: chunks });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/* ── Provider별 모델 목록 ── */

async function listOpenAIModels(apiKey) {
  const r = await httpsRequest("https://api.openai.com/v1/models", {
    method: "GET",
    headers: { "Authorization": `Bearer ${apiKey}` }
  });
  if (r.status !== 200) throw new Error(`OpenAI ${r.status}: ${r.body.slice(0, 300)}`);
  const data = JSON.parse(r.body);
  const list = (data.data || [])
    .filter((m) => /^(gpt|o\d|chatgpt)/i.test(m.id) && !/embedding|tts|whisper|audio|image|moderation|dall|realtime/i.test(m.id))
    .sort((a, b) => (b.created || 0) - (a.created || 0));
  return list.map((m) => ({ id: m.id, label: m.id, created: m.created || null }));
}

async function listAnthropicModels(apiKey) {
  const r = await httpsRequest("https://api.anthropic.com/v1/models?limit=50", {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    }
  });
  if (r.status !== 200) throw new Error(`Anthropic ${r.status}: ${r.body.slice(0, 300)}`);
  const data = JSON.parse(r.body);
  const list = (data.data || [])
    .filter((m) => typeof m.id === "string")
    .sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0;
      const tb = b.created_at ? Date.parse(b.created_at) : 0;
      return tb - ta;
    });
  return list.map((m) => ({
    id: m.id,
    label: m.display_name || m.id,
    created: m.created_at || null
  }));
}

async function listGoogleModels(apiKey) {
  const r = await httpsRequest(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`,
    { method: "GET" }
  );
  if (r.status !== 200) throw new Error(`Google ${r.status}: ${r.body.slice(0, 300)}`);
  const data = JSON.parse(r.body);
  const list = (data.models || [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .filter((m) => /gemini/i.test(m.name || ""))
    .filter((m) => !/embedding|aqa|tuning/i.test(m.name || ""));
  // version 또는 name 기준 내림차순 (예: gemini-2.5-pro > gemini-2.0-flash)
  list.sort((a, b) => (b.name || "").localeCompare(a.name || "", undefined, { numeric: true }));
  return list.map((m) => ({
    id: (m.name || "").replace(/^models\//, ""),
    label: m.displayName || (m.name || "").replace(/^models\//, ""),
    created: m.version || null
  }));
}

/* ── Provider별 chat completion ── */

async function callOpenAI(apiKey, model, prompt, log) {
  log(`[AI:openai] POST /v1/chat/completions model=${model}`);
  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: "당신은 CSV 데이터 매핑 분석가다. 출력은 반드시 JSON 객체 하나만." },
      { role: "user", content: prompt }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1
  });
  const r = await httpsRequest("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  }, body);
  log(`[AI:openai] HTTP ${r.status} body=${r.body.length} bytes`);
  if (r.status !== 200) throw new Error(`OpenAI HTTP ${r.status}: ${r.body.slice(0, 500)}`);
  const data = JSON.parse(r.body);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI 응답에 message.content 없음");
  log(`[AI:openai] usage prompt=${data?.usage?.prompt_tokens || "?"} completion=${data?.usage?.completion_tokens || "?"}`);
  return content;
}

async function callAnthropic(apiKey, model, prompt, log) {
  log(`[AI:anthropic] POST /v1/messages model=${model}`);
  const body = JSON.stringify({
    model,
    max_tokens: 4000,
    system: "당신은 CSV 데이터 매핑 분석가다. 출력은 JSON 객체 하나만 (코드블록 금지).",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1
  });
  const r = await httpsRequest("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    }
  }, body);
  log(`[AI:anthropic] HTTP ${r.status} body=${r.body.length} bytes`);
  if (r.status !== 200) throw new Error(`Anthropic HTTP ${r.status}: ${r.body.slice(0, 500)}`);
  const data = JSON.parse(r.body);
  const block = (data?.content || []).find((b) => b.type === "text");
  if (!block) throw new Error("Anthropic 응답에 text block 없음");
  log(`[AI:anthropic] usage in=${data?.usage?.input_tokens || "?"} out=${data?.usage?.output_tokens || "?"}`);
  return block.text;
}

async function callGemini(apiKey, model, prompt, log) {
  log(`[AI:google] POST /v1beta/models/${model}:generateContent`);
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json"
    }
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await httpsRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, body);
  log(`[AI:google] HTTP ${r.status} body=${r.body.length} bytes`);
  if (r.status !== 200) throw new Error(`Google HTTP ${r.status}: ${r.body.slice(0, 500)}`);
  const data = JSON.parse(r.body);
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text) throw new Error("Google 응답에 candidates[0].content.parts.text 없음");
  log(`[AI:google] usage in=${data?.usageMetadata?.promptTokenCount || "?"} out=${data?.usageMetadata?.candidatesTokenCount || "?"}`);
  return text;
}

function buildAnalyzePrompt(csvHeader, csvSample, ourSchema) {
  const schemaText = (ourSchema && ourSchema.length)
    ? ourSchema.map((c) => `  - ${c.key} (${c.type})${c.options ? " options=" + c.options.join("/") : ""}: ${c.label}`).join("\n")
    : "  - upload (status: 완 or empty)\n  - broadcastDate (date YYYY-MM-DD)\n  - videoTitle (text)\n  - videoCategory (multi-tag, | separator)\n  - assignee (text, role-based)\n  - editType (preset)\n  - subtitle (preset)\n  - workStartDate (date)\n  - workStatus (status: Wait/Wip/Done/Publish/Retake/Omit)\n  - workEndDate (date)\n  - originalShare (url)\n  - deliveryShare (url)";

  const sampleText = csvSample.map((row, i) => {
    const obj = {};
    csvHeader.forEach((h, idx) => { obj[h] = row[idx] ?? ""; });
    return `행 ${i + 1}: ${JSON.stringify(obj, null, 0)}`;
  }).join("\n");

  return `# 작업
외부 협업 툴(예: Monday.com)의 CSV를 우리 시트 컬럼 형식으로 자동 변환하기 위한 매핑 JSON을 생성하라.

# 우리 컬럼 스키마
${schemaText}

# CSV 헤더 (${csvHeader.length}개)
${csvHeader.map((h, i) => `  ${i + 1}. "${h}"`).join("\n")}

# CSV 샘플 (${csvSample.length}행)
${sampleText}

# 출력 (JSON 객체 하나만, 코드블록/설명 금지)
다음 형식의 JSON 객체를 반환하라. 매칭 안 되는 컬럼은 ignoreColumns에 넣고, headerMap의 값은 우리 컬럼 키 또는 null:
{
  "headerMap": { "<csvHeader>": "<ourColumnKey or null>", ... },
  "valueMaps": { "<ourColumnKey>": { "<csvValue>": "<ourValue>", ... }, ... },
  "dateFormat": { "<ourColumnKey>": "YYYY-MM-DD" or "MM/DD/YYYY" or "DD/MM/YYYY", ... },
  "splitColumns": { "<ourColumnKey>": { "delimiter": "," or "/" or "|", "trim": true } },
  "ignoreColumns": [ "<csvHeader>", ... ],
  "twoRowAssignment": { "thumbnailerColumn": "<csvHeader or null>", "editorColumn": "<csvHeader or null>" },
  "notes": "AI가 발견한 주의사항 (200자 이내)"
}

# 규칙
- headerMap은 모든 csv 헤더를 키로 포함. 매칭 안 되면 값은 null.
- workStatus의 값은 Wait/Wip/Done/Publish/Retake/Omit 6개 중 하나로 valueMaps에 변환규칙 작성. 예: "대기"→"Wait", "진행"→"Wip"
- editType valueMaps: 미설정/하이라이트 편집/컷편집/무편집/풀편집/-
- subtitle valueMaps: 미설정/기본 자막/자막X/효과자막 포함/-
- upload는 완료=완, 미완료=빈문자열로
- videoCategory가 콤마/슬래시 등으로 여러 카테고리이면 splitColumns에 delimiter 지정
- twoRowAssignment에는 csv에서 썸네일러/영상편집자 담당자가 분리되어 있는 경우만 채우고, 없으면 둘 다 null`;
}

function extractJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  // 코드블록 제거
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  // 첫 { 부터 마지막 } 까지 추출
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = s.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    return null;
  }
}

function fetchLiveDetail(channelId) {
  return new Promise((resolve, reject) => {
    const url = `https://api.chzzk.naver.com/service/v3/channels/${channelId}/live-detail`;
    https.get(url, { headers: { "User-Agent": "InelScheduler/1.0" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          resolve(json);
        } catch (e) {
          reject(new Error("JSON parse error"));
        }
      });
    }).on("error", reject);
  });
}

function startPolling(win, channelId, intervalMs) {
  stopPolling();
  lastCategory = null;
  lastTitle = null;
  pollingStartTime = Date.now();

  const poll = async () => {
    try {
      const json = await fetchLiveDetail(channelId);
      const content = json?.content;
      if (!content) {
        win.webContents.send("chzzk-status", { live: false });
        return;
      }

      const status = content.status;
      if (status !== "OPEN") {
        win.webContents.send("chzzk-status", { live: false, status });
        return;
      }

      // 카테고리는 id (영문 키) / value (한글 표시명) / type (GAME/ETC/...) 셋이 별개
      // - 사용자에게 보이고 셀에 저장되는 값: categoryValue(한글) 우선, 없으면 categoryId
      // - 자동 등록 / 비교에는 categoryId 가 안정적인 키
      const categoryId = content.liveCategory || "";
      const categoryValue = content.liveCategoryValue || "";
      const categoryType = content.categoryType || "";
      const categoryDisplay = categoryValue || categoryId;
      const title = content.liveTitle || "";
      const openDate = content.openDate || "";

      // uptime 은 가능하면 openDate(방송 시작 시각, KST) 기준으로 계산
      // → 인터넷 끊김 / 감지 OFF→ON 으로 polling 이 재시작돼도 실제 방송 경과 시간이 유지됨
      let elapsed = Date.now() - pollingStartTime;
      if (openDate) {
        const iso = openDate.includes("T") ? openDate : openDate.replace(" ", "T");
        const ts = new Date(iso + "+09:00").getTime();
        if (!isNaN(ts)) elapsed = Date.now() - ts;
      }
      const uptimeStr = formatUptime(elapsed);

      win.webContents.send("chzzk-status", {
        live: true,
        category: categoryDisplay, // 호환성: 기존 코드 path 유지
        categoryId,
        categoryValue,
        categoryType,
        title,
        openDate,
        uptime: uptimeStr
      });

      // 비교는 안정적인 키(categoryId)로. 빈 categoryId 면 categoryValue 로 폴백.
      const compareKey = categoryId || categoryValue;
      if (lastCategory !== null && compareKey !== lastCategory) {
        win.webContents.send("chzzk-category-change", {
          prev: lastCategory,
          next: categoryDisplay,
          nextId: categoryId,
          nextValue: categoryValue,
          nextType: categoryType,
          title,
          uptime: uptimeStr,
          timestamp: new Date().toISOString()
        });
      }

      if (lastTitle !== null && title !== lastTitle) {
        win.webContents.send("chzzk-title-change", {
          prev: lastTitle,
          next: title,
          category: categoryDisplay,
          uptime: uptimeStr,
          timestamp: new Date().toISOString()
        });
      }

      lastCategory = compareKey;
      lastTitle = title;
    } catch (err) {
      // 핸들러 안에서 예외가 나도 lastCategory/lastTitle 가 갱신될 수 있도록
      // catch 안에서도 직전 값으로 동기화 (try 끝까지 도달했을 가능성에 대비).
      // 그렇지 않으면 같은 이벤트가 매 polling 마다 무한 emit 된다.
      win.webContents.send("chzzk-error", { message: err.message, stack: err.stack });
    }
  };

  poll();
  pollingTimer = setInterval(poll, intervalMs);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  lastCategory = null;
  lastTitle = null;
  pollingStartTime = null;
}

function formatUptime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function createWindow() {
  const iconPath = path.join(__dirname, "../build/icon.png");
  const win = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    title: "Inel Work Scheduler",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  /* ── Google Sheets ── */

  let sheetsAuth = null;
  let sheetsClient = null;
  let sheetsClientEmail = null;
  let authMode = "none"; // "oauth" | "sa" | "none"

  async function initSheetsAuth(keyFilePath) {
    // (Legacy) Service Account JSON 으로 인증. 1.1.x 호환 유지용.
    const auth = new google.auth.GoogleAuth({
      keyFile: keyFilePath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    sheetsAuth = auth;
    sheetsClient = google.sheets({ version: "v4", auth });

    try {
      const raw = fs.readFileSync(keyFilePath, "utf8");
      const json = JSON.parse(raw);
      sheetsClientEmail = json.client_email || null;
    } catch {
      sheetsClientEmail = null;
    }
    authMode = "sa";
  }

  /** OAuth2Client 를 sheets API 의 auth 로 등록. login/restore 성공 후 호출. */
  function useOAuthClient(oauth2Client, userEmail) {
    sheetsAuth = oauth2Client;
    sheetsClient = google.sheets({ version: "v4", auth: oauth2Client });
    sheetsClientEmail = userEmail || null;
    authMode = "oauth";
  }

  /**
   * sheets API 호출 직전 토큰 신선화 보장. OAuth 모드에서만 의미 있음.
   * 매 IPC 핸들러 시작에서 호출.
   */
  async function ensureAuthReady() {
    if (authMode === "oauth") {
      await oauth.ensureFreshToken();
    }
  }

  // 앱 시작 시 저장된 refresh_token 으로 자동 복원 시도.
  (async () => {
    try {
      const res = await oauth.restore(app);
      if (res.ok) {
        useOAuthClient(oauth.getClient(), oauth.getUserEmail());
        if (win && !win.isDestroyed()) {
          try { win.webContents.send("oauth-auto-restored", { email: res.email }); } catch (_e) { /* renderer 아직 준비 안 됐을 수도 */ }
        }
      }
    } catch (_e) { /* ignore */ }
  })();

  // OAuth 로그인 IPC — 사용자가 [Google 로그인] 클릭 시 호출
  ipcMain.handle("oauth-login", async () => {
    const res = await oauth.login(app);
    if (res.ok) {
      useOAuthClient(oauth.getClient(), res.email);
    }
    return res;
  });

  ipcMain.handle("oauth-logout", async () => {
    oauth.logout(app);
    sheetsClient = null;
    sheetsAuth = null;
    sheetsClientEmail = null;
    authMode = "none";
    return { ok: true };
  });

  ipcMain.handle("oauth-status", async () => {
    return {
      ok: true,
      loggedIn: oauth.isLoggedIn(),
      email: oauth.getUserEmail(),
      authMode
    };
  });

  function extractSpreadsheetId(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  const TAB_SHEET_MAP = {
    shorts: "숏폼",
    longform: "롱폼",
    fullReplay: "다시보기"
  };

  function getSheetName(tabKey, year) {
    return `${TAB_SHEET_MAP[tabKey] || tabKey}_${year}`;
  }

  ipcMain.handle("sheets-pick-keyfile", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Google Service Account JSON 선택",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    const filePath = result.filePaths[0];
    try {
      await initSheetsAuth(filePath);
      return { ok: true, path: filePath, clientEmail: sheetsClientEmail };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("sheets-init-auth", async (_event, { keyFilePath }) => {
    try {
      await initSheetsAuth(keyFilePath);
      return { ok: true, clientEmail: sheetsClientEmail };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── _settings 시트 헬퍼 ───────────────────────────────────────
  // 관리자 환경 설정 일체를 시트에 저장. 헤더: key | value (value 는 JSON 문자열 가능)
  // 시트 링크와 SA 키 파일 같은 "부트스트랩 정보" 는 제외 (로컬 only).
  const SETTINGS_SHEET_NAME = "_settings";
  const SETTINGS_HEADER = ["key", "value"];

  async function ensureSettingsSheet(spreadsheetId) {
    const ss = await sheetsClient.spreadsheets.get({ spreadsheetId });
    const has = (ss.data.sheets || []).some((s) => s.properties && s.properties.title === SETTINGS_SHEET_NAME);
    if (!has) {
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: SETTINGS_SHEET_NAME } } }] }
      });
    }
    const head = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${SETTINGS_SHEET_NAME}!A1:B1`
    });
    const row = (head.data.values && head.data.values[0]) || [];
    if (row.length === 0) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId,
        range: `${SETTINGS_SHEET_NAME}!A1:B1`,
        valueInputOption: "RAW",
        requestBody: { values: [SETTINGS_HEADER] }
      });
    }
  }

  // 시트 → { key: value, ... } 로 직렬화. JSON 으로 파싱 가능하면 파싱.
  async function readSettingsKV(spreadsheetId) {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${SETTINGS_SHEET_NAME}!A2:B`
    });
    const rows = res.data.values || [];
    const out = {};
    for (const r of rows) {
      const k = (r[0] || "").trim();
      const v = r[1] != null ? r[1] : "";
      if (!k) continue;
      // JSON 파싱 시도 (객체 / 배열 / true / false / 숫자)
      const trimmed = (typeof v === "string" ? v : String(v)).trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed === "true" || trimmed === "false" || /^-?\d+(\.\d+)?$/.test(trimmed)) {
        try { out[k] = JSON.parse(trimmed); continue; } catch (_e) { /* fallthrough */ }
      }
      out[k] = v;
    }
    return out;
  }

  // 시트의 settings 를 통째로 덮어쓰기 (clear → header → rows).
  // 한 번에 모든 key 를 push 할 때 사용 (마이그레이션 / 강제 sync).
  async function writeSettingsKV(spreadsheetId, kv) {
    await ensureSettingsSheet(spreadsheetId);
    await sheetsClient.spreadsheets.values.clear({
      spreadsheetId,
      range: `${SETTINGS_SHEET_NAME}!A2:B`
    });
    const entries = Object.entries(kv).filter(([k]) => k && typeof k === "string");
    if (entries.length === 0) return;
    const values = entries.map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]);
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId,
      range: `${SETTINGS_SHEET_NAME}!A2:B${1 + values.length}`,
      valueInputOption: "RAW",
      requestBody: { values }
    });
  }

  // 일부 key 만 업데이트 (부분 patch). 기존 key 면 같은 행 update, 새 key 면 append.
  async function patchSettingsKV(spreadsheetId, patch) {
    if (!patch || typeof patch !== "object") return;
    await ensureSettingsSheet(spreadsheetId);
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${SETTINGS_SHEET_NAME}!A2:A`
    });
    const existing = (res.data.values || []).map((r, i) => ({ key: (r[0] || "").trim(), rowNum: i + 2 }));
    const updates = [];
    const appends = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!k) continue;
      const serialized = typeof v === "string" ? v : JSON.stringify(v);
      const found = existing.find((e) => e.key === k);
      if (found) {
        updates.push({ rowNum: found.rowNum, val: serialized });
      } else {
        appends.push([k, serialized]);
      }
    }
    // 1) 기존 행 update — 한 번에 batchUpdate 로
    if (updates.length > 0) {
      await sheetsClient.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: updates.map((u) => ({
            range: `${SETTINGS_SHEET_NAME}!B${u.rowNum}`,
            values: [[u.val]]
          }))
        }
      });
    }
    // 2) 새 key append
    if (appends.length > 0) {
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId,
        range: `${SETTINGS_SHEET_NAME}!A:B`,
        valueInputOption: "RAW",
        requestBody: { values: appends }
      });
    }
  }

  ipcMain.handle("settings-sheet-load", async (_event, { sheetUrl }) => {
    try {
      await ensureAuthReady();
      if (!sheetsClient) return { ok: false, error: "Sheets 인증 미초기화" };
      const spreadsheetId = extractSpreadsheetId(sheetUrl);
      if (!spreadsheetId) return { ok: false, error: "유효한 시트 URL이 아닙니다." };
      await ensureSettingsSheet(spreadsheetId);
      const kv = await readSettingsKV(spreadsheetId);
      return { ok: true, kv, count: Object.keys(kv).length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("settings-sheet-write", async (_event, { sheetUrl, kv }) => {
    try {
      await ensureAuthReady();
      if (!sheetsClient) return { ok: false, error: "Sheets 인증 미초기화" };
      const spreadsheetId = extractSpreadsheetId(sheetUrl);
      if (!spreadsheetId) return { ok: false, error: "유효한 시트 URL이 아닙니다." };
      await writeSettingsKV(spreadsheetId, kv || {});
      return { ok: true, count: Object.keys(kv || {}).length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("settings-sheet-patch", async (_event, { sheetUrl, patch }) => {
    try {
      await ensureAuthReady();
      if (!sheetsClient) return { ok: false, error: "Sheets 인증 미초기화" };
      const spreadsheetId = extractSpreadsheetId(sheetUrl);
      if (!spreadsheetId) return { ok: false, error: "유효한 시트 URL이 아닙니다." };
      await patchSettingsKV(spreadsheetId, patch || {});
      return { ok: true, count: Object.keys(patch || {}).length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── _tokens 시트 헬퍼 ─────────────────────────────────────────
  // 헤더: name | role | token | issuedAt | status | lastSeen
  const TOKENS_SHEET_NAME = "_tokens";
  const TOKENS_HEADER = ["name", "role", "token", "issuedAt", "status", "lastSeen"];

  async function ensureTokensSheet(spreadsheetId) {
    const ss = await sheetsClient.spreadsheets.get({ spreadsheetId });
    const has = (ss.data.sheets || []).some((s) => s.properties && s.properties.title === TOKENS_SHEET_NAME);
    if (!has) {
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: TOKENS_SHEET_NAME } } }] }
      });
    }
    // 헤더 행 확인 / 보충
    const head = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${TOKENS_SHEET_NAME}!A1:F1`
    });
    const row = (head.data.values && head.data.values[0]) || [];
    if (row.length === 0) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId,
        range: `${TOKENS_SHEET_NAME}!A1:F1`,
        valueInputOption: "RAW",
        requestBody: { values: [TOKENS_HEADER] }
      });
    }
  }

  async function readTokensRows(spreadsheetId) {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: `${TOKENS_SHEET_NAME}!A2:F`
    });
    const rows = res.data.values || [];
    return rows.map((r, idx) => ({
      rowNum: idx + 2, // 시트 행 번호 (1-based, 헤더 1행 제외)
      name: r[0] || "",
      role: r[1] || "",
      token: r[2] || "",
      issuedAt: r[3] || "",
      status: r[4] || "",
      lastSeen: r[5] || ""
    }));
  }

  function generateToken(byteLen = 24) {
    return crypto.randomBytes(byteLen).toString("hex");
  }

  // staff 앱이 자기 토큰 유효성 확인. lastSeen 도 같이 갱신.
  // 매칭: name(NFC 정규화) + token + role 모두 일치하는 첫 active 행.
  ipcMain.handle("tokens-verify", async (_event, { sheetUrl, name, role, token }) => {
    try {
      if (!sheetsClient) return { ok: false, error: "Sheets 인증이 초기화되지 않았습니다." };
      const spreadsheetId = extractSpreadsheetId(sheetUrl);
      if (!spreadsheetId) return { ok: false, error: "유효한 시트 URL이 아닙니다." };
      const normName = (s) => (s || "").normalize("NFC").trim();
      const wanted = normName(name);
      await ensureTokensSheet(spreadsheetId);
      const rows = await readTokensRows(spreadsheetId);
      const match = rows.find((r) => normName(r.name) === wanted && r.token === token && (role ? r.role === role : true));
      if (!match) {
        return { ok: true, valid: false, status: "not-found" };
      }
      // status 별 결과
      const status = (match.status || "").toLowerCase();
      if (status !== "active") {
        return { ok: true, valid: false, status: match.status || "(empty)" };
      }
      // lastSeen 갱신 (실패해도 검증 결과엔 영향 X)
      try {
        const now = new Date().toISOString();
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId,
          range: `${TOKENS_SHEET_NAME}!F${match.rowNum}`,
          valueInputOption: "RAW",
          requestBody: { values: [[now]] }
        });
      } catch (_e) { /* ignore */ }
      return { ok: true, valid: true, status: "active", name: match.name, role: match.role };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 관리자가 새 편집자/썸네일러 토큰 발급. _tokens 시트에 행 추가.
  // 이미 (name+role) 조합의 active 토큰이 있으면 새 토큰으로 갱신 (rotate).
  ipcMain.handle("tokens-issue", async (_event, { sheetUrl, name, role }) => {
    try {
      if (!sheetsClient) return { ok: false, error: "Sheets 인증이 초기화되지 않았습니다." };
      const spreadsheetId = extractSpreadsheetId(sheetUrl);
      if (!spreadsheetId) return { ok: false, error: "유효한 시트 URL이 아닙니다." };
      if (!name || !role) return { ok: false, error: "name, role 필수" };
      await ensureTokensSheet(spreadsheetId);
      const rows = await readTokensRows(spreadsheetId);
      const normName = (s) => (s || "").normalize("NFC").trim();
      const wanted = normName(name);
      const token = generateToken(24);
      const now = new Date().toISOString();
      const existing = rows.find((r) => normName(r.name) === wanted && r.role === role);
      if (existing) {
        // 기존 행 갱신 (새 토큰, status=active, issuedAt 갱신, lastSeen 비움)
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId,
          range: `${TOKENS_SHEET_NAME}!A${existing.rowNum}:F${existing.rowNum}`,
          valueInputOption: "RAW",
          requestBody: { values: [[name, role, token, now, "active", ""]] }
        });
        return { ok: true, token, rotated: true };
      }
      // 새 행 append
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId,
        range: `${TOKENS_SHEET_NAME}!A:F`,
        valueInputOption: "RAW",
        requestBody: { values: [[name, role, token, now, "active", ""]] }
      });
      return { ok: true, token, rotated: false };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 인스톨러 출력 폴더 선택 다이얼로그 (관리자가 빌드 시 호출)
  ipcMain.handle("pick-output-dir", async (_event, { defaultPath } = {}) => {
    const result = await dialog.showOpenDialog(win, {
      title: "인스톨러 출력 폴더 선택",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: defaultPath || undefined
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  // 관리자 UI 에서 편집자/썸네일러 인스톨러를 자동 빌드.
  //   1) 토큰 발급 (_tokens 시트)
  //   2) SA JSON 을 base64 인코딩
  //   3) 자식 프로세스 spawn 으로 npm run dist:editor / dist:thumbnailer
  //      (환경변수 IWS_NAME / ROLE / TOKEN / SHEET_URL / SA_KEY_B64 주입)
  //   4) release/ 의 산출물을 outputDir 로 이동
  //   5) 진행 로그를 chunk 단위로 BrowserWindow.webContents.send("build-installer-log") emit
  // 1.2.0 — OAuth 전환 후 단순화된 인스톨러 빌드.
  // 토큰 발급 / SA 키 임베드 제거. email + name + role + 시트 URL 만 빌드 환경변수로 forward.
  // 스태프 앱은 본인 Google 계정으로 로그인하고 임베드 email 과 일치하는지 검증한다.
  ipcMain.handle("build-editor-installer", async (_event, { name, email, role, sheetUrl, outputDir }) => {
    try {
      if (!name || !role) return { ok: false, error: "name, role 필수" };
      if (!["editor", "thumbnailer"].includes(role)) return { ok: false, error: "role 은 editor 또는 thumbnailer" };
      if (!email) return { ok: false, error: "스태프 Gmail (email) 필수 — 본인 인증 매칭용" };
      if (!sheetUrl) return { ok: false, error: "시트 URL 이 없습니다." };
      if (!outputDir) return { ok: false, error: "출력 폴더 미지정" };

      const emit = (line) => {
        try { if (win && !win.isDestroyed()) win.webContents.send("build-installer-log", line); } catch (_e) { /* ignore */ }
      };
      emit(`[1/2] 인스톨러 빌드 시작 (npm run dist:${role})…`);
      emit(`     스태프: ${name} <${email}> · ${role}`);

      // 자식 프로세스 spawn — npm run dist:<role>
      const projectRoot = path.resolve(__dirname, "..");
      const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
      const childEnv = {
        ...process.env,
        IWS_EDITION: role,
        IWS_NAME: name,
        IWS_EMAIL: email,
        IWS_ROLE: role,
        IWS_SHEET_URL: sheetUrl
        // 1.1.x 의 IWS_TOKEN / IWS_SA_KEY_B64 는 더 이상 사용하지 않음.
        // 스태프 앱이 자기 Google 계정으로 직접 로그인 → 시트 공유 권한이 진실의 단일 소스.
      };
      // Windows + npm.cmd 조합은 shell: true 없이 spawn 하면 EINVAL 발생.
      // shell 모드에서는 argv 가 한 줄 명령으로 합쳐지므로 경로/특수문자가 있으면 따옴표 처리 필요.
      const useShell = process.platform === "win32";
      const exitCode = await new Promise((resolve) => {
        const child = spawn(npmCmd, ["run", `dist:${role}`], {
          cwd: projectRoot,
          env: childEnv,
          windowsHide: true,
          shell: useShell
        });
        child.stdout && child.stdout.on("data", (buf) => buf.toString("utf8").split(/\r?\n/).forEach((l) => l && emit(`  ${l}`)));
        child.stderr && child.stderr.on("data", (buf) => buf.toString("utf8").split(/\r?\n/).forEach((l) => l && emit(`  ! ${l}`)));
        child.on("close", (code) => resolve(code));
        child.on("error", (err) => {
          emit(`  ! spawn 에러: ${err.message}`);
          emit(`     code=${err.code || "(none)"} errno=${err.errno || "(none)"} syscall=${err.syscall || "(none)"}`);
          emit(`     cmd=${npmCmd} cwd=${projectRoot} shell=${useShell}`);
          resolve(-1);
        });
      });
      if (exitCode !== 0) return { ok: false, error: `빌드 실패 (exit ${exitCode})` };
      emit(`     빌드 성공`);

      // 산출물을 outputDir 로 이동
      emit(`[2/2] 산출물 이동…`);
      const releaseDir = path.join(projectRoot, "release");
      const roleLabel = role === "editor" ? "Editor" : "Thumbnailer";
      const exeName = `Inel Scheduler-${roleLabel}-Setup-`;
      const matched = fs.readdirSync(releaseDir).filter((f) => f.startsWith(exeName) && (f.endsWith(".exe") || f.endsWith(".blockmap")));
      if (matched.length === 0) return { ok: false, error: "산출물 .exe 를 찾을 수 없습니다." };
      fs.mkdirSync(outputDir, { recursive: true });
      const moved = [];
      for (const f of matched) {
        const src = path.join(releaseDir, f);
        const dst = path.join(outputDir, f);
        try { fs.copyFileSync(src, dst); moved.push(dst); } catch (e) { emit(`  ! 복사 실패 ${f}: ${e.message}`); }
      }
      emit(`     완료. 출력 폴더: ${outputDir}`);
      return { ok: true, outputDir, files: moved };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 편집자/썸네일러 빌드에 임베드된 SA JSON (base64) 을 첫 실행 시 userData 에 풀어 저장.
  // 이후엔 같은 파일을 그대로 사용 (재생성 안 함). 인증 초기화까지 처리.
  ipcMain.handle("setup-embed-sa", async (_event, saKeyB64) => {
    try {
      if (typeof saKeyB64 !== "string" || saKeyB64.length === 0) {
        return { ok: false, error: "saKeyB64 가 비어있습니다." };
      }
      const credPath = path.join(app.getPath("userData"), "google-credentials.json");
      if (!fs.existsSync(credPath)) {
        const json = Buffer.from(saKeyB64, "base64").toString("utf8");
        // JSON 으로 한 번 parse 해서 유효성 검증 후 저장
        JSON.parse(json);
        fs.mkdirSync(path.dirname(credPath), { recursive: true });
        fs.writeFileSync(credPath, json, "utf8");
      }
      await initSheetsAuth(credPath);
      return { ok: true, path: credPath, clientEmail: sheetsClientEmail };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /* ── Chzzk Categories (사용자 추가분 영구 저장) ── */

  const userCategoryFile = path.join(app.getPath("userData"), "chzzk-categories-user.json");

  function readUserCategories() {
    try {
      if (!fs.existsSync(userCategoryFile)) return [];
      const raw = fs.readFileSync(userCategoryFile, "utf8");
      const json = JSON.parse(raw);
      return Array.isArray(json.categories) ? json.categories : [];
    } catch {
      return [];
    }
  }

  function writeUserCategories(categories) {
    try {
      const payload = {
        updatedAt: new Date().toISOString(),
        count: categories.length,
        categories
      };
      fs.mkdirSync(path.dirname(userCategoryFile), { recursive: true });
      fs.writeFileSync(userCategoryFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
      return true;
    } catch {
      return false;
    }
  }

  ipcMain.handle("categories-load-user", () => {
    return { ok: true, categories: readUserCategories(), path: userCategoryFile };
  });

  ipcMain.handle("categories-add-user", (_event, { categoryId, categoryValue, categoryType }) => {
    if (!categoryId || !categoryValue) {
      return { ok: false, error: "categoryId / categoryValue 필요" };
    }
    const list = readUserCategories();
    if (list.some((c) => c.categoryId === categoryId)) {
      return { ok: true, added: false, categories: list };
    }
    list.push({
      categoryId,
      categoryValue,
      categoryType: categoryType || "ETC",
      addedAt: new Date().toISOString()
    });
    const wrote = writeUserCategories(list);
    if (!wrote) return { ok: false, error: "파일 저장 실패" };
    return { ok: true, added: true, categories: list };
  });

  /**
   * 비공식 search/lives endpoint를 우회로 활용한 카테고리 온라인 검색.
   * 시드/사용자 데이터에 없는 카테고리를 입력 중인 키워드로 실시간 추출.
   * 활동 중 라이브가 한 건이라도 있는 카테고리만 잡힘.
   */
  ipcMain.handle("categories-search-online", async (_event, { keyword, limit = 20 }) => {
    if (!keyword || !keyword.trim()) return { ok: true, categories: [] };
    const trimmed = keyword.trim();
    try {
      const params = new URLSearchParams({ size: "30", offset: "0", keyword: trimmed });
      const url = `https://api.chzzk.naver.com/service/v1/search/lives?${params}`;
      const json = await new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "InelScheduler/1.0", "Accept": "application/json" } }, (res) => {
          let body = "";
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => {
            try { resolve(JSON.parse(body)); } catch (e) { reject(new Error("JSON parse error")); }
          });
        }).on("error", reject);
      });
      if (json?.code !== 200) return { ok: false, error: `API code ${json?.code}` };
      const items = json?.content?.data || [];
      const sink = new Map();
      for (const item of items) {
        const live = item.live || item;
        const id = live?.liveCategory || live?.videoCategory;
        const value = live?.liveCategoryValue || live?.videoCategoryValue;
        const type = live?.categoryType;
        if (!id || !value || !type) continue;
        if (!sink.has(id)) sink.set(id, { categoryId: id, categoryValue: value, categoryType: type });
        if (sink.size >= limit) break;
      }
      return { ok: true, categories: Array.from(sink.values()), keyword: trimmed };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle("sheets-test-connection", async (_event, { sheetUrl }) => {
    await ensureAuthReady();
    if (!sheetsClient) {
      return { ok: false, error: "Sheets 인증이 초기화되지 않았습니다. Google 계정으로 먼저 로그인하세요." };
    }
    const spreadsheetId = extractSpreadsheetId(sheetUrl);
    if (!spreadsheetId) {
      return { ok: false, error: "Google Sheets URL이 올바르지 않습니다." };
    }
    try {
      const meta = await sheetsClient.spreadsheets.get({
        spreadsheetId,
        fields: "properties.title,sheets.properties.title"
      });
      const title = meta.data.properties?.title || "";
      const sheetTitles = (meta.data.sheets || []).map((s) => s.properties.title);
      return { ok: true, title, sheets: sheetTitles, clientEmail: sheetsClientEmail };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("sheets-import", async (_event, { sheetUrl, tabKey, year, headers }) => {
    await ensureAuthReady();
    if (!sheetsClient) return { ok: false, error: "Sheets 인증이 초기화되지 않음. Google 계정으로 먼저 로그인하세요." };
    const spreadsheetId = extractSpreadsheetId(sheetUrl);
    if (!spreadsheetId) return { ok: false, error: "잘못된 Google Sheets URL" };

    const sheetName = getSheetName(tabKey, year);
    try {
      const res = await sheetsClient.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:Z10000`
      });

      const rawRows = res.data.values || [];
      if (rawRows.length === 0) return { ok: true, rows: [], headerRow: [] };

      const headerRow = rawRows[0];

      // headerRow 라벨 → ColumnDef 매핑 (shared 정보 포함)
      const colMap = headerRow.map((label) => headers.find((h) => h.label === label) || null);
      const sharedKeys = headers.filter((h) => h.shared).map((h) => h.key);
      const isPairedTab = sharedKeys.length > 0;

      const buildValues = (sourceRow, predicate) => {
        const out = {};
        colMap.forEach((col, colIdx) => {
          if (!col) return;
          if (!predicate(col)) return;
          out[col.key] = sourceRow[colIdx] || "";
        });
        return out;
      };

      // shared 컬럼 모두 비었는지 판정 (편집자 행 후보)
      const isEditorContinuationRow = (sourceRow) => {
        if (!isPairedTab) return false;
        return colMap.every((col, colIdx) => {
          if (!col || !col.shared) return true;
          const v = sourceRow[colIdx];
          return v == null || String(v).trim() === "";
        });
      };

      const dataRows = [];
      const sourceRows = rawRows.slice(1);
      for (let idx = 0; idx < sourceRows.length; idx++) {
        const src = sourceRows[idx];
        if (isPairedTab && isEditorContinuationRow(src) && dataRows.length > 0) {
          // 직전 RowItem 의 영상편집자 정보로 합치기
          const prev = dataRows[dataRows.length - 1];
          prev.editor = buildValues(src, (col) => !col.shared);
          continue;
        }
        if (isPairedTab) {
          // 새 RowItem: shared → values, 비shared → thumbnailer
          dataRows.push({
            id: `import_${tabKey}_${idx}_${Date.now()}`,
            values: buildValues(src, (col) => !!col.shared),
            thumbnailer: buildValues(src, (col) => !col.shared),
            editor: {}
          });
        } else {
          // 단일 행 모드 (다시보기 등)
          dataRows.push({
            id: `import_${tabKey}_${idx}_${Date.now()}`,
            values: buildValues(src, () => true)
          });
        }
      }

      return { ok: true, rows: dataRows, headerRow };
    } catch (err) {
      if (err.code === 400 || (err.message && err.message.includes("Unable to parse range"))) {
        return { ok: true, rows: [], headerRow: [], sheetNotFound: true };
      }
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("sheets-export", async (_event, { sheetUrl, tabKey, year, headers, rows }) => {
    await ensureAuthReady();
    if (!sheetsClient) return { ok: false, error: "Sheets 인증이 초기화되지 않음. Google 계정으로 먼저 로그인하세요." };
    const spreadsheetId = extractSpreadsheetId(sheetUrl);
    if (!spreadsheetId) return { ok: false, error: "잘못된 Google Sheets URL" };

    const sheetName = getSheetName(tabKey, year);

    try {
      const spreadsheet = await sheetsClient.spreadsheets.get({ spreadsheetId });
      const existingSheets = spreadsheet.data.sheets.map((s) => s.properties.title);

      if (!existingSheets.includes(sheetName)) {
        await sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: sheetName } } }]
          }
        });
      }

      const headerLabels = headers.map((h) => h.label);

      const sharedKeys = headers.filter((h) => h.shared).map((h) => h.key);
      const isPairedTab = sharedKeys.length > 0;

      // 시트는 항상 "위에서부터 예전 → 아래로 최신" 오름차순으로 고정.
      // 앱의 표시 정렬과 무관하게 시트 측 시간 흐름을 일관되게 유지하기 위함.
      // 키: broadcastDate ASC, 같으면 broadcastStartTime ASC (다시보기), 그 외엔 입력 순 (stable).
      const dateKey = (row) => (row && row.values && row.values.broadcastDate) || "";
      const timeKey = (row) => (row && row.values && row.values.broadcastStartTime) || "";
      const indexed = rows.map((row, idx) => ({ row, idx }));
      indexed.sort((a, b) => {
        const da = dateKey(a.row);
        const db = dateKey(b.row);
        // 빈 날짜는 항상 마지막으로
        if (!da && db) return 1;
        if (da && !db) return -1;
        if (da !== db) return da < db ? -1 : 1;
        const ta = timeKey(a.row);
        const tb = timeKey(b.row);
        if (ta !== tb) return ta < tb ? -1 : 1;
        return a.idx - b.idx; // stable
      });
      const sortedRows = indexed.map((x) => x.row);

      // 한 RowItem → 시트 행 1개 또는 2개로 직렬화
      const dataValues = [];
      for (const row of sortedRows) {
        const hasRoles = !!(row.thumbnailer || row.editor);
        if (isPairedTab && hasRoles) {
          // 행1: 썸네일러 → shared 컬럼은 row.values, 역할 컬럼은 row.thumbnailer
          const r1 = headers.map((h) => {
            if (h.shared) return row.values?.[h.key] || "";
            return (row.thumbnailer && row.thumbnailer[h.key]) || "";
          });
          // 행2: 영상편집자 → shared 컬럼은 비움, 역할 컬럼은 row.editor
          const r2 = headers.map((h) => {
            if (h.shared) return "";
            return (row.editor && row.editor[h.key]) || "";
          });
          dataValues.push(r1, r2);
        } else {
          dataValues.push(headers.map((h) => (row.values && row.values[h.key]) || ""));
        }
      }

      const allValues = [headerLabels, ...dataValues];

      // 기존 데이터를 덮어쓰기 전, 시트의 사용 영역을 먼저 비워서
      // 이전보다 적은 행을 업로드할 때 잔여물이 남지 않도록 함
      try {
        await sheetsClient.spreadsheets.values.clear({
          spreadsheetId,
          range: `${sheetName}!A1:Z10000`
        });
      } catch (_) {
        // clear 실패는 치명적이지 않음 (시트가 비어 있을 수 있음)
      }

      await sheetsClient.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: allValues }
      });

      return { ok: true, sheetName, rowCount: dataValues.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // 단일 행 patch — 다시보기 카테고리 변경 즉시 반영용.
  // matchPairs(예: [["broadcastDate","2026-05-02"],["broadcastStartTime","13:12:46"]]) 로
  // 시트에서 해당 행을 식별 → 그 행 전체를 rowValues 로 update. 매칭 행이 없으면 append.
  // 카테고리 변경마다 호출되므로 빠르고 가벼운 단일 행 작업만 수행.
  ipcMain.handle("sheets-patch-row", async (_event, { sheetUrl, tabKey, year, headers, matchPairs, rowValues }) => {
    await ensureAuthReady();
    if (!sheetsClient) return { ok: false, error: "Sheets 인증이 초기화되지 않음. Google 계정으로 먼저 로그인하세요." };
    const spreadsheetId = extractSpreadsheetId(sheetUrl);
    if (!spreadsheetId) return { ok: false, error: "잘못된 Google Sheets URL" };
    const sheetName = getSheetName(tabKey, year);

    try {
      const spreadsheet = await sheetsClient.spreadsheets.get({ spreadsheetId });
      const existingSheets = spreadsheet.data.sheets.map((s) => s.properties.title);
      if (!existingSheets.includes(sheetName)) {
        // 시트가 없으면 생성하고 헤더 행 작성 후 그 아래에 append
        await sheetsClient.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
        });
        const headerLabels = headers.map((h) => h.label);
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [headerLabels] }
        });
      }

      // 1) 시트 read
      let sheetRows = [];
      try {
        const res = await sheetsClient.spreadsheets.values.get({
          spreadsheetId,
          range: `${sheetName}!A1:Z10000`
        });
        sheetRows = res.data.values || [];
      } catch (_) {
        sheetRows = [];
      }

      let headerRow = sheetRows[0] || [];

      // 1-1) 누락된 컬럼 자동 보충 — 우리 schema 의 label 중 시트 헤더에 없는 것은
      // 시트 헤더 끝에 append 한다. 사용자가 직접 옮긴 컬럼 순서는 보존하면서
      // 신규 컬럼만 추가하는 안전한 방식.
      const missingLabels = headers
        .map((h) => h.label)
        .filter((label) => !headerRow.includes(label));
      if (missingLabels.length > 0) {
        headerRow = [...headerRow, ...missingLabels];
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1`,
          valueInputOption: "RAW",
          requestBody: { values: [headerRow] }
        });
        sheetRows[0] = headerRow;
      }

      // 1-2) keyToColIndex: 우리 schema 의 key → 시트 헤더 인덱스
      const labelToIndex = new Map();
      headerRow.forEach((label, idx) => labelToIndex.set(label, idx));
      const keyToColIndex = new Map();
      headers.forEach((h) => {
        if (labelToIndex.has(h.label)) keyToColIndex.set(h.key, labelToIndex.get(h.label));
      });

      // 2) matchPairs 모두 일치하는 row 인덱스 찾기 (헤더는 0행이라 데이터는 1행부터)
      let matchedRowIndex = -1;
      for (let i = 1; i < sheetRows.length; i++) {
        const r = sheetRows[i];
        let allMatch = true;
        for (const [k, v] of matchPairs) {
          const colIdx = keyToColIndex.get(k);
          if (colIdx === undefined || (r[colIdx] || "") !== v) { allMatch = false; break; }
        }
        if (allMatch) { matchedRowIndex = i; break; }
      }

      // 3) rowOut 생성 — 시트 헤더 컬럼 수만큼 빈 배열 만든 뒤,
      // 우리 schema 의 각 key 를 시트 헤더 인덱스에 정확히 배치.
      // → 사용자가 시트에서 컬럼 순서를 바꿔도, 우리 데이터가 올바른 셀에 들어감.
      const rowOut = new Array(headerRow.length).fill("");
      for (const h of headers) {
        const idx = keyToColIndex.get(h.key);
        if (idx === undefined || idx < 0) continue;
        rowOut[idx] = (rowValues && rowValues[h.key]) || "";
      }

      // 4) update or append
      if (matchedRowIndex >= 0) {
        const sheetRowNum = matchedRowIndex + 1; // A1 기준 1-based
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A${sheetRowNum}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [rowOut] }
        });
        return { ok: true, action: "updated", rowNum: sheetRowNum };
      } else {
        await sheetsClient.spreadsheets.values.append({
          spreadsheetId,
          range: `${sheetName}!A1`,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [rowOut] }
        });
        return { ok: true, action: "appended" };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("chzzk-start-polling", (_event, { url, intervalMs }) => {
    const channelId = extractChannelId(url);
    if (!channelId) return { ok: false, error: "Invalid Chzzk URL" };
    startPolling(win, channelId, intervalMs || 3000);
    return { ok: true, channelId };
  });

  ipcMain.handle("chzzk-stop-polling", () => {
    stopPolling();
    return { ok: true };
  });

  /**
   * Service Account 설정 가이드를 시스템 기본 브라우저로 열기.
   * GIF 같은 풍부한 미디어를 앱 카드 안 좁은 영역이 아닌 큰 브라우저 창에서 보도록 함.
   * dev/prod 환경에 따라 vite dev URL 또는 빌드된 정적 파일 경로를 사용.
   */
  ipcMain.handle("help-open-sheets-setup", async () => {
    return openHelpPage("google-sheets-setup.html");
  });

  /**
   * 스케줄러 앱 사용 방법 가이드 페이지를 시스템 기본 브라우저로 열기.
   * 시트 컬럼 기능별 설명 + 시트설정 ↔ 시트 기능 연계 + 단축키 + 동기화 흐름.
   */
  ipcMain.handle("help-open-app-guide", async () => {
    return openHelpPage("scheduler-app-guide.html");
  });

  ipcMain.handle("help-open-staff-installer", async () => {
    return await openHelpPage("staff-installer-guide.html");
  });

  ipcMain.handle("help-open-ai-setup", async () => {
    return openHelpPage("ai-setup.html");
  });

  /* ──────────────────────────────────────────────
   * 윈도우 시작 시 자동 실행 (Login Item) 토글 / 조회
   *
   * Windows: 내부적으로 HKCU\Software\Microsoft\Windows\CurrentVersion\Run 에
   *           실행 파일 경로를 등록/제거 (Electron 표준 동작).
   * dev 환경(electron .)에서는 electron 본체 경로가 등록될 수 있으므로 안내 로그만.
   * ──────────────────────────────────────────────
   */
  ipcMain.handle("autostart-get", async () => {
    try {
      const settings = app.getLoginItemSettings();
      return { ok: true, openAtLogin: !!settings.openAtLogin, executableWillLaunchAtLogin: !!settings.executableWillLaunchAtLogin };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle("open-user-data-dir", async () => {
    try {
      const dir = app.getPath("userData");
      await shell.openPath(dir);
      return { ok: true, path: dir };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // ───────────────────────────────────────────────────────────────
  // 앱 자체 삭제 — 설정 → 기타 의 "앱 삭제하기" 에서 호출.
  // 사용자가 모달에서 정확한 확인 문구를 입력했음을 가정한다.
  // NSIS uninstaller 를 silent 모드로 spawn 하고 우리 앱은 즉시 종료한다.
  // ───────────────────────────────────────────────────────────────
  ipcMain.handle("app-uninstall", async () => {
    try {
      if (process.platform !== "win32") {
        return { ok: false, error: "현재 Windows 만 지원" };
      }
      if (!app.isPackaged) {
        return { ok: false, error: "개발 모드에서는 사용 불가 (설치된 빌드에서만 동작)" };
      }
      const installDir = path.dirname(process.execPath);
      // electron-builder NSIS 디폴트 패턴: "Uninstall <productName>.exe"
      const uninstallerPath = path.join(installDir, "Uninstall Inel Work Scheduler.exe");
      if (!fs.existsSync(uninstallerPath)) {
        return { ok: false, error: `uninstaller 를 찾을 수 없음: ${uninstallerPath}` };
      }
      // /S = silent, --force-run = 앱이 실행 중이어도 진행
      const child = spawn(uninstallerPath, ["/S", "--force-run"], {
        detached: true,
        stdio: "ignore",
        cwd: installDir,
        windowsHide: true
      });
      child.unref();
      // 약간의 시간 차로 앱 종료 → uninstaller 가 lock 파일 충돌 없이 진행
      setTimeout(() => {
        try { app.quit(); } catch (_) { /* ignore */ }
      }, 600);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle("autostart-set", async (_event, { enabled }) => {
    try {
      if (process.platform !== "win32") {
        return { ok: false, error: "현재 win32만 지원" };
      }
      const isPackaged = app.isPackaged;
      // dev 환경에서는 electron 실행 파일이 등록되므로 효과가 없음을 알림
      app.setLoginItemSettings({
        openAtLogin: !!enabled,
        path: isPackaged ? process.execPath : undefined,
        args: []
      });
      const after = app.getLoginItemSettings();
      return {
        ok: true,
        openAtLogin: !!after.openAtLogin,
        warning: isPackaged ? null : "dev 환경: 설치 빌드에서만 정상 적용됩니다."
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  /**
   * AI provider별 모델 목록 조회. 가장 최신 5개를 반환.
   * @param {{ provider: 'openai'|'anthropic'|'google', apiKey: string }} args
   */
  ipcMain.handle("ai-list-models", async (_event, { provider, apiKey }) => {
    const t0 = Date.now();
    try {
      if (!provider) throw new Error("provider 미지정");
      if (!apiKey) throw new Error("apiKey 미지정");
      let models;
      if (provider === "openai") {
        models = await listOpenAIModels(apiKey);
      } else if (provider === "anthropic") {
        models = await listAnthropicModels(apiKey);
      } else if (provider === "google") {
        models = await listGoogleModels(apiKey);
      } else {
        throw new Error(`지원하지 않는 provider: ${provider}`);
      }
      const top5 = models.slice(0, 5);
      const elapsed = Date.now() - t0;
      return {
        ok: true,
        provider,
        models: top5,
        totalCount: models.length,
        elapsedMs: elapsed,
        log: `provider=${provider} 응답 모델 ${models.length}개, 상위 5개 반환 (${elapsed}ms)`
      };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      return {
        ok: false,
        provider,
        error: msg,
        elapsedMs: Date.now() - t0,
        log: `provider=${provider} 모델 조회 실패: ${msg}`
      };
    }
  });

  /**
   * CSV 헤더+샘플 행을 기반으로 우리 시트 컬럼 매핑을 생성.
   */
  ipcMain.handle("ai-analyze-csv", async (_event, args) => {
    const { provider, apiKey, model, csvHeader, csvSample, ourSchema } = args || {};
    const trace = [];
    const log = (msg) => { trace.push(`[${new Date().toISOString()}] ${msg}`); };
    const t0 = Date.now();
    try {
      log(`[AI:analyze] start provider=${provider} model=${model || "(default)"}`);
      if (!provider) throw new Error("provider 미지정");
      if (!apiKey) throw new Error("apiKey 미지정");
      if (!model) throw new Error("model 미지정");
      if (!Array.isArray(csvHeader) || csvHeader.length === 0) throw new Error("csvHeader 비어있음");
      if (!Array.isArray(csvSample)) throw new Error("csvSample 형식 오류");
      log(`[AI:analyze] CSV header=[${csvHeader.join(", ")}] (${csvHeader.length} cols)`);
      log(`[AI:analyze] CSV sample rows=${csvSample.length}`);

      const prompt = buildAnalyzePrompt(csvHeader, csvSample, ourSchema);
      log(`[AI:analyze] prompt size=${prompt.length} chars`);

      let raw;
      if (provider === "openai") {
        raw = await callOpenAI(apiKey, model, prompt, log);
      } else if (provider === "anthropic") {
        raw = await callAnthropic(apiKey, model, prompt, log);
      } else if (provider === "google") {
        raw = await callGemini(apiKey, model, prompt, log);
      } else {
        throw new Error(`지원하지 않는 provider: ${provider}`);
      }
      log(`[AI:analyze] raw response chars=${raw.length}`);

      const parsed = extractJson(raw);
      if (!parsed) {
        log(`[AI:analyze] JSON 파싱 실패. raw 첫 500자: ${raw.slice(0, 500)}`);
        throw new Error("AI가 유효한 JSON을 반환하지 않음");
      }

      const headerKeys = Object.keys(parsed.headerMap || {});
      log(`[AI:analyze] headerMap=${headerKeys.length}개, valueMaps=${Object.keys(parsed.valueMaps || {}).length}개, ignore=${(parsed.ignoreColumns || []).length}개`);

      const elapsed = Date.now() - t0;
      log(`[AI:analyze] OK (${elapsed}ms)`);
      return { ok: true, mapping: parsed, elapsedMs: elapsed, trace };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      log(`[AI:analyze] FAIL: ${msg}`);
      return { ok: false, error: msg, elapsedMs: Date.now() - t0, trace };
    }
  });

  async function openHelpPage(fileName) {
    try {
      const devUrl = process.env.VITE_DEV_SERVER_URL;
      let target;
      if (devUrl) {
        target = `${devUrl.replace(/\/$/, "")}/help/${fileName}`;
      } else {
        // packaged 빌드: __dirname 이 app.asar 안을 가리킴. shell.openExternal 은 OS
        // 핸들러로 가서 .asar 안의 파일을 file:// 로 못 연다. 그래서 package.json 의
        // asarUnpack 으로 dist/help/** 를 .asar 밖에 풀어두고, 경로를 .asar.unpacked
        // 로 치환해서 OS 가 실제 파일을 찾을 수 있게 한다.
        const raw = path.join(__dirname, "..", "dist", "help", fileName);
        const unpacked = raw.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
        target = `file://${unpacked.replace(/\\/g, "/")}`;
      }
      await shell.openExternal(target);
      return { ok: true, url: target };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }
}

/**
 * 인스톨러가 남긴 PendingAutoStart 값을 읽어
 * Electron 표준 형식으로 자동실행을 등록/해제하고, 임시 키를 삭제한다.
 *
 * 이렇게 하면:
 *   - 설치 시 [윈도우 시작 시 자동 실행] 체크 → 부팅 시 자동 실행
 *   - 그리고 앱의 [기타 설정] 탭의 자동실행 토글도 정확히 ON 상태로 표시됨
 *     (Electron 의 getLoginItemSettings 가 자기 형식으로 등록된 키만 정확히 인식)
 */
function applyPendingAutoStart() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve();
    if (!app.isPackaged) return resolve();
    try {
      const productName = app.getName();
      const subKey = `HKCU\\Software\\${productName}`;
      execFile("reg.exe", ["query", subKey, "/v", "PendingAutoStart"], (err, stdout) => {
        if (err) return resolve();
        const m = String(stdout || "").match(/PendingAutoStart\s+REG_SZ\s+(\d)/i);
        if (!m) return resolve();
        const enabled = m[1] === "1";
        try {
          app.setLoginItemSettings({
            openAtLogin: enabled,
            path: process.execPath,
            args: []
          });
        } catch (_) { /* ignore */ }
        execFile("reg.exe", ["delete", subKey, "/v", "PendingAutoStart", "/f"], () => resolve());
      });
    } catch (_) { resolve(); }
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // PendingAutoStart 레지스트리 처리 완료 후 createWindow → renderer 의 autostartGet 호출
  // 시점엔 이미 setLoginItemSettings 가 끝나있어 [기타 설정] 토글이 정확한 ON 상태 표시.
  await applyPendingAutoStart();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopPolling();
  if (process.platform !== "darwin") app.quit();
});
