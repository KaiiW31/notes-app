import { openDB, type DBSchema } from "idb";
import type { ExportPayload, Folder, Note, NotePage, SyncTombstones } from "./types";

const DB_NAME = "open-notes-local";
const DB_VERSION = 2;

const DEFAULT_FOLDER_ID = "folder-all-notes";
const IDEAS_FOLDER_ID = "folder-ideas";
const STUDY_FOLDER_ID = "folder-study";
const WELCOME_NOTE_ID = "note-welcome";

interface NotesDatabase extends DBSchema {
  folders: {
    key: string;
    value: Folder;
    indexes: { "by-updated": string };
  };
  notes: {
    key: string;
    value: Note;
    indexes: { "by-folder": string; "by-updated": string };
  };
  meta: {
    key: string;
    value: {
      key: string;
      value: unknown;
    };
  };
}

const dbPromise = openDB<NotesDatabase>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("folders")) {
      const folderStore = db.createObjectStore("folders", { keyPath: "id" });
      folderStore.createIndex("by-updated", "updatedAt");
    }

    if (!db.objectStoreNames.contains("notes")) {
      const noteStore = db.createObjectStore("notes", { keyPath: "id" });
      noteStore.createIndex("by-folder", "folderId");
      noteStore.createIndex("by-updated", "updatedAt");
    }

    if (!db.objectStoreNames.contains("meta")) {
      db.createObjectStore("meta", { keyPath: "key" });
    }
  },
});

const now = () => new Date().toISOString();
const TOMBSTONES_KEY = "sync-tombstones";
const emptyTombstones = (): SyncTombstones => ({ folders: {}, notes: {} });

