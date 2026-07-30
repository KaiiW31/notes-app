# Notes

A private, local-first notes app for Windows, Android phones, and Android tablets.

## Features

- Typed notes and pressure-sensitive handwriting
- S Pen and Android-compatible stylus input
- Palm rejection and optional finger drawing
- Lined, grid, dotted, and blank paper
- Attachments and audio recording
- Offline IndexedDB storage
- Automatic multi-device synchronization through a user-selected cloud folder

## Download the Android app

Open the repository's **Releases** page and download `Notes-android-debug.apk`.
This is a debug-signed personal testing build, so Android may ask you to allow
installation from the app used to open the APK.

## Cloud-folder sync

Choose the same Google Drive, OneDrive, or Dropbox folder in the Android and
Windows apps. Each device writes its own snapshot, merges the newest versions,
and preserves deletion records so removed notes do not reappear.

The current sync files are not end-to-end encrypted. Keep the selected cloud
folder private.

## Development

Requirements:

- Node.js
- pnpm
- JDK 17
- Android SDK 36 and Build Tools 35.0.0

Commands:

```powershell
pnpm install
pnpm dev
pnpm build
pnpm package:win
pnpm package:android
```

The Android project lives in `android/`. Generated output, local SDK tooling,
dependencies, and packaged applications are intentionally excluded from Git.
