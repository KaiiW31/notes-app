const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const isDev = Boolean(process.env.ELECTRON_START_URL);
const SETTINGS_FILENAME = "sync-settings.json";
const SYNC_FILE_PATTERN = /^open-notes-device-[a-zA-Z0-9-]+\.json$/;

const getSettingsPath = () => path.join(app.getPath("userData"), SETTINGS_FILENAME);

const readSettings = async () => {
  try {
    return JSON.parse(await fs.readFile(getSettingsPath(), "utf8"));
  } catch {
    return {};
  }
};

const saveSettings = async (settings) => {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), "utf8");
};

const getSyncFolder = async () => {
  const settings = await readSettings();
  if (!settings.syncFolder || typeof settings.syncFolder !== "string") return null;
  try {
    const details = await fs.stat(settings.syncFolder);
    return details.isDirectory() ? settings.syncFolder : null;
  } catch {
    return null;
  }
};

const requireSyncFolder = async () => {
  const folder = await getSyncFolder();
  if (!folder) throw new Error("Choose a cloud sync folder first.");
  return folder;
};

const safeSyncFilePath = (folder, filename) => {
  if (!SYNC_FILE_PATTERN.test(filename)) throw new Error("Invalid sync filename.");
  const target = path.resolve(folder, filename);
  if (path.dirname(target) !== path.resolve(folder)) throw new Error("Invalid sync path.");
  return target;
};

ipcMain.handle("notes-sync:get-folder-label", async () => {
  const folder = await getSyncFolder();
  return folder ? path.basename(folder) || folder : null;
});

ipcMain.handle("notes-sync:choose-folder", async () => {
  const selected = await dialog.showOpenDialog({
    title: "Choose your Notes sync folder",
    buttonLabel: "Use this folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (selected.canceled || !selected.filePaths[0]) return null;
  await saveSettings({ syncFolder: path.resolve(selected.filePaths[0]) });
  return path.basename(selected.filePaths[0]) || selected.filePaths[0];
});

ipcMain.handle("notes-sync:list-files", async () => {
  const folder = await requireSyncFolder();
  const entries = await fs.readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SYNC_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name);
});

ipcMain.handle("notes-sync:read-file", async (_event, filename) => {
  const folder = await requireSyncFolder();
  return fs.readFile(safeSyncFilePath(folder, filename), "utf8");
});

ipcMain.handle("notes-sync:write-file", async (_event, filename, contents) => {
  const folder = await requireSyncFolder();
  if (typeof contents !== "string") throw new Error("Invalid sync contents.");
  await fs.writeFile(safeSyncFilePath(folder, filename), contents, "utf8");
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 360,
    minHeight: 640,
    backgroundColor: "#f7f8fa",
    title: "Notes",
    icon: path.join(__dirname, "..", "dist", "icons", "notes-icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (isDev) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }

    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
