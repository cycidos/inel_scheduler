const { contextBridge, ipcRenderer } = require("electron");

// 1.2.0+ — 스태프 본인 정보를 사이드카 .json 으로 받는다. preload 가 main 에 동기
// 호출하여 renderer 의 EMBED 가 모듈 최상위에서 즉시 사용 가능하도록.
// admin 빌드 또는 .json 미설치 시 모두 빈 값.
let embed = { name: "", email: "", role: "", sheetUrl: "" };
try {
  const got = ipcRenderer.sendSync("embed-get-sync");
  if (got && typeof got === "object") embed = { ...embed, ...got };
} catch (_e) { /* preload 실패해도 앱 자체는 동작해야 함 */ }

contextBridge.exposeInMainWorld("electronAPI", {
  appName: "Inel Work Scheduler",
  embed,

  startChzzkPolling: (url, intervalMs) =>
    ipcRenderer.invoke("chzzk-start-polling", { url, intervalMs }),

  stopChzzkPolling: () =>
    ipcRenderer.invoke("chzzk-stop-polling"),

  onChzzkStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("chzzk-status", handler);
    return () => ipcRenderer.removeListener("chzzk-status", handler);
  },

  onChzzkCategoryChange: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("chzzk-category-change", handler);
    return () => ipcRenderer.removeListener("chzzk-category-change", handler);
  },

  onChzzkTitleChange: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("chzzk-title-change", handler);
    return () => ipcRenderer.removeListener("chzzk-title-change", handler);
  },

  onChzzkError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("chzzk-error", handler);
    return () => ipcRenderer.removeListener("chzzk-error", handler);
  },

  oauthLogin: () => ipcRenderer.invoke("oauth-login"),
  oauthLogout: () => ipcRenderer.invoke("oauth-logout"),
  oauthStatus: () => ipcRenderer.invoke("oauth-status"),
  onOAuthAutoRestored: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("oauth-auto-restored", handler);
    return () => ipcRenderer.removeListener("oauth-auto-restored", handler);
  },

  settingsSheetLoad: (sheetUrl) =>
    ipcRenderer.invoke("settings-sheet-load", { sheetUrl }),

  settingsSheetWrite: (sheetUrl, kv) =>
    ipcRenderer.invoke("settings-sheet-write", { sheetUrl, kv }),

  settingsSheetPatch: (sheetUrl, patch) =>
    ipcRenderer.invoke("settings-sheet-patch", { sheetUrl, patch }),

  pickOutputDir: (defaultPath) => ipcRenderer.invoke("pick-output-dir", { defaultPath }),

  buildEditorInstaller: (payload) => ipcRenderer.invoke("build-editor-installer", payload),

  onBuildInstallerLog: (callback) => {
    const handler = (_event, line) => callback(line);
    ipcRenderer.on("build-installer-log", handler);
    return () => ipcRenderer.removeListener("build-installer-log", handler);
  },

  sheetsImport: (sheetUrl, tabKey, year, headers) =>
    ipcRenderer.invoke("sheets-import", { sheetUrl, tabKey, year, headers }),

  sheetsExport: (sheetUrl, tabKey, year, headers, rows) =>
    ipcRenderer.invoke("sheets-export", { sheetUrl, tabKey, year, headers, rows }),

  sheetsPatchRow: (sheetUrl, tabKey, year, headers, matchPairs, rowValues) =>
    ipcRenderer.invoke("sheets-patch-row", { sheetUrl, tabKey, year, headers, matchPairs, rowValues }),

  sheetsTestConnection: (sheetUrl) =>
    ipcRenderer.invoke("sheets-test-connection", { sheetUrl }),

  categoriesLoadUser: () => ipcRenderer.invoke("categories-load-user"),

  categoriesAddUser: (categoryId, categoryValue, categoryType) =>
    ipcRenderer.invoke("categories-add-user", { categoryId, categoryValue, categoryType }),

  categoriesSearchOnline: (keyword, limit = 20) =>
    ipcRenderer.invoke("categories-search-online", { keyword, limit }),

  helpOpenSheetsSetup: () => ipcRenderer.invoke("help-open-sheets-setup"),
  helpOpenAppGuide: () => ipcRenderer.invoke("help-open-app-guide"),
  helpOpenStaffInstaller: () => ipcRenderer.invoke("help-open-staff-installer"),
  helpOpenAiSetup: () => ipcRenderer.invoke("help-open-ai-setup"),

  autostartGet: () => ipcRenderer.invoke("autostart-get"),
  autostartSet: (enabled) => ipcRenderer.invoke("autostart-set", { enabled }),
  openUserDataDir: () => ipcRenderer.invoke("open-user-data-dir"),
  uninstallApp: () => ipcRenderer.invoke("app-uninstall"),

  aiListModels: (provider, apiKey) =>
    ipcRenderer.invoke("ai-list-models", { provider, apiKey }),

  aiAnalyzeCsv: (provider, apiKey, model, csvHeader, csvSample, ourSchema) =>
    ipcRenderer.invoke("ai-analyze-csv", { provider, apiKey, model, csvHeader, csvSample, ourSchema })
});
