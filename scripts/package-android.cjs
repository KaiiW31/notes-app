const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const androidRoot = path.join(projectRoot, "android");
const toolsRoot = path.join(projectRoot, ".android-build-tools");
const localJavaHome = path.join(toolsRoot, "jdk-17");
const localAndroidHome = path.join(toolsRoot, "android-sdk");
const localGradle = path.join(toolsRoot, "gradle-8.13", "bin", "gradle.bat");
const wrapper = path.join(androidRoot, "gradlew.bat");

const javaHome = process.env.JAVA_HOME || (fs.existsSync(localJavaHome) ? localJavaHome : "");
const androidHome =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  (fs.existsSync(localAndroidHome) ? localAndroidHome : "");
const gradle = fs.existsSync(wrapper) ? wrapper : localGradle;

if (!javaHome || !fs.existsSync(path.join(javaHome, "bin", "java.exe"))) {
  throw new Error("JDK 17 was not found. Install it or place it in .android-build-tools/jdk-17.");
}
if (!androidHome || !fs.existsSync(androidHome)) {
  throw new Error(
    "The Android SDK was not found. Install it or place it in .android-build-tools/android-sdk.",
  );
}
if (!fs.existsSync(gradle)) {
  throw new Error("Gradle 8.13 was not found and the Android wrapper has not been generated.");
}

const environment = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
  Path: [
    path.join(javaHome, "bin"),
    path.join(androidHome, "platform-tools"),
    process.env.Path || "",
  ].join(path.delimiter),
};

const result = spawnSync(
  process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
  ["/d", "/c", `call "${gradle}" assembleDebug --no-daemon`],
  {
  cwd: androidRoot,
  env: environment,
  stdio: "inherit",
  shell: false,
  windowsVerbatimArguments: true,
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const sourceApk = path.join(androidRoot, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const releaseFolder = path.join(projectRoot, "release");
const outputApk = path.join(releaseFolder, "Notes-android-debug.apk");
fs.mkdirSync(releaseFolder, { recursive: true });
fs.copyFileSync(sourceApk, outputApk);
console.log(`Android APK ready: ${outputApk}`);
