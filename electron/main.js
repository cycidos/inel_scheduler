const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const https = require("https");
const fs = require("fs");
const { google } = require("googleapis");

let pollingTimer = null;
let lastCategory = null;
let lastTitle = null;
let pollingStartTime = null;

function extractChannelId(url) {
  const match = url.match(/chzzk\.naver\.com\/(?:live\/)?([a-f0-9]{32})/);
  return match ? match[1] : null;
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
      const dataRows = rawRows.slice(1).map((row, idx) => {
        const values = {};
        headerRow.forEach((header, colIdx) => {
          const matchingKey = headers.find((h) => h.label === header);
          if (matchingKey) {
            values[matchingKey.key] = row[colIdx] || "";
          }
        });
        return { id: `import_${tabKey}_${idx}_${Date.now()}`, values };
      });

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
      const dataValues = rows.map((row) =>
        headers.map((h) => row.values[h.key] || "")
      );
      const allValues = [headerLabels, ...dataValues];

      await sheetsClient.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: allValues }
      });

      return { ok: true, sheetName, rowCount: rows.length };
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

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopPolling();
  if (process.platform !== "darwin") app.quit();
});
