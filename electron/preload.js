const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  appName: "Inel Work Scheduler",

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

  sheetsPickKeyfile: () => ipcRenderer.invoke("sheets-pick-keyfile"),

  sheetsInitAuth: (keyFilePath) => ipcRenderer.invoke("sheets-init-auth", { keyFilePath }),

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
  helpOpenAiSetup: () => ipcRenderer.invoke("help-open-ai-setup"),

  autostartGet: () => ipcRenderer.invoke("autostart-get"),
  autostartSet: (enabled) => ipcRenderer.invoke("autostart-set", { enabled }),
  openUserDataDir: () => ipcRenderer.invoke("open-user-data-dir"),

  aiListModels: (provider, apiKey) =>
    ipcRenderer.invoke("ai-list-models", { provider, apiKey }),

  aiAnalyzeCsv: (provider, apiKey, model, csvHeader, csvSample, ourSchema) =>
    ipcRenderer.invoke("ai-analyze-csv", { provider, apiKey, model, csvHeader, csvSample, ourSchema }),


  /**
   * Electron 32+에서는 File.path가 비어 있으므로 webUtils.getPathForFile()로
   * 절대 경로를 얻어야 한다. 드래그&드롭으로 받은 File 객체에 사용.
   */
  getFilePath: (file) => {
    try {
      if (file && webUtils && typeof webUtils.getPathForFile === "function") {
        return webUtils.getPathForFile(file) || "";
      }
    } catch (e) {}
    return (file && file.path) || "";
  }
});
