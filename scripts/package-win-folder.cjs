const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const appPackage = require("../package.json");

const root = path.resolve(__dirname, "..");
const releaseDir = path.join(root, "release");
const outputDir = path.join(releaseDir, "win-unpacked");
const staleBuilderDir = path.join(releaseDir, "win-unpacked.tmp");
const appDir = path.join(outputDir, "resources", "app");

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to operate outside project root: ${resolved}`);
  }
}

function removeIfExists(target) {
  assertInsideRoot(target);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function copyDir(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    filter: (sourcePath) => !sourcePath.includes(`${path.sep}.vite${path.sep}`),
  });
}

const electronExe = require("electron");
const electronDist = path.dirname(electronExe);

removeIfExists(outputDir);
removeIfExists(staleBuilderDir);
fs.mkdirSync(releaseDir, { recursive: true });
copyDir(electronDist, outputDir);

const defaultApp = path.join(outputDir, "resources", "default_app.asar");
if (fs.existsSync(defaultApp)) {
  fs.rmSync(defaultApp, { force: true });
}

fs.mkdirSync(appDir, { recursive: true });
copyDir(path.join(root, "dist"), path.join(appDir, "dist"));
copyDir(path.join(root, "electron"), path.join(appDir, "electron"));

fs.writeFileSync(
  path.join(appDir, "package.json"),
  JSON.stringify(
    {
      name: "notes",
      productName: "Notes",
      version: appPackage.version,
      description: "A local-first notes app for desktop and mobile.",
      main: "electron/main.cjs",
    },
    null,
    2,
  ),
);

const sourceExe = path.join(outputDir, "electron.exe");
const appExe = path.join(outputDir, "Notes.exe");
if (fs.existsSync(sourceExe)) {
  fs.renameSync(sourceExe, appExe);
}

const rcedit = path.join(
  root,
  "node_modules",
  ".pnpm",
  "electron-winstaller@5.4.0",
  "node_modules",
  "electron-winstaller",
  "vendor",
  "rcedit.exe",
);
const appIcon = path.join(root, "public", "icons", "notes-icon.ico");

if (fs.existsSync(rcedit) && fs.existsSync(appIcon)) {
  const result = spawnSync(
    rcedit,
    [
      appExe,
      "--set-icon",
      appIcon,
      "--set-version-string",
      "FileDescription",
      "Notes",
      "--set-version-string",
      "ProductName",
      "Notes",
      "--set-version-string",
      "InternalName",
      "Notes",
      "--set-version-string",
      "OriginalFilename",
      "Notes.exe",
    ],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error("Failed to apply the Windows app icon.");
  }
}

console.log(`Packaged Windows app: ${appExe}`);
