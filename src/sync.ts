import { getSyncTombstones, replaceAllData, saveSyncTombstones } from "./storage";
import type {
  ExportPayload,
  Folder,
  Note,
  SyncSnapshot,
  SyncTombstones,
} from "./types";

const DEVICE_ID_KEY = "open-notes-device-id";
const SYNC_FILE_PREFIX = "open-notes-device-";
const SYNC_FILE_SUFFIX = ".json";
const NATIVE_RESULT_EVENT = "open-notes-native-result";

type NativeResult = {
  requestId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
};

export type SyncBridge = {
  platform: string;
  getSyncFolderLabel(): Promise<string | null>;
  chooseSyncFolder(): Promise<string | null>;
  listSyncFiles(): Promise<string[]>;
  readSyncFile(filename: string): Promise<string>;
  writeSyncFile(filename: string, contents: string): Promise<void>;
};

export type SyncResult = {
  folders: Folder[];
  notes: Note[];
  folderLabel: string;
  deviceCount: number;
  syncedAt: string;
};

declare global {
  interface Window {
    openNotesDesktop?: SyncBridge;
    AndroidNotesBridge?: {
      getSyncFolderLabel(requestId: string): void;
      chooseSyncFolder(requestId: string): void;
      listSyncFiles(requestId: string): void;
      readSyncFile(requestId: string, filename: string): void;
      writeSyncFile(requestId: string, filename: string, contents: string): void;
      shareText(requestId: string, title: string, contents: string): void;
      shareImage(requestId: string, title: string, dataUrl: string): void;
      saveImage(requestId: string, filename: string, dataUrl: string): void;
    };
  }
}

const getDeviceId = () => {
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
};

const nativeRequest = <T>(
  method: keyof NonNullable<Window["AndroidNotesBridge"]>,
  ...args: string[]
) =>
  new Promise<T>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener(NATIVE_RESULT_EVENT, handleResult as EventListener);
      reject(new Error("The Android file picker did not respond."));
    }, 120_000);

    const handleResult = (event: CustomEvent<NativeResult>) => {
      if (event.detail.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener(NATIVE_RESULT_EVENT, handleResult as EventListener);
      if (event.detail.ok) {
        resolve(event.detail.value as T);
      } else {
        reject(new Error(event.detail.error || "Android sync failed."));
      }
    };

    window.addEventListener(NATIVE_RESULT_EVENT, handleResult as EventListener);
    const nativeMethod = window.AndroidNotesBridge?.[method] as
      | ((...methodArgs: string[]) => void)
      | undefined;
    nativeMethod?.call(window.AndroidNotesBridge, requestId, ...args);
  });

const androidBridge = (): SyncBridge => ({
  platform: "android",
  getSyncFolderLabel: () => nativeRequest<string | null>("getSyncFolderLabel"),
  chooseSyncFolder: () => nativeRequest<string | null>("chooseSyncFolder"),
  listSyncFiles: () => nativeRequest<string[]>("listSyncFiles"),
  readSyncFile: (filename) => nativeRequest<string>("readSyncFile", filename),
  writeSyncFile: (filename, contents) =>
    nativeRequest<void>("writeSyncFile", filename, contents),
});

export const getSyncBridge = (): SyncBridge | null => {
  if (window.openNotesDesktop?.chooseSyncFolder) return window.openNotesDesktop;
  if (window.AndroidNotesBridge) return androidBridge();
  return null;
};

export const shareNativeText = async (title: string, contents: string) => {
  if (window.AndroidNotesBridge?.shareText) {
    await nativeRequest<void>("shareText", title, contents);
    return;
  }
  if (navigator.share) {
    await navigator.share({ title, text: contents });
    return;
  }
  await navigator.clipboard.writeText(contents);
};

const dataUrlFile = async (dataUrl: string, filename: string) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: "image/png" });
};

export const shareNativeImage = async (title: string, dataUrl: string) => {
  if (window.AndroidNotesBridge?.shareImage) {
    await nativeRequest<void>("shareImage", title, dataUrl);
    return;
  }
  const file = await dataUrlFile(dataUrl, `${title.replace(/[^\w.-]+/g, "-")}.png`);
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ title, files: [file] });
    return;
  }
  throw new Error("Image sharing is not available on this device.");
};