export const makeId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`;

const normalizeFolder = (folder: Folder): Folder => ({
  ...folder,
  parentId: folder.parentId ?? null,
});

const normalizePages = (note: Note): NotePage[] => {
  const template = note.pageTemplate ?? "lined";
  const color = note.pageColor ?? "#f7f3e8";
  const pages = Array.isArray(note.pages) ? note.pages : [];

  if (!pages.length) {
    return [
      {
        id: `${note.id}-page-1`,
        contentHtml: note.contentHtml || "<p></p>",
        plainText: note.plainText ?? "",
        pageTemplate: template,
        pageColor: color,
      },
    ];
  }

  return pages.map((page, index) => ({
    id: page.id || `${note.id}-page-${index + 1}`,
    contentHtml: page.contentHtml || "<p></p>",
    plainText: page.plainText ?? "",
    pageTemplate: page.pageTemplate ?? template,
    pageColor: page.pageColor ?? color,
  }));
};

const normalizeNote = (note: Note): Note => ({
  ...note,
  favorite: note.favorite ?? false,
  locked: note.locked ?? false,
  pageTemplate: note.pageTemplate ?? "lined",
  pageStyle: note.pageStyle ?? "infinite",
  pageColor: note.pageColor ?? "#f7f3e8",
  pages: normalizePages(note),
  attachments: note.attachments ?? [],
  strokes: note.strokes ?? [],
});

export const seedData = async () => {
  const db = await dbPromise;
  const folderCount = await db.count("folders");
  const noteCount = await db.count("notes");

  if (folderCount > 0 || noteCount > 0) {
    return;
  }

  const timestamp = now();
  const inbox: Folder = {
    id: DEFAULT_FOLDER_ID,
    name: "All notes",
    color: "ink",
    parentId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const ideas: Folder = {
    id: IDEAS_FOLDER_ID,
    name: "Ideas",
    color: "mint",
    parentId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const study: Folder = {
    id: STUDY_FOLDER_ID,
    name: "Study",
    color: "sky",
    parentId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const welcome: Note = {
    id: WELCOME_NOTE_ID,
    title: "Untitled note",
    contentHtml: "<p></p>",
    plainText: "",
    folderId: DEFAULT_FOLDER_ID,
    tags: [],
    pinned: false,
    favorite: false,
    locked: false,
    pageTemplate: "lined",
    pageStyle: "pages",
    pageColor: "#f7f3e8",
    pages: [
      {
        id: `${WELCOME_NOTE_ID}-page-1`,
        contentHtml: "<p></p>",
        plainText: "",
        pageTemplate: "lined",
        pageColor: "#f7f3e8",
      },
    ],
    attachments: [],
    strokes: [],
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const tx = db.transaction(["folders", "notes"], "readwrite");
  await Promise.all([
    tx.objectStore("folders").put(inbox),
    tx.objectStore("folders").put(ideas),
    tx.objectStore("folders").put(study),
    tx.objectStore("notes").put(welcome),
    tx.done,
  ]);
};

export const getFolders = async () => {
  const db = await dbPromise;
  const folders = await db.getAll("folders");
  return folders.map(normalizeFolder).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

export const getNotes = async () => {
  const db = await dbPromise;
  const notes = await db.getAll("notes");
  return notes.map(normalizeNote).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const saveFolder = async (folder: Folder) => {
  const db = await dbPromise;
  await db.put("folders", folder);
};

export const saveNote = async (note: Note) => {
  const db = await dbPromise;
  await db.put("notes", note);
};

export const removeNote = async (noteId: string) => {
  const db = await dbPromise;
  const tx = db.transaction(["notes", "meta"], "readwrite");
  const record = await tx.objectStore("meta").get(TOMBSTONES_KEY);
  const tombstones = (record?.value as SyncTombstones | undefined) ?? emptyTombstones();
  await Promise.all([
    tx.objectStore("notes").delete(noteId),
    tx.objectStore("meta").put({
      key: TOMBSTONES_KEY,
      value: {
        folders: tombstones.folders,
        notes: { ...tombstones.notes, [noteId]: now() },
      },
    }),
  ]);
  await tx.done;
};

export const removeFolder = async (folderId: string) => {
  const db = await dbPromise;
  const tx = db.transaction(["folders", "notes", "meta"], "readwrite");
  const notes = await tx.objectStore("notes").getAll();
  const record = await tx.objectStore("meta").get(TOMBSTONES_KEY);
  const tombstones = (record?.value as SyncTombstones | undefined) ?? emptyTombstones();
  const fallbackFolder = DEFAULT_FOLDER_ID;
  await Promise.all(
    notes
      .filter((note) => note.folderId === folderId)
      .map((note) =>
        tx.objectStore("notes").put({
          ...note,
          folderId: fallbackFolder,
          updatedAt: now(),
        }),
      ),
  );
  await Promise.all([
    tx.objectStore("folders").delete(folderId),
    tx.objectStore("meta").put({
      key: TOMBSTONES_KEY,
      value: {
        folders: { ...tombstones.folders, [folderId]: now() },
        notes: tombstones.notes,
      },
    }),
  ]);
  await tx.done;
};

export const getSyncTombstones = async (): Promise<SyncTombstones> => {
  const db = await dbPromise;
  const record = await db.get("meta", TOMBSTONES_KEY);
  const tombstones = record?.value as SyncTombstones | undefined;
  return tombstones
    ? {
        folders: { ...tombstones.folders },
        notes: { ...tombstones.notes },
      }
    : emptyTombstones();
};

export const saveSyncTombstones = async (tombstones: SyncTombstones) => {
  const db = await dbPromise;
  await db.put("meta", { key: TOMBSTONES_KEY, value: tombstones });
};

export const replaceAllData = async (payload: ExportPayload) => {
  const db = await dbPromise;
  const tx = db.transaction(["folders", "notes"], "readwrite");
  await tx.objectStore("folders").clear();
  await tx.objectStore("notes").clear();
  await Promise.all([
    ...payload.folders.map((folder) => tx.objectStore("folders").put(normalizeFolder(folder))),
    ...payload.notes.map((note) => tx.objectStore("notes").put(normalizeNote(note))),
  ]);
  await tx.done;
};

export const createFolder = (name: string, color: Folder["color"]): Folder => {
  const timestamp = now();
  return {
    id: makeId("folder"),
    name,
    color,
    parentId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createNote = (folderId = DEFAULT_FOLDER_ID): Note => {
  const timestamp = now();
  const noteId = makeId("note");
  return {
    id: noteId,
    title: "Untitled note",
    contentHtml: "<p></p>",
    plainText: "",
    folderId,
    tags: [],
    pinned: false,
    favorite: false,
    locked: false,
    pageTemplate: "lined",
    pageStyle: "pages",
    pageColor: "#f7f3e8",
    pages: [
      {
        id: `${noteId}-page-1`,
        contentHtml: "<p></p>",
        plainText: "",
        pageTemplate: "lined",
        pageColor: "#f7f3e8",
      },
    ],
    attachments: [],
    strokes: [],
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const touchNote = (
  note: Note,
  updates: Partial<Omit<Note, "id" | "createdAt">>,
): Note => ({
  ...note,
  ...updates,
  updatedAt: now(),
});

export const touchFolder = (
  folder: Folder,
  updates: Partial<Omit<Folder, "id" | "createdAt">>,
): Folder => ({
  ...folder,
  ...updates,
  updatedAt: now(),
});

export const buildExportPayload = (folders: Folder[], notes: Note[]): ExportPayload => ({
  version: 2,
  exportedAt: now(),
  folders,
  notes,
});

export { DEFAULT_FOLDER_ID };
