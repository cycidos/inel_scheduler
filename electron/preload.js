const { contextBridge, ipcRenderer } = require("electron");

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

  sheetsTestConnection: (sheetUrl) =>
    ipcRenderer.invoke("sheets-test-connection", { sheetUrl }),

  categoriesLoadUser: () => ipcRenderer.invoke("categories-load-user"),

  categoriesAddUser: (categoryId, categoryValue, categoryType) =>
    ipcRenderer.invoke("categories-add-user", { categoryId, categoryValue, categoryType }),

  categoriesSearchOnline: (keyword, limit = 20) =>
    ipcRenderer.invoke("categories-search-online", { keyword, limit })
});