export const saveNativeImage = async (filename: string, dataUrl: string) => {
  if (window.AndroidNotesBridge?.saveImage) {
    await nativeRequest<void>("saveImage", filename, dataUrl);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
};

const newestTimestamp = (first?: string, second?: string) => {
  if (!first) return second;
  if (!second) return first;
  return first >= second ? first : second;
};

const mergeTombstones = (snapshots: SyncSnapshot[]): SyncTombstones => {
  const merged: SyncTombstones = { folders: {}, notes: {} };
  for (const snapshot of snapshots) {
    for (const [id, deletedAt] of Object.entries(snapshot.deleted.folders)) {
      merged.folders[id] = newestTimestamp(merged.folders[id], deletedAt) ?? deletedAt;
    }
    for (const [id, deletedAt] of Object.entries(snapshot.deleted.notes)) {
      merged.notes[id] = newestTimestamp(merged.notes[id], deletedAt) ?? deletedAt;
    }
  }
  return merged;
};

const mergeByUpdatedAt = <T extends { id: string; updatedAt: string }>(
  collections: T[][],
  tombstones: Record<string, string>,
) => {
  const merged = new Map<string, T>();
  for (const collection of collections) {
    for (const item of collection) {
      const current = merged.get(item.id);
      if (!current || item.updatedAt > current.updatedAt) merged.set(item.id, item);
    }
  }
  return [...merged.values()].filter(
    (item) => !tombstones[item.id] || item.updatedAt > tombstones[item.id],
  );
};

const validSnapshot = (value: unknown): value is SyncSnapshot => {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<SyncSnapshot>;
  return (
    snapshot.version === 1 &&
    typeof snapshot.deviceId === "string" &&
    Array.isArray(snapshot.folders) &&
    Array.isArray(snapshot.notes) &&
    !!snapshot.deleted &&
    typeof snapshot.deleted === "object"
  );
};

const isPristineInstall = (snapshot: SyncSnapshot) => {
  if (snapshot.notes.length !== 1) return false;
  const note = snapshot.notes[0];
  return (
    note.id === "note-welcome" &&
    !note.plainText &&
    (!note.contentHtml || note.contentHtml === "<p></p>") &&
    note.strokes.length === 0 &&
    note.attachments.length === 0
  );
};

const buildSnapshot = async (folders: Folder[], notes: Note[]): Promise<SyncSnapshot> => ({
  version: 1,
  deviceId: getDeviceId(),
  updatedAt: new Date().toISOString(),
  folders,
  notes,
  deleted: await getSyncTombstones(),
});

export const getConfiguredSyncFolder = async () => {
  const bridge = getSyncBridge();
  return bridge ? bridge.getSyncFolderLabel() : null;
};

export const chooseSyncFolder = async () => {
  const bridge = getSyncBridge();
  if (!bridge) throw new Error("Folder sync is available in the Windows and Android apps.");
  return bridge.chooseSyncFolder();
};

export const syncNow = async (folders: Folder[], notes: Note[]): Promise<SyncResult> => {
  const bridge = getSyncBridge();
  if (!bridge) throw new Error("Folder sync is available in the Windows and Android apps.");

  const folderLabel = await bridge.getSyncFolderLabel();
  if (!folderLabel) throw new Error("Choose a cloud sync folder first.");

  const localSnapshot = await buildSnapshot(folders, notes);
  const filenames = (await bridge.listSyncFiles()).filter(
    (filename) => filename.startsWith(SYNC_FILE_PREFIX) && filename.endsWith(SYNC_FILE_SUFFIX),
  );
  const remoteSnapshots: SyncSnapshot[] = [];

  for (const filename of filenames) {
    try {
      const parsed = JSON.parse(await bridge.readSyncFile(filename)) as unknown;
      if (validSnapshot(parsed)) remoteSnapshots.push(parsed);
    } catch {
      // A partially uploaded or unrelated file should not block the other devices.
    }
  }

  const snapshots =
    remoteSnapshots.length && isPristineInstall(localSnapshot)
      ? remoteSnapshots
      : [...remoteSnapshots, localSnapshot];
  const deleted = mergeTombstones(snapshots);
  const mergedFolders = mergeByUpdatedAt(
    snapshots.map((snapshot) => snapshot.folders),
    deleted.folders,
  ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const mergedNotes = mergeByUpdatedAt(
    snapshots.map((snapshot) => snapshot.notes),
    deleted.notes,
  ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const payload: ExportPayload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    folders: mergedFolders,
    notes: mergedNotes,
  };
  await replaceAllData(payload);
  await saveSyncTombstones(deleted);

  const mergedSnapshot: SyncSnapshot = {
    ...localSnapshot,
    updatedAt: payload.exportedAt,
    folders: mergedFolders,
    notes: mergedNotes,
    deleted,
  };
  await bridge.writeSyncFile(
    `${SYNC_FILE_PREFIX}${localSnapshot.deviceId}${SYNC_FILE_SUFFIX}`,
    JSON.stringify(mergedSnapshot),
  );

  return {
    folders: mergedFolders,
    notes: mergedNotes,
    folderLabel,
    deviceCount: new Set([
      ...snapshots.map((snapshot) => snapshot.deviceId),
      localSnapshot.deviceId,
    ]).size,
    syncedAt: payload.exportedAt,
  };
};
