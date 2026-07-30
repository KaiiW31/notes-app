const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openNotesDesktop", {
  platform: process.platform,
  getSyncFolderLabel: () => ipcRenderer.invoke("notes-sync:get-folder-label"),
  chooseSyncFolder: () => ipcRenderer.invoke("notes-sync:choose-folder"),
  listSyncFiles: () => ipcRenderer.invoke("notes-sync:list-files"),
  readSyncFile: (filename) => ipcRenderer.invoke("notes-sync:read-file", filename),
  writeSyncFile: (filename, contents) =>
    ipcRenderer.invoke("notes-sync:write-file", filename, contents),
});
