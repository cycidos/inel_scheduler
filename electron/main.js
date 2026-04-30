const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const https = require("https");
const fs = require("fs");
const { execFile } = require("child_process");
const { google } = require("googleapis");

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

      const category = content.liveCategory || content.liveCategoryValue || "";
      const title = content.liveTitle || "";
      const openDate = content.openDate || "";
      const elapsed = Date.now() - pollingStartTime;
      const uptimeStr = formatUptime(elapsed);

      win.webContents.send("chzzk-status", {
        live: true,
        category,
        title,
        openDate,
        uptime: uptimeStr
      });

      if (lastCategory !== null && category !== lastCategory) {
        win.webContents.send("chzzk-category-change", {
          prev: lastCategory,
          next: category,
          title,
          uptime: uptimeStr,
          timestamp: new Date().toISOString()
        });
      }

      if (lastTitle !== null && title !== lastTitle) {
        win.webContents.send("chzzk-title-change", {
          prev: lastTitle,
          next: title,
          category,
          uptime: uptimeStr,
          timestamp: new Date().toISOString()
        });
      }

      lastCategory = category;
      lastTitle = title;
    } catch (err) {
      win.webContents.send("chzzk-error", { message: err.message });
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

  async function initSheetsAuth(keyFilePath) {
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
  }

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
    if (!sheetsClient) {
      return { ok: false, error: "Service Account JSON이 등록되지 않았습니다." };
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
    if (!sheetsClient) return { ok: false, error: "인증되지 않음. Service Account JSON을 먼저 설정하세요." };
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
    if (!sheetsClient) return { ok: false, error: "인증되지 않음. Service Account JSON을 먼저 설정하세요." };
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

      // 한 RowItem → 시트 행 1개 또는 2개로 직렬화
      const dataValues = [];
      for (const row of rows) {
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
        const filePath = path.join(__dirname, "..", "dist", "help", fileName);
        target = `file://${filePath.replace(/\\/g, "/")}`;
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
  if (process.platform !== "win32") return;
  if (!app.isPackaged) return;
  try {
    const productName = app.getName();
    const subKey = `HKCU\\Software\\${productName}`;
    execFile("reg.exe", ["query", subKey, "/v", "PendingAutoStart"], (err, stdout) => {
      if (err) return;
      const m = String(stdout || "").match(/PendingAutoStart\s+REG_SZ\s+(\d)/i);
      if (!m) return;
      const enabled = m[1] === "1";
      try {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          path: process.execPath,
          args: []
        });
      } catch (_) {}
      execFile("reg.exe", ["delete", subKey, "/v", "PendingAutoStart", "/f"], () => {});
    });
  } catch (_) {}
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  applyPendingAutoStart();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopPolling();
  if (process.platform !== "darwin") app.quit();
});
