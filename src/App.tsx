import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Archive,
  BookOpen,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Copy,
  Download,
  Eraser,
  FileAudio,
  FilePlus2,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Hand,
  Highlighter,
  Image as ImageIcon,
  ImageDown,
  Italic,
  Keyboard,
  LayoutGrid,
  LayoutList,
  ListFilter,
  Lock,
  Menu,
  Mic,
  MoreVertical,
  Move,
  Palette,
  PenLine,
  Pin,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  Share2,
  Sparkles,
  Star,
  Tags,
  Trash2,
  Type,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildExportPayload,
  createFolder,
  createNote,
  DEFAULT_FOLDER_ID,
  getFolders,
  getNotes,
  makeId,
  removeFolder,
  removeNote,
  replaceAllData,
  saveFolder,
  saveNote,
  seedData,
  touchFolder,
  touchNote,
} from "./storage";
import InkCanvas from "./InkCanvas";
import {
  chooseSyncFolder as openSyncFolderPicker,
  getConfiguredSyncFolder,
  getSyncBridge,
  saveNativeImage,
  shareNativeImage,
  shareNativeText,
  syncNow,
} from "./sync";
import type {
  DrawingPoint,
  DrawingStroke,
  DrawingTool,
  ExportPayload,
  Folder,
  FolderColor,
  Note,
  NoteAttachment,
  NotePage,
  PageStyle,
  PageTemplate,
  SortMode,
  ViewMode,
} from "./types";

const folderColors: FolderColor[] = ["ink", "sky", "mint", "coral", "gold", "violet"];
const inkColors = ["#1d4ed8", "#111827", "#0f766e", "#dc2626", "#b45309", "#7c3aed"];
const pageColors = ["#f7f3e8", "#ffffff", "#f4f7ff", "#f5f0ff", "#effaf3"];
const pageTemplates: PageTemplate[] = ["lined", "grid", "dots", "blank"];
const sortLabels: Record<SortMode, string> = {
  updated: "Date modified",
  created: "Date created",
  title: "Title",
};

const LOCK_KEY = "open-notes-local-passcode";

const formatDate = (date: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(date));

const formatLongDate = (date: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));

const htmlToPlainText = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent?.replace(/\s+/g, " ").trim() ?? "";
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const textToHtml = (text: string) => {
  const lines = text.split("\n");
  if (lines.length === 1 && !lines[0]) return "<p></p>";
  return lines.map((line) => `<p>${line ? escapeHtml(line) : "<br>"}</p>`).join("");
};

type PageTextConstraints = {
  maxLines: number;
  charsPerLine: number;
};

type PaginatedTextPage = {
  text: string;
  start: number;
  end: number;
};

const getVisualLineCount = (line: string, charsPerLine: number) =>
  Math.max(1, Math.ceil(Math.max(1, line.length) / charsPerLine));

const paginatePlainText = (
  text: string,
  constraints: PageTextConstraints,
): PaginatedTextPage[] => {
  const source = text.replace(/\r\n/g, "\n");
  if (!source) return [{ text: "", start: 0, end: 0 }];

  const lines = source.split("\n");
  const pages: PaginatedTextPage[] = [];
  let currentLines: string[] = [];
  let usedLines = 0;
  let pageStart = 0;
  let cursor = 0;

  lines.forEach((line, index) => {
    const visualLines = getVisualLineCount(line, constraints.charsPerLine);
    const hasCurrentText = currentLines.length > 0;
    if (hasCurrentText && usedLines + visualLines > constraints.maxLines) {
      const pageText = currentLines.join("\n");
      pages.push({ text: pageText, start: pageStart, end: cursor - 1 });
      pageStart = cursor;
      currentLines = [];
      usedLines = 0;
    }

    currentLines.push(line);
    usedLines += visualLines;
    cursor += line.length + (index < lines.length - 1 ? 1 : 0);
  });

  const pageText = currentLines.join("\n");
  pages.push({ text: pageText, start: pageStart, end: source.length });
  return pages;
};

const getNotePages = (note: Note): NotePage[] => {
  if (note.pages?.length) {
    return note.pages.map((page, index) => ({
      id: page.id || `${note.id}-page-${index + 1}`,
      contentHtml: page.contentHtml || textToHtml(page.plainText ?? ""),
      plainText: page.plainText ?? htmlToPlainText(page.contentHtml || ""),
      pageTemplate: page.pageTemplate ?? note.pageTemplate,
      pageColor: page.pageColor ?? note.pageColor,
    }));
  }

  return [
    {
      id: `${note.id}-page-1`,
      contentHtml: note.contentHtml || "<p></p>",
      plainText: note.plainText || htmlToPlainText(note.contentHtml || ""),
      pageTemplate: note.pageTemplate,
      pageColor: note.pageColor,
    },
  ];
};

const createPageFromText = (note: Note, text: string): NotePage => ({
  id: makeId("page"),
  contentHtml: textToHtml(text),
  plainText: text,
  pageTemplate: note.pageTemplate,
  pageColor: note.pageColor,
});

const mergePageText = (pages: NotePage[]) =>
  pages
    .map((page) => page.plainText)
    .join("\n")
    .replace(/\n+$/g, "");

const getPageTextConstraints = (element: HTMLTextAreaElement | null): PageTextConstraints => {
  if (!element) return { maxLines: 40, charsPerLine: 76 };

  const styles = window.getComputedStyle(element);
  const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
  const fontSize = Number.parseFloat(styles.fontSize) || 16;
  const maxLines = Math.max(8, Math.floor(element.clientHeight / lineHeight) - 1);
  const charsPerLine = Math.max(24, Math.floor(element.clientWidth / (fontSize * 0.52)));
  return { maxLines, charsPerLine };
};

const attachmentKindForFile = (file: File): NoteAttachment["kind"] => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return "file";
};

const readBlobAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const fileToAttachment = async (file: File): Promise<NoteAttachment> => ({
  id: makeId("attachment"),
  kind: attachmentKindForFile(file),
  name: file.name,
  mimeType: file.type || "application/octet-stream",
  size: file.size,
  dataUrl: await readBlobAsDataUrl(file),
  createdAt: new Date().toISOString(),
});

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const downloadJson = (payload: ExportPayload) => {
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `open-notes-sync-${new Date().toISOString().slice(0, 10)}.json`,
  );
};

const safeFilename = (value: string) =>
  (value || "Untitled note").replace(/[<>:"/\\|?*]+/g, "").slice(0, 80) || "Untitled note";

const useDebouncedEffect = (callback: () => void, deps: unknown[], delay: number) => {
  useEffect(() => {
    const timeout = window.setTimeout(callback, delay);
    return () => window.clearTimeout(timeout);
  }, deps);
};

const distance = (a: DrawingPoint, b: DrawingPoint) => Math.hypot(a.x - b.x, a.y - b.y);

type LaunchRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PointerSample = {
  point: DrawingPoint;
  pageId?: string;
};

type EditorTouchGesture =
  | {
      mode: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      scrollLeft: number;
      scrollTop: number;
      active: boolean;
    }
  | {
      mode: "pull";
      pointerId: number;
      startX: number;
      startY: number;
      active: boolean;
    }
  | {
      mode: "pinch";
      startDistance: number;
      startZoom: number;
    };

function App() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("all");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isCompactLayout, setIsCompactLayout] = useState(
    () => window.matchMedia("(max-width: 900px)").matches,
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => !window.matchMedia("(max-width: 900px)").matches,
  );
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isEditorClosing, setIsEditorClosing] = useState(false);
  const [isLaunchingNote, setIsLaunchingNote] = useState(false);
  const [launchRect, setLaunchRect] = useState<LaunchRect | null>(null);
  const [isManageFoldersOpen, setIsManageFoldersOpen] = useState(false);
  const [isFolderEditMode, setIsFolderEditMode] = useState(false);
  const [selectedManageFolderId, setSelectedManageFolderId] = useState<string | null>(null);
  const [isTrashEditMode, setIsTrashEditMode] = useState(false);
  const [selectedTrashIds, setSelectedTrashIds] = useState<string[]>([]);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isMoreMenuClosing, setIsMoreMenuClosing] = useState(false);
  const [isNoteEditMode, setIsNoteEditMode] = useState(false);
  const [selectedLibraryNoteIds, setSelectedLibraryNoteIds] = useState<string[]>([]);
  const [isNoteActionBarVisible, setIsNoteActionBarVisible] = useState(false);
  const [isNoteActionBarClosing, setIsNoteActionBarClosing] = useState(false);
  const [pressedLibraryNoteId, setPressedLibraryNoteId] = useState<string | null>(null);
  const [isNoteListReordering, setIsNoteListReordering] = useState(false);
  const [isSyncPanelOpen, setIsSyncPanelOpen] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [isCoverDialogOpen, setIsCoverDialogOpen] = useState(false);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [coverTemplate, setCoverTemplate] = useState<PageTemplate>("lined");
  const [coverColor, setCoverColor] = useState(pageColors[0]);
  const [editorPageCount, setEditorPageCount] = useState(1);
  const [currentEditorPage, setCurrentEditorPage] = useState(1);
  const [draftTitle, setDraftTitle] = useState("");
  const [status, setStatus] = useState("Saved");
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [folderDialogParentId, setFolderDialogParentId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderColor, setFolderColor] = useState<FolderColor>("mint");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [pinFavoritesToTop, setPinFavoritesToTop] = useState(true);
  const [activeTool, setActiveTool] = useState<"type" | "pen" | "marker" | "eraser">("type");
  const [inkColor, setInkColor] = useState(inkColors[0]);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [drawWithTouch, setDrawWithTouch] = useState(false);
  const [activeStroke, setActiveStroke] = useState<DrawingStroke | null>(null);
  const [isEditorMenuOpen, setIsEditorMenuOpen] = useState(false);
  const [isPageManagerOpen, setIsPageManagerOpen] = useState(false);
  const [openPageMenuId, setOpenPageMenuId] = useState<string | null>(null);
  const [editorZoom, setEditorZoom] = useState(1);
  const [pagePullProgress, setPagePullProgress] = useState(0);
  const [editorSwipeOffset, setEditorSwipeOffset] = useState(0);
  const [unlockedNoteIds, setUnlockedNoteIds] = useState<string[]>([]);
  const [unlockInput, setUnlockInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [lastSyncLabel, setLastSyncLabel] = useState("Local only");
  const [syncFolderLabel, setSyncFolderLabel] = useState<string | null>(null);
  const [syncDeviceCount, setSyncDeviceCount] = useState(1);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isStorageReady, setIsStorageReady] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const paperStageRef = useRef<HTMLElement | null>(null);
  const paperSpreadRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pageTextAreaRefs = useRef(new Map<number, HTMLTextAreaElement>());
  const selectedNoteIdRef = useRef<string | null>(null);
  const draftTitleRef = useRef("");
  const activeStrokeRef = useRef<DrawingStroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointerTypeRef = useRef("");
  const activeInputToolRef = useRef<"pen" | "marker" | "eraser" | null>(null);
  const activeInkPageIdRef = useRef<string | undefined>(undefined);
  const inkFrameRef = useRef<number | null>(null);
  const pendingInkRenderRef = useRef(false);
  const eraserPointsRef = useRef<PointerSample[]>([]);
  const lastPenInputAtRef = useRef(0);
  const syncInProgressRef = useRef(false);
  const foldersRef = useRef<Folder[]>([]);
  const notesRef = useRef<Note[]>([]);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ noteId: string; x: number; y: number } | null>(null);
  const suppressNoteClickRef = useRef(false);
  const editorSwipeRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const editorSwipeOffsetRef = useRef(0);
  const editorTouchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const editorTouchGestureRef = useRef<EditorTouchGesture | null>(null);
  const pagePullProgressRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const launchTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const moreMenuTimerRef = useRef<number | null>(null);
  const noteActionBarTimerRef = useRef<number | null>(null);
  const selectionPressTimerRef = useRef<number | null>(null);
  const reorderFlipTimerRef = useRef<number | null>(null);
  const reorderDoneTimerRef = useRef<number | null>(null);
  const lastAutoScrolledPageRef = useRef(1);
  const pendingPageFocusRef = useRef<{ pageIndex: number; caretOffset: number } | null>(null);
  const pageGlideFrameRef = useRef<number | null>(null);

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );

  const selectedNoteUnlocked =
    !selectedNote?.locked || (selectedNote ? unlockedNoteIds.includes(selectedNote.id) : false);
  const selectedNotePages = useMemo(
    () => (selectedNote ? getNotePages(selectedNote) : []),
    [selectedNote],
  );

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId;
  }, [selectedNoteId]);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(
    () => () => {
      if (launchTimerRef.current) window.clearTimeout(launchTimerRef.current);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      if (moreMenuTimerRef.current) window.clearTimeout(moreMenuTimerRef.current);
      if (noteActionBarTimerRef.current) window.clearTimeout(noteActionBarTimerRef.current);
      if (selectionPressTimerRef.current) window.clearTimeout(selectionPressTimerRef.current);
      if (reorderFlipTimerRef.current) window.clearTimeout(reorderFlipTimerRef.current);
      if (reorderDoneTimerRef.current) window.clearTimeout(reorderDoneTimerRef.current);
      if (pageGlideFrameRef.current) window.cancelAnimationFrame(pageGlideFrameRef.current);
      if (inkFrameRef.current) window.cancelAnimationFrame(inkFrameRef.current);
      if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const updateLayout = () => {
      setIsCompactLayout(media.matches);
      setIsSidebarOpen(!media.matches);
    };
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    draftTitleRef.current = draftTitle;
  }, [draftTitle]);

  const updateNoteById = (
    noteId: string,
    updates: Partial<Omit<Note, "id" | "createdAt">>,
    nextStatus = "Saving...",
  ) => {
    setNotes((current) =>
      current.map((note) => (note.id === noteId ? touchNote(note, updates) : note)),
    );
    setStatus(nextStatus);
  };

  const editor = useEditor({
    extensions: [StarterKit],
    content: selectedNote?.contentHtml ?? "<p></p>",
    editorProps: {
      attributes: {
        class: "editor-surface",
        "aria-label": "Note body",
      },
      handleKeyDown(_view, event) {
        if (event.ctrlKey && (event.key === "Enter" || event.key === "Backspace")) {
          event.stopPropagation();
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      const noteId = selectedNoteIdRef.current;
      if (!noteId) return;
      const html = editor.getHTML();
      const plainText = htmlToPlainText(html);
      setNotes((current) =>
        current.map((note) =>
          note.id === noteId
            ? touchNote(note, {
                contentHtml: html,
                plainText,
                title:
                  draftTitleRef.current.trim() ||
                  plainText.slice(0, 60) ||
                  "Untitled note",
              })
            : note,
        ),
      );
      setStatus("Saving...");
    },
  });

  const selectEditorTool = (tool: "type" | "pen" | "marker" | "eraser") => {
    setActiveTool(tool);
    if (tool === "type") {
      editor?.setEditable(true);
      return;
    }

    editor?.setEditable(false);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) focused.blur();
    window.getSelection()?.removeAllRanges();
  };

  useEffect(() => {
    editor?.setEditable(activeTool === "type");
    if (activeTool !== "type") {
      const focused = document.activeElement;
      if (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) {
        focused.blur();
      }
    }
  }, [activeTool, editor]);

  useEffect(() => {
    setIsPageManagerOpen(false);
    setOpenPageMenuId(null);
    setPagePullProgress(0);
    pagePullProgressRef.current = 0;
    setEditorZoom(1);
    editorTouchPointsRef.current.clear();
    editorTouchGestureRef.current = null;
  }, [selectedNoteId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await seedData();
      const [storedFolders, storedNotes] = await Promise.all([getFolders(), getNotes()]);
      if (cancelled) return;
      const launchedFromShortcut =
        new URLSearchParams(window.location.search).get("action") === "new-note";
      const shortcutNote = launchedFromShortcut ? createNote(DEFAULT_FOLDER_ID) : null;
      if (shortcutNote) {
        await saveNote(shortcutNote);
        window.history.replaceState({}, "", window.location.pathname);
      }
      const nextNotes = shortcutNote ? [shortcutNote, ...storedNotes] : storedNotes;
      setFolders(storedFolders);
      setNotes(nextNotes);
      setSelectedNoteId(nextNotes[0]?.id ?? null);
      if (shortcutNote) setIsEditorOpen(true);
      setStatus("Saved");
      setIsStorageReady(true);
    };
    load().catch(() => setStatus("Storage unavailable"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    getConfiguredSyncFolder()
      .then((label) => {
        setSyncFolderLabel(label);
        if (label) setLastSyncLabel(`Ready to sync with ${label}`);
      })
      .catch(() => setSyncFolderLabel(null));
  }, []);

  useEffect(() => {
    if (!selectedNote) {
      setDraftTitle("");
      editor?.commands.setContent("<p></p>", false);
      return;
    }

    setDraftTitle(selectedNote.title);
    if (!selectedNoteUnlocked) {
      editor?.commands.setContent("<p></p>", false);
      return;
    }

    if (editor && editor.getHTML() !== selectedNote.contentHtml) {
      editor.commands.setContent(selectedNote.contentHtml || "<p></p>", false);
    }
  }, [selectedNoteId, selectedNoteUnlocked, editor]);

  useDebouncedEffect(
    () => {
      const dirtyNote = notes.find((note) => note.id === selectedNoteId);
      if (!dirtyNote) return;
      saveNote(dirtyNote)
        .then(() => {
          setStatus("Saved");
          setLastSyncLabel(`Saved ${formatLongDate(dirtyNote.updatedAt)}`);
        })
        .catch(() => setStatus("Could not save"));
    },
    [notes, selectedNoteId],
    450,
  );

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    notes
      .filter((note) => !note.archived)
      .forEach((note) => counts.set(note.folderId, (counts.get(note.folderId) ?? 0) + 1));
    return counts;
  }, [notes]);

  const activeFolder = folders.find((folder) => folder.id === selectedFolderId);
  const userFolders = folders.filter((folder) => folder.id !== DEFAULT_FOLDER_ID);
  const topLevelFolders = userFolders.filter((folder) => !folder.parentId);
  const allNotesCount = notes.filter((note) => !note.archived).length;
  const favoriteCount = notes.filter((note) => note.favorite && !note.archived).length;
  const trashCount = notes.filter((note) => note.archived).length;
  const isFolderOverview = selectedFolderId === "folders";

  const pageTitle =
    selectedFolderId === "all"
      ? "All notes"
      : selectedFolderId === "favorites"
        ? "Favorites"
        : selectedFolderId === "archive"
          ? "Trash"
          : isFolderOverview
            ? "Folders"
            : activeFolder?.name ?? "All notes";

  const filteredNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const byLocation = notes.filter((note) => {
      if (selectedFolderId === "archive") return note.archived;
      if (selectedFolderId === "favorites") return note.favorite && !note.archived;
      if (selectedFolderId === "all" || selectedFolderId === "folders") return !note.archived;
      return note.folderId === selectedFolderId && !note.archived;
    });

    const searched = normalizedQuery
      ? byLocation.filter((note) => {
          const attachmentNames = note.attachments.map((attachment) => attachment.name).join(" ");
          return `${note.title} ${note.locked ? "" : note.plainText} ${note.tags.join(" ")} ${attachmentNames}`
            .toLowerCase()
            .includes(normalizedQuery);
        })
      : byLocation;

    return searched.sort((a, b) => {
      if (pinFavoritesToTop) {
        const priority = Number(b.pinned) - Number(a.pinned) || Number(b.favorite) - Number(a.favorite);
        if (priority) return priority;
      }

      if (sortMode === "title") return a.title.localeCompare(b.title);
      if (sortMode === "created") return b.createdAt.localeCompare(a.createdAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [notes, pinFavoritesToTop, query, selectedFolderId, sortMode]);

  const visibleNoteIds = useMemo(() => filteredNotes.map((note) => note.id), [filteredNotes]);
  const selectedLibraryNotes = useMemo(
    () => notes.filter((note) => selectedLibraryNoteIds.includes(note.id)),
    [notes, selectedLibraryNoteIds],
  );
  const selectedNotesAreAllFavorite =
    selectedLibraryNotes.length > 0 && selectedLibraryNotes.every((note) => note.favorite);
  const selectedNotesAttachmentCount = selectedLibraryNotes.reduce(
    (total, note) => total + note.attachments.length,
    0,
  );
  const selectedNotesWordCount = selectedLibraryNotes.reduce((total, note) => {
    const text = note.plainText || htmlToPlainText(note.contentHtml);
    return total + text.split(/\s+/).filter(Boolean).length;
  }, 0);
  const selectedNotesFolderLabel =
    Array.from(
      new Set(
        selectedLibraryNotes.map(
          (note) => folders.find((folder) => folder.id === note.folderId)?.name ?? "All notes",
        ),
      ),
    ).join(", ") || "All notes";
  const selectedNotesUpdatedValues = selectedLibraryNotes.map((note) => note.updatedAt).sort();
  const selectedNotesCreatedValues = selectedLibraryNotes.map((note) => note.createdAt).sort();
  const selectedNotesUpdatedLabel =
    selectedNotesUpdatedValues[selectedNotesUpdatedValues.length - 1] ?? new Date().toISOString();
  const selectedNotesCreatedLabel = selectedNotesCreatedValues[0] ?? new Date().toISOString();
  const allVisibleNotesSelected =
    visibleNoteIds.length > 0 && visibleNoteIds.every((id) => selectedLibraryNoteIds.includes(id));
  const shouldShowNoteActionBar = isNoteEditMode && selectedLibraryNoteIds.length > 0;

  const updateEditorPageMetrics = () => {
    const stage = paperStageRef.current;
    const spread = paperSpreadRef.current;

    if (!stage || !spread || selectedNote?.pageStyle !== "pages") {
      setEditorPageCount((value) => (value === 1 ? value : 1));
      setCurrentEditorPage((value) => (value === 1 ? value : 1));
      lastAutoScrolledPageRef.current = 1;
      return;
    }

    const pageElements = Array.from(spread.querySelectorAll<HTMLElement>(".paper-page"));
    const nextPageCount = Math.max(1, selectedNotePages.length || pageElements.length);
    const stageRect = stage.getBoundingClientRect();
    const stageCenterX = stageRect.left + stageRect.width / 2;
    const visiblePage =
      pageElements.length > 0
        ? pageElements.reduce(
            (closest, pageElement, index) => {
              const rect = pageElement.getBoundingClientRect();
              const distanceFromCenter = Math.abs(rect.left + rect.width / 2 - stageCenterX);
              return distanceFromCenter < closest.distance
                ? { distance: distanceFromCenter, page: index + 1 }
                : closest;
            },
            { distance: Number.POSITIVE_INFINITY, page: 1 },
          ).page
        : 1;
    const nextCurrentPage = Math.min(nextPageCount, Math.max(1, visiblePage));

    setEditorPageCount((value) => (value === nextPageCount ? value : nextPageCount));
    setCurrentEditorPage((value) => (value === nextCurrentPage ? value : nextCurrentPage));
  };

  const handlePaperStageWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (selectedNote?.pageStyle !== "pages") return;
    const stage = event.currentTarget;
    if (stage.scrollWidth <= stage.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    event.preventDefault();
    stage.scrollLeft += event.deltaY;
  };

  const focusPagedTextarea = (pageIndex: number, caretOffset: number) => {
    window.requestAnimationFrame(() => {
      const textarea = pageTextAreaRefs.current.get(pageIndex);
      const page = paperSpreadRef.current?.querySelectorAll<HTMLElement>(".paper-page")[pageIndex];
      if (!textarea || !page) return;

      textarea.focus();
      const safeCaret = Math.min(textarea.value.length, Math.max(0, caretOffset));
      textarea.setSelectionRange(safeCaret, safeCaret);
      page.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      lastAutoScrolledPageRef.current = pageIndex + 1;
      setCurrentEditorPage(pageIndex + 1);
    });
  };

  const commitPagedPages = (
    note: Note,
    nextPages: NotePage[],
    caretPageIndex?: number,
    caretOffset = 0,
  ) => {
    const plainText = mergePageText(nextPages);
    const contentHtml = nextPages.map((page) => page.contentHtml).join("") || "<p></p>";

    setNotes((current) =>
      current.map((item) =>
        item.id === note.id
          ? touchNote(item, {
              pages: nextPages,
              contentHtml,
              plainText,
              title:
                draftTitleRef.current.trim() ||
                plainText.slice(0, 60) ||
                "Untitled note",
            })
          : item,
      ),
    );
    setStatus("Saving...");
    setEditorPageCount(nextPages.length);

    if (caretPageIndex !== undefined) {
      pendingPageFocusRef.current = { pageIndex: caretPageIndex, caretOffset };
      focusPagedTextarea(caretPageIndex, caretOffset);
    }
  };

  const handlePagedTextChange = (
    pageIndex: number,
    value: string,
    selectionStart: number,
  ) => {
    if (!selectedNote) return;

    const pages = getNotePages(selectedNote);
    const currentPage = pages[pageIndex];
    if (!currentPage) return;

    const constraints = getPageTextConstraints(pageTextAreaRefs.current.get(pageIndex) ?? null);
    const paginatedPages = paginatePlainText(value, constraints);
    const replacementPages = paginatedPages.map((page, index) => {
      const previousPage = index === 0 ? currentPage : undefined;
      return {
        id: previousPage?.id ?? makeId("page"),
        contentHtml: textToHtml(page.text),
        plainText: page.text,
        pageTemplate: currentPage.pageTemplate ?? selectedNote.pageTemplate,
        pageColor: currentPage.pageColor ?? selectedNote.pageColor,
      };
    });
    const caretPage = paginatedPages.findIndex(
      (page, index) =>
        selectionStart >= page.start &&
        (selectionStart <= page.end || index === paginatedPages.length - 1),
    );
    const safeCaretPage = Math.max(0, caretPage);
    const nextPageIndex = pageIndex + safeCaretPage;
    const caretOffset = Math.max(0, selectionStart - paginatedPages[safeCaretPage].start);
    const nextPages = [
      ...pages.slice(0, pageIndex),
      ...replacementPages,
      ...pages.slice(pageIndex + 1),
    ];

    commitPagedPages(selectedNote, nextPages, nextPageIndex, caretOffset);
  };

  const handlePagedPageBreak = (
    pageIndex: number,
    selectionStart: number,
    selectionEnd: number,
  ) => {
    if (!selectedNote) return;

    const pages = getNotePages(selectedNote);
    const currentPage = pages[pageIndex];
    if (!currentPage) return;

    const beforeBreak = currentPage.plainText.slice(0, selectionStart);
    const afterBreak = currentPage.plainText.slice(selectionEnd);
    const updatedCurrentPage = {
      ...currentPage,
      contentHtml: textToHtml(beforeBreak),
      plainText: beforeBreak,
    };
    const nextPage = createPageFromText(selectedNote, afterBreak);
    const nextPages = [
      ...pages.slice(0, pageIndex),
      updatedCurrentPage,
      nextPage,
      ...pages.slice(pageIndex + 1),
    ];

    commitPagedPages(selectedNote, nextPages, pageIndex + 1, 0);
  };

  const handlePagedDeletePreviousWord = (
    pageIndex: number,
    selectionStart: number,
    selectionEnd: number,
  ) => {
    if (!selectedNote) return;

    const pages = getNotePages(selectedNote);
    const currentPage = pages[pageIndex];
    if (!currentPage) return;

    const text = currentPage.plainText;
    const deleteFrom =
      selectionStart === selectionEnd
        ? Math.max(0, text.slice(0, selectionStart).search(/\s*\S+$/))
        : selectionStart;
    const nextText =
      text.slice(0, deleteFrom) +
      text.slice(selectionStart === selectionEnd ? selectionStart : selectionEnd);
    const nextPage = {
      ...currentPage,
      contentHtml: textToHtml(nextText),
      plainText: nextText,
    };
    const nextPages = [
      ...pages.slice(0, pageIndex),
      nextPage,
      ...pages.slice(pageIndex + 1),
    ];

    commitPagedPages(selectedNote, nextPages, pageIndex, deleteFrom);
  };

  const handlePagedTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const hasCommandModifier =
      event.ctrlKey ||
      event.metaKey ||
      event.getModifierState("Control") ||
      event.getModifierState("Meta");

    if (hasCommandModifier && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const pageIndex = Number(event.currentTarget.dataset.pageIndex);
      if (Number.isFinite(pageIndex)) {
        handlePagedPageBreak(
          pageIndex,
          event.currentTarget.selectionStart,
          event.currentTarget.selectionEnd,
        );
      }
      return;
    }

    if (hasCommandModifier && event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      const pageIndex = Number(event.currentTarget.dataset.pageIndex);
      if (Number.isFinite(pageIndex)) {
        handlePagedDeletePreviousWord(
          pageIndex,
          event.currentTarget.selectionStart,
          event.currentTarget.selectionEnd,
        );
      }
    }
  };

  const pageStrokes = (note: Note, page: NotePage, pageIndex: number) =>
    note.strokes.filter(
      (stroke) => stroke.pageId === page.id || (!stroke.pageId && pageIndex === 0),
    );

  const commitPageStructure = (
    nextPages: NotePage[],
    nextStrokes = selectedNote?.strokes ?? [],
    nextStatus = "Saving...",
  ) => {
    if (!selectedNote || !nextPages.length) return;
    const plainText = mergePageText(nextPages);
    updateNoteById(
      selectedNote.id,
      {
        pages: nextPages,
        strokes: nextStrokes,
        plainText,
        contentHtml: nextPages.map((page) => page.contentHtml).join("") || "<p></p>",
      },
      nextStatus,
    );
    setEditorPageCount(nextPages.length);
  };

  const scrollToEditorPage = (pageIndex: number) => {
    window.requestAnimationFrame(() => {
      const page = paperSpreadRef.current?.querySelectorAll<HTMLElement>(".paper-page")[pageIndex];
      page?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      setCurrentEditorPage(pageIndex + 1);
    });
  };

  const insertPageAfter = (pageIndex: number) => {
    if (!selectedNote) return;
    if (selectedNote.pageStyle !== "pages") {
      updateNoteById(selectedNote.id, {
        pageStyle: "pages",
        pages: getNotePages(selectedNote),
      });
    }
    const pages = getNotePages(selectedNote);
    const reference = pages[Math.min(pageIndex, pages.length - 1)];
    const page: NotePage = {
      id: makeId("page"),
      contentHtml: "<p></p>",
      plainText: "",
      pageTemplate: reference?.pageTemplate ?? selectedNote.pageTemplate,
      pageColor: reference?.pageColor ?? selectedNote.pageColor,
    };
    const insertionIndex = Math.min(pages.length, Math.max(0, pageIndex + 1));
    commitPageStructure(
      [...pages.slice(0, insertionIndex), page, ...pages.slice(insertionIndex)],
      selectedNote.strokes,
      "Page added",
    );
    setOpenPageMenuId(null);
    scrollToEditorPage(insertionIndex);
  };

  const movePage = (pageIndex: number, direction: -1 | 1) => {
    if (!selectedNote) return;
    const pages = getNotePages(selectedNote);
    const targetIndex = pageIndex + direction;
    if (targetIndex < 0 || targetIndex >= pages.length) return;
    const nextPages = [...pages];
    [nextPages[pageIndex], nextPages[targetIndex]] = [
      nextPages[targetIndex],
      nextPages[pageIndex],
    ];
    commitPageStructure(nextPages, selectedNote.strokes, "Pages reordered");
    setOpenPageMenuId(null);
    scrollToEditorPage(targetIndex);
  };

  const duplicatePage = (pageIndex: number) => {
    if (!selectedNote) return;
    const pages = getNotePages(selectedNote);
    const source = pages[pageIndex];
    if (!source) return;
    const copy: NotePage = { ...source, id: makeId("page") };
    const copiedStrokes = pageStrokes(selectedNote, source, pageIndex).map((stroke) => ({
      ...stroke,
      id: makeId("stroke"),
      pageId: copy.id,
      points: stroke.points.map((point) => ({ ...point })),
      createdAt: new Date().toISOString(),
    }));
    commitPageStructure(
      [...pages.slice(0, pageIndex + 1), copy, ...pages.slice(pageIndex + 1)],
      [...selectedNote.strokes, ...copiedStrokes],
      "Page duplicated",
    );
    setOpenPageMenuId(null);
    scrollToEditorPage(pageIndex + 1);
  };

  const erasePage = (pageIndex: number) => {
    if (!selectedNote) return;
    const pages = getNotePages(selectedNote);
    const page = pages[pageIndex];
    if (!page) return;
    const nextPages = pages.map((item, index) =>
      index === pageIndex
        ? { ...item, plainText: "", contentHtml: "<p></p>" }
        : item,
    );
    const nextStrokes = selectedNote.strokes.filter(
      (stroke) => stroke.pageId !== page.id && !(!stroke.pageId && pageIndex === 0),
    );
    commitPageStructure(nextPages, nextStrokes, "Page erased");
    setOpenPageMenuId(null);
  };

  const deletePage = (pageIndex: number) => {
    if (!selectedNote) return;
    const pages = getNotePages(selectedNote);
    if (pages.length === 1) {
      erasePage(0);
      return;
    }
    const page = pages[pageIndex];
    if (!page) return;
    const nextPages = pages.filter((_, index) => index !== pageIndex);
    const nextStrokes = selectedNote.strokes.filter(
      (stroke) => stroke.pageId !== page.id && !(!stroke.pageId && pageIndex === 0),
    );
    commitPageStructure(nextPages, nextStrokes, "Page deleted");
    setOpenPageMenuId(null);
    scrollToEditorPage(Math.max(0, pageIndex - 1));
  };

  const copyPage = async (pageIndex: number) => {
    if (!selectedNote) return;
    const page = getNotePages(selectedNote)[pageIndex];
    if (!page) return;
    try {
      await navigator.clipboard.writeText(page.plainText);
      setStatus("Page copied");
    } catch {
      setStatus("Clipboard unavailable");
    }
    setOpenPageMenuId(null);
  };

  const renderPagePng = (page: NotePage, pageIndex: number) => {
    if (!selectedNote) return "";
    const width = 1240;
    const height = 1600;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return "";

    context.fillStyle = page.pageColor;
    context.fillRect(0, 0, width, height);
    context.lineWidth = 1;
    if (page.pageTemplate === "lined") {
      context.strokeStyle = "rgba(69,92,124,0.22)";
      for (let y = 92; y < height; y += 38) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
      context.strokeStyle = "rgba(210,72,72,0.46)";
      context.beginPath();
      context.moveTo(150, 0);
      context.lineTo(150, height);
      context.stroke();
    } else if (page.pageTemplate === "grid") {
      context.strokeStyle = "rgba(63,87,120,0.16)";
      for (let x = 0; x < width; x += 38) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = 0; y < height; y += 38) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
    } else if (page.pageTemplate === "dots") {
      context.fillStyle = "rgba(43,61,87,0.3)";
      for (let x = 28; x < width; x += 34) {
        for (let y = 28; y < height; y += 34) {
          context.beginPath();
          context.arc(x, y, 1.6, 0, Math.PI * 2);
          context.fill();
        }
      }
    }

    context.fillStyle = "#202124";
    context.font = "28px sans-serif";
    context.textBaseline = "top";
    const left = page.pageTemplate === "lined" ? 182 : 88;
    const maxTextWidth = width - left - 88;
    let textY = 76;
    for (const paragraph of page.plainText.split("\n")) {
      const words = paragraph.split(/\s+/);
      let line = "";
      if (!paragraph) textY += 38;
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && context.measureText(candidate).width > maxTextWidth) {
          context.fillText(line, left, textY);
          line = word;
          textY += 38;
        } else {
          line = candidate;
        }
      }
      if (line) context.fillText(line, left, textY);
      textY += 38;
    }

    for (const stroke of pageStrokes(selectedNote, page, pageIndex)) {
      if (!stroke.points.length) continue;
      context.save();
      context.strokeStyle = stroke.color;
      context.fillStyle = stroke.color;
      context.globalAlpha = stroke.tool === "marker" ? 0.32 : 1;
      context.lineCap = "round";
      context.lineJoin = "round";
      const first = stroke.points[0];
      if (stroke.points.length === 1) {
        context.beginPath();
        context.arc((first.x / 100) * width, (first.y / 100) * height, stroke.width / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        for (let index = 1; index < stroke.points.length; index += 1) {
          const previous = stroke.points[index - 1];
          const point = stroke.points[index];
          const pressure = stroke.tool === "marker" ? 1 : ((previous.pressure ?? 0.5) + (point.pressure ?? 0.5)) / 2;
          context.lineWidth = Math.max(1.3, stroke.width * (stroke.tool === "marker" ? 1 : 0.5 + pressure * 0.82));
          context.beginPath();
          context.moveTo((previous.x / 100) * width, (previous.y / 100) * height);
          context.lineTo((point.x / 100) * width, (point.y / 100) * height);
          context.stroke();
        }
      }
      context.restore();
    }
    return canvas.toDataURL("image/png");
  };

  const sharePage = async (pageIndex: number) => {
    if (!selectedNote) return;
    const page = getNotePages(selectedNote)[pageIndex];
    if (!page) return;
    const dataUrl = renderPagePng(page, pageIndex);
    if (!dataUrl) return;
    try {
      await shareNativeImage(`${selectedNote.title} - page ${pageIndex + 1}`, dataUrl);
      setStatus("Share opened");
    } catch {
      setStatus("Could not share page");
    }
    setOpenPageMenuId(null);
  };

  const savePageImage = async (pageIndex: number) => {
    if (!selectedNote) return;
    const page = getNotePages(selectedNote)[pageIndex];
    if (!page) return;
    const filename = `${safeFilename(selectedNote.title)}-page-${pageIndex + 1}.png`;
    const dataUrl = renderPagePng(page, pageIndex);
    if (!dataUrl) return;
    try {
      await saveNativeImage(filename, dataUrl);
      setStatus("Page image saved");
    } catch {
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = filename;
      anchor.click();
      setStatus("Page image downloaded");
    }
    setOpenPageMenuId(null);
  };

  const handleShareNote = async () => {
    if (!selectedNote) return;
    const text = getNotePages(selectedNote)
      .map((page, index) => `Page ${index + 1}\n${page.plainText}`)
      .join("\n\n");
    try {
      await shareNativeText(selectedNote.title || "Untitled note", text);
      setStatus("Share opened");
    } catch {
      setStatus("Could not share note");
    }
  };

  const cancelActiveInk = () => {
    activePointerIdRef.current = null;
    activePointerTypeRef.current = "";
    activeInputToolRef.current = null;
    activeInkPageIdRef.current = undefined;
    activeStrokeRef.current = null;
    eraserPointsRef.current = [];
    pendingInkRenderRef.current = false;
    setActiveStroke(null);
  };

  const setSafeEditorZoom = (value: number) => {
    setEditorZoom(Math.min(2.5, Math.max(0.45, Math.round(value * 100) / 100)));
  };

  const handleStagePointerDownCapture = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;
    const stage = event.currentTarget;
    const points = editorTouchPointsRef.current;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (points.size >= 2) {
      const [first, second] = [...points.values()];
      cancelActiveInk();
      editorTouchGestureRef.current = {
        mode: "pinch",
        startDistance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
        startZoom: editorZoom,
      };
      for (const pointerId of points.keys()) {
        try {
          stage.setPointerCapture(pointerId);
        } catch {
          // A WebView may have already reassigned the first pointer.
        }
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    const atLastPage =
      selectedNote?.pageStyle === "pages" &&
      currentEditorPage >= Math.max(1, selectedNotePages.length);
    const atScrollEnd =
      stage.scrollLeft >= Math.max(0, stage.scrollWidth - stage.clientWidth - 3);
    const startsAtRightEdge = event.clientX >= stageRect.right - 74;

    if (atLastPage && atScrollEnd && startsAtRightEdge) {
      editorTouchGestureRef.current = {
        mode: "pull",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
      return;
    }

    if (activeTool !== "type" && drawWithTouch) return;
    editorTouchGestureRef.current = {
      mode: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
      active: false,
    };
  };

  const handleStagePointerMoveCapture = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;
    const points = editorTouchPointsRef.current;
    if (points.has(event.pointerId)) {
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const gesture = editorTouchGestureRef.current;
    if (!gesture) return;

    if (gesture.mode === "pinch") {
      if (points.size < 2) return;
      const [first, second] = [...points.values()];
      const distanceNow = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      setSafeEditorZoom(gesture.startZoom * (distanceNow / gesture.startDistance));
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.active && Math.hypot(deltaX, deltaY) < 5) return;
    gesture.active = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an optimization; scrolling still works without it.
    }
    event.preventDefault();
    event.stopPropagation();

    if (gesture.mode === "pull") {
      const progress = Math.min(1, Math.max(0, -deltaX / 118));
      pagePullProgressRef.current = progress;
      setPagePullProgress(progress);
      return;
    }

    event.currentTarget.scrollLeft = gesture.scrollLeft - deltaX;
    event.currentTarget.scrollTop = gesture.scrollTop - deltaY;
  };

  const finishStageTouch = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;
    const gesture = editorTouchGestureRef.current;
    const shouldAddPage =
      gesture?.mode === "pull" &&
      gesture.pointerId === event.pointerId &&
      pagePullProgressRef.current >= 0.72;

    editorTouchPointsRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (gesture?.mode === "pinch" && editorTouchPointsRef.current.size > 0) {
      editorTouchGestureRef.current = null;
    } else if (gesture?.mode !== "pinch" || editorTouchPointsRef.current.size === 0) {
      editorTouchGestureRef.current = null;
    }

    setPagePullProgress(0);
    pagePullProgressRef.current = 0;
    if (shouldAddPage) insertPageAfter(Math.max(0, selectedNotePages.length - 1));
  };

  useEffect(() => {
    if (selectedNote?.pageStyle !== "pages") {
      setEditorPageCount(1);
      setCurrentEditorPage(1);
      lastAutoScrolledPageRef.current = 1;
      return;
    }

    let frame = window.requestAnimationFrame(updateEditorPageMetrics);
    const queueMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateEditorPageMetrics);
    };

    const stage = paperStageRef.current;
    const spread = paperSpreadRef.current;
    const resizeObserver = new ResizeObserver(queueMeasure);
    if (stage) resizeObserver.observe(stage);
    if (spread) resizeObserver.observe(spread);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [
    selectedNote?.id,
    selectedNotePages.length,
    selectedNote?.pageColor,
    selectedNote?.pageStyle,
    selectedNote?.pageTemplate,
  ]);

  useEffect(() => {
    const pendingFocus = pendingPageFocusRef.current;
    if (!pendingFocus || selectedNote?.pageStyle !== "pages") return;

    pendingPageFocusRef.current = null;
    focusPagedTextarea(pendingFocus.pageIndex, pendingFocus.caretOffset);
  }, [selectedNote?.pages, selectedNote?.pageStyle]);

  useEffect(() => {
    if (noteActionBarTimerRef.current) window.clearTimeout(noteActionBarTimerRef.current);

    if (shouldShowNoteActionBar) {
      setIsNoteActionBarVisible(true);
      setIsNoteActionBarClosing(false);
      return;
    }

    if (!isNoteActionBarVisible) return;
    setIsNoteActionBarClosing(true);
    noteActionBarTimerRef.current = window.setTimeout(() => {
      setIsNoteActionBarVisible(false);
      setIsNoteActionBarClosing(false);
    }, 180);
  }, [isNoteActionBarVisible, shouldShowNoteActionBar]);

  const countText = (value: number) => (value > 0 ? value : "");

  const showMoreMenu = () => {
    if (moreMenuTimerRef.current) window.clearTimeout(moreMenuTimerRef.current);
    setIsMoreMenuClosing(false);
    setIsMoreMenuOpen(true);
  };

  const closeMoreMenu = () => {
    if (!isMoreMenuOpen) return;
    if (moreMenuTimerRef.current) window.clearTimeout(moreMenuTimerRef.current);
    setIsMoreMenuClosing(true);
    moreMenuTimerRef.current = window.setTimeout(() => {
      setIsMoreMenuOpen(false);
      setIsMoreMenuClosing(false);
    }, 180);
  };

  const toggleMoreMenu = () => {
    if (isMoreMenuOpen && !isMoreMenuClosing) {
      closeMoreMenu();
      return;
    }
    showMoreMenu();
  };

  const exitNoteEditMode = () => {
    setIsNoteEditMode(false);
    setSelectedLibraryNoteIds([]);
    setIsMoveDialogOpen(false);
    setIsCoverDialogOpen(false);
    setIsDetailsDialogOpen(false);
  };

  const enterNoteEditMode = () => {
    closeMoreMenu();
    setIsTrashEditMode(false);
    setSelectedTrashIds([]);
    setIsNoteEditMode(true);
    setSelectedLibraryNoteIds([]);
  };

  const toggleNoteSelection = (noteId: string) => {
    if (selectionPressTimerRef.current) window.clearTimeout(selectionPressTimerRef.current);
    setPressedLibraryNoteId(null);
    window.requestAnimationFrame(() => {
      setPressedLibraryNoteId(noteId);
    });
    selectionPressTimerRef.current = window.setTimeout(() => {
      setPressedLibraryNoteId(null);
    }, 190);
    setSelectedLibraryNoteIds((current) =>
      current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId],
    );
  };

  const cancelNoteLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  };

  const handleNoteCardPointerDown = (
    noteId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (isNoteEditMode || event.pointerType !== "touch") return;
    cancelNoteLongPress();
    longPressStartRef.current = { noteId, x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      suppressNoteClickRef.current = true;
      setPressedLibraryNoteId(noteId);
      enterNoteEditMode();
      setSelectedLibraryNoteIds([noteId]);
      navigator.vibrate?.(22);
      longPressTimerRef.current = null;
      longPressStartRef.current = null;
    }, 480);
  };

  const handleNoteCardPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = longPressStartRef.current;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
      cancelNoteLongPress();
    }
  };

  const toggleAllVisibleNotes = () => {
    setSelectedLibraryNoteIds(allVisibleNotesSelected ? [] : visibleNoteIds);
  };

  const applySelectedNoteUpdates = async (
    createUpdates: (note: Note) => Partial<Omit<Note, "id" | "createdAt">>,
    nextStatus: string,
  ) => {
    if (!selectedLibraryNotes.length) return;
    const updatedNotes = selectedLibraryNotes.map((note) => touchNote(note, createUpdates(note)));
    const updatedById = new Map(updatedNotes.map((note) => [note.id, note]));
    setNotes((current) => current.map((note) => updatedById.get(note.id) ?? note));
    setStatus(nextStatus);
    await Promise.all(updatedNotes.map((note) => saveNote(note))).catch(() => setStatus("Could not save"));
  };

  const cycleViewMode = () => {
    setViewMode((mode) => (mode === "grid" ? "list" : mode === "list" ? "comfortable" : "grid"));
    closeMoreMenu();
  };

  const cycleSortMode = () => {
    setSortMode((mode) => (mode === "updated" ? "created" : mode === "created" ? "title" : "updated"));
    closeMoreMenu();
  };

  const handleMenuEdit = () => {
    if (selectedFolderId === "archive") {
      closeMoreMenu();
      setIsTrashEditMode(true);
      return;
    }
    enterNoteEditMode();
  };

  const handleMoveSelectedNotes = async (folderId: string) => {
    await applySelectedNoteUpdates(
      () => ({ folderId, archived: false }),
      `${selectedLibraryNotes.length} moved`,
    );
    exitNoteEditMode();
  };

  const handleShareSelectedNotes = () => {
    if (!selectedLibraryNotes.length) return;
    const text = selectedLibraryNotes
      .map((note) => {
        const body = note.plainText || htmlToPlainText(note.contentHtml);
        return `${note.title || "Untitled note"}\n${formatLongDate(note.updatedAt)}\n\n${body}`;
      })
      .join("\n\n---\n\n");
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).catch(() => undefined);
    }
    downloadBlob(
      new Blob([text], { type: "text/plain" }),
      selectedLibraryNotes.length === 1
        ? `${safeFilename(selectedLibraryNotes[0].title)}.txt`
        : "selected-notes.txt",
    );
    setStatus("Selected notes ready to share");
  };

  const handleDeleteSelectedNotes = async () => {
    await applySelectedNoteUpdates(
      () => ({ archived: true }),
      `${selectedLibraryNotes.length} moved to Trash`,
    );
    exitNoteEditMode();
  };

  const handleFavoriteSelectedNotes = async () => {
    const nextFavorite = !selectedNotesAreAllFavorite;
    await applySelectedNoteUpdates(
      () => ({ favorite: nextFavorite }),
      nextFavorite ? "Added to Favorites" : "Removed from Favorites",
    );
    exitNoteEditMode();
  };

  const openCoverDialog = () => {
    const firstSelected = selectedLibraryNotes[0];
    if (!firstSelected) return;
    setCoverTemplate(firstSelected.pageTemplate);
    setCoverColor(firstSelected.pageColor);
    setIsCoverDialogOpen(true);
  };

  const handleApplyCoverToSelectedNotes = async () => {
    await applySelectedNoteUpdates(
      (note) => ({
        pageTemplate: coverTemplate,
        pageColor: coverColor,
        pages: getNotePages(note).map((page) => ({
          ...page,
          pageTemplate: coverTemplate,
          pageColor: coverColor,
        })),
      }),
      "Cover updated",
    );
    exitNoteEditMode();
  };

  const openDetailsDialog = () => {
    if (!selectedLibraryNotes.length) return;
    setIsDetailsDialogOpen(true);
  };

  const togglePinFavoritesToTop = () => {
    closeMoreMenu();
    if (reorderFlipTimerRef.current) window.clearTimeout(reorderFlipTimerRef.current);
    if (reorderDoneTimerRef.current) window.clearTimeout(reorderDoneTimerRef.current);

    setIsNoteListReordering(true);
    reorderFlipTimerRef.current = window.setTimeout(() => {
      setPinFavoritesToTop((value) => !value);
    }, 220);
    reorderDoneTimerRef.current = window.setTimeout(() => {
      setIsNoteListReordering(false);
    }, 580);
  };

  const openEditor = (noteId: string, rect?: LaunchRect) => {
    if (launchTimerRef.current) window.clearTimeout(launchTimerRef.current);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);

    setIsEditorClosing(false);
    setLaunchRect(rect ?? null);
    setIsLaunchingNote(Boolean(rect));
    setIsEditorMenuOpen(false);
    setEditorSwipeOffset(0);
    setSelectedNoteId(noteId);
    setIsEditorOpen(true);

    if (rect) {
      launchTimerRef.current = window.setTimeout(() => {
        setIsLaunchingNote(false);
        setLaunchRect(null);
      }, 680);
    }
  };

  const openEditorFromCard = (
    noteId: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    const thumbnail = event.currentTarget.querySelector<HTMLElement>(".note-thumb, .trash-thumb");
    const rect = thumbnail?.getBoundingClientRect();
    openEditor(
      noteId,
      rect
        ? {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          }
        : undefined,
    );
  };

  const closeEditor = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    setIsLaunchingNote(false);
    setLaunchRect(null);
    setIsEditorMenuOpen(false);
    setEditorSwipeOffset(0);
    setIsEditorClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setIsEditorOpen(false);
      setIsEditorClosing(false);
    }, 230);
  };

  const handleEditorPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== "touch" ||
      event.clientX > 28 ||
      activePointerIdRef.current !== null ||
      isEditorMenuOpen
    ) {
      return;
    }
    editorSwipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleEditorPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const swipe = editorSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const deltaX = Math.max(0, event.clientX - swipe.startX);
    const deltaY = Math.abs(event.clientY - swipe.startY);
    if (deltaY > deltaX && deltaY > 18) {
      editorSwipeRef.current = null;
      editorSwipeOffsetRef.current = 0;
      setEditorSwipeOffset(0);
      return;
    }
    if (deltaX > 4) event.preventDefault();
    const nextOffset = Math.min(132, deltaX * 0.72);
    editorSwipeOffsetRef.current = nextOffset;
    setEditorSwipeOffset(nextOffset);
  };

  const handleEditorPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const swipe = editorSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const shouldClose = editorSwipeOffsetRef.current >= 72;
    editorSwipeRef.current = null;
    editorSwipeOffsetRef.current = 0;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setEditorSwipeOffset(0);
    if (shouldClose) closeEditor();
  };

  const openLibrary = (folderId: string) => {
    setSelectedFolderId(folderId);
    setIsManageFoldersOpen(false);
    setIsEditorOpen(false);
    setIsEditorClosing(false);
    setIsLaunchingNote(false);
    setLaunchRect(null);
    setIsTrashEditMode(false);
    setSelectedTrashIds([]);
    setIsNoteEditMode(false);
    setSelectedLibraryNoteIds([]);
    setIsMoreMenuOpen(false);
    if (isCompactLayout) setIsSidebarOpen(false);
  };

  const openFolderDialog = (parentId: string | null = null) => {
    setFolderDialogParentId(parentId);
    setFolderName("");
    setFolderColor("mint");
    setIsFolderDialogOpen(true);
    setIsMoreMenuOpen(false);
  };

  const handleCreateNote = async () => {
    const targetFolder =
      selectedFolderId === "all" ||
      selectedFolderId === "archive" ||
      selectedFolderId === "favorites" ||
      selectedFolderId === "folders"
        ? DEFAULT_FOLDER_ID
        : selectedFolderId;
    const note = createNote(targetFolder);
    setIsNoteEditMode(false);
    setSelectedLibraryNoteIds([]);
    setNotes((current) => [note, ...current]);
    setUnlockedNoteIds((current) => [...current, note.id]);
    openEditor(note.id);
    await saveNote(note);
  };

  const handleCreateFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    const folder = touchFolder(createFolder(name, folderColor), { parentId: folderDialogParentId });
    setFolders((current) => [...current, folder]);
    setFolderName("");
    setFolderColor("mint");
    setFolderDialogParentId(null);
    setIsFolderDialogOpen(false);
    setSelectedFolderId(folder.id);
    await saveFolder(folder);
  };

  const handleRenameFolder = async (folder: Folder) => {
    const nextName = window.prompt("Folder name", folder.name)?.trim();
    if (!nextName) return;
    const nextFolder = touchFolder(folder, { name: nextName });
    setFolders((current) => current.map((item) => (item.id === folder.id ? nextFolder : item)));
    await saveFolder(nextFolder);
  };

  const handleDeleteFolder = async (folder: Folder) => {
    if (folder.id === DEFAULT_FOLDER_ID) return;
    const confirmed = window.confirm(
      `Delete "${folder.name}"? Notes inside it will move to All notes.`,
    );
    if (!confirmed) return;
    const nextFolders = folders.map((item) =>
      item.parentId === folder.id ? touchFolder(item, { parentId: null }) : item,
    );
    setFolders(nextFolders.filter((item) => item.id !== folder.id));
    setNotes((current) =>
      current.map((note) =>
        note.folderId === folder.id ? touchNote(note, { folderId: DEFAULT_FOLDER_ID }) : note,
      ),
    );
    setSelectedFolderId("folders");
    await Promise.all(
      nextFolders
        .filter((item) => item.parentId === null && folders.find((folderItem) => folderItem.id === item.id)?.parentId === folder.id)
        .map(saveFolder),
    );
    await removeFolder(folder.id);
  };

  const handleTitleChange = (value: string) => {
    setDraftTitle(value);
    draftTitleRef.current = value;
    if (!selectedNote) return;
    updateNoteById(selectedNote.id, { title: value.trim() || "Untitled note" });
  };

  const handleToggleArchive = () => {
    if (!selectedNote) return;
    const nextNote = touchNote(selectedNote, { archived: !selectedNote.archived });
    setNotes((current) => current.map((note) => (note.id === nextNote.id ? nextNote : note)));
    saveNote(nextNote).catch(() => setStatus("Could not save"));
    closeEditor();
  };

  const handleDeleteNote = async () => {
    if (!selectedNote) return;
    const confirmed = window.confirm(`Delete "${selectedNote.title}" permanently?`);
    if (!confirmed) return;
    const nextNotes = notes.filter((note) => note.id !== selectedNote.id);
    setNotes(nextNotes);
    setSelectedNoteId(nextNotes[0]?.id ?? null);
    closeEditor();
    await removeNote(selectedNote.id);
  };

  const handleDuplicateNote = async () => {
    if (!selectedNote) return;
    const duplicate: Note = {
      ...selectedNote,
      id: makeId("note"),
      title: `${selectedNote.title || "Untitled note"} copy`,
      pinned: false,
      locked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setNotes((current) => [duplicate, ...current]);
    setSelectedNoteId(duplicate.id);
    setUnlockedNoteIds((current) => [...current, duplicate.id]);
    await saveNote(duplicate);
  };

  const handleToggleLock = () => {
    if (!selectedNote) return;
    const existingPasscode = window.localStorage.getItem(LOCK_KEY);

    if (selectedNote.locked) {
      const passcode = window.prompt("Passcode");
      if (passcode && passcode === existingPasscode) {
        updateNoteById(selectedNote.id, { locked: false }, "Unlocked");
        setUnlockedNoteIds((current) => current.filter((id) => id !== selectedNote.id));
      } else {
        setStatus("Passcode did not match");
      }
      return;
    }

    const nextPasscode = existingPasscode || window.prompt("Create a local passcode");
    if (!nextPasscode) return;
    window.localStorage.setItem(LOCK_KEY, nextPasscode);
    updateNoteById(selectedNote.id, { locked: true }, "Locked");
    setUnlockedNoteIds((current) => current.filter((id) => id !== selectedNote.id));
  };

  const handleUnlock = () => {
    const passcode = window.localStorage.getItem(LOCK_KEY);
    if (unlockInput && unlockInput === passcode && selectedNote) {
      setUnlockedNoteIds((current) =>
        current.includes(selectedNote.id) ? current : [...current, selectedNote.id],
      );
      setUnlockInput("");
      setStatus("Unlocked");
      return;
    }
    setStatus("Passcode did not match");
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as ExportPayload;
      if (
        (payload.version !== 1 && payload.version !== 2) ||
        !Array.isArray(payload.folders) ||
        !Array.isArray(payload.notes)
      ) {
        throw new Error("Invalid export file");
      }
      await replaceAllData(payload);
      const [storedFolders, storedNotes] = await Promise.all([getFolders(), getNotes()]);
      setFolders(storedFolders);
      setNotes(storedNotes);
      setSelectedFolderId("all");
      setSelectedNoteId(storedNotes[0]?.id ?? null);
      setLastSyncLabel(`Imported ${formatLongDate(new Date().toISOString())}`);
      setStatus("Imported");
    } catch {
      setStatus("Import failed");
    }
  };

  const handleExport = () => {
    downloadJson(buildExportPayload(folders, notes));
    setLastSyncLabel(`Exported ${formatLongDate(new Date().toISOString())}`);
  };

  const performFolderSync = async (silent = false) => {
    if (syncInProgressRef.current || !getSyncBridge()) return;
    syncInProgressRef.current = true;
    setIsSyncing(true);
    if (!silent) setStatus("Syncing...");

    try {
      const result = await syncNow(foldersRef.current, notesRef.current);
      setFolders(result.folders);
      setNotes(result.notes);
      setSelectedNoteId((current) =>
        current && result.notes.some((note) => note.id === current)
          ? current
          : (result.notes[0]?.id ?? null),
      );
      setSyncFolderLabel(result.folderLabel);
      setSyncDeviceCount(result.deviceCount);
      setLastSyncLabel(
        `Synced ${formatLongDate(result.syncedAt)} · ${result.deviceCount} ${
          result.deviceCount === 1 ? "device" : "devices"
        }`,
      );
      setStatus("Synced");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      setLastSyncLabel(message);
      if (!silent) setStatus("Sync failed");
    } finally {
      syncInProgressRef.current = false;
      setIsSyncing(false);
    }
  };

  const handleChooseSyncFolder = async () => {
    try {
      const label = await openSyncFolderPicker();
      if (!label) return;
      setSyncFolderLabel(label);
      setLastSyncLabel(`Connecting to ${label}...`);
      await performFolderSync();
    } catch (error) {
      setLastSyncLabel(error instanceof Error ? error.message : "Could not open sync folder");
      setStatus("Sync setup failed");
    }
  };

  useDebouncedEffect(
    () => {
      if (!isStorageReady || !syncFolderLabel) return;
      void performFolderSync(true);
    },
    [folders, notes, isStorageReady, syncFolderLabel],
    2600,
  );

  useEffect(() => {
    if (!isStorageReady || !syncFolderLabel) return undefined;
    const syncWhenActive = () => {
      if (document.visibilityState === "visible") void performFolderSync(true);
    };
    window.addEventListener("focus", syncWhenActive);
    document.addEventListener("visibilitychange", syncWhenActive);
    return () => {
      window.removeEventListener("focus", syncWhenActive);
      document.removeEventListener("visibilitychange", syncWhenActive);
    };
  }, [isStorageReady, syncFolderLabel]);

  const handleSaveAsText = () => {
    if (!selectedNote) return;
    downloadBlob(
      new Blob([selectedNote.plainText || htmlToPlainText(selectedNote.contentHtml)], {
        type: "text/plain",
      }),
      `${safeFilename(selectedNote.title)}.txt`,
    );
  };

  const addAttachments = (noteId: string, attachments: NoteAttachment[]) => {
    setNotes((current) =>
      current.map((note) =>
        note.id === noteId
          ? touchNote(note, { attachments: [...note.attachments, ...attachments] })
          : note,
      ),
    );
    setStatus("Attachment added");
  };

  const handleAttachmentImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    try {
      const attachments = await Promise.all(files.map(fileToAttachment));
      if (selectedNote && isEditorOpen) {
        addAttachments(selectedNote.id, attachments);
        return;
      }

      const targetFolder =
        selectedFolderId === "all" ||
        selectedFolderId === "archive" ||
        selectedFolderId === "favorites" ||
        selectedFolderId === "folders"
          ? DEFAULT_FOLDER_ID
          : selectedFolderId;
      const note: Note = {
        ...createNote(targetFolder),
        title: files[0].name.replace(/\.[^.]+$/, "") || "Imported file",
        plainText: attachments.map((attachment) => attachment.name).join(" "),
        attachments,
        tags: Array.from(new Set(attachments.map((attachment) => attachment.kind))),
      };
      setNotes((current) => [note, ...current]);
      setUnlockedNoteIds((current) => [...current, note.id]);
      openEditor(note.id);
      await saveNote(note);
      setStatus("Imported");
    } catch {
      setStatus("Attachment failed");
    }
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    if (!selectedNote) return;
    updateNoteById(selectedNote.id, {
      attachments: selectedNote.attachments.filter((attachment) => attachment.id !== attachmentId),
    });
  };

  const handleToggleRecording = async () => {
    if (!selectedNote) return;

    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const attachment: NoteAttachment = {
          id: makeId("audio"),
          kind: "audio",
          name: `Voice ${formatLongDate(new Date().toISOString())}.webm`,
          mimeType: blob.type,
          size: blob.size,
          dataUrl: await readBlobAsDataUrl(blob),
          createdAt: new Date().toISOString(),
        };
        addAttachments(selectedNote.id, [attachment]);
      };

      recorder.start();
      setIsRecording(true);
      setStatus("Recording");
    } catch {
      setStatus("Microphone unavailable");
    }
  };

  const handleSmartFormat = () => {
    if (!editor || !selectedNote) return;
    const plainText = htmlToPlainText(editor.getHTML());
    const points = plainText
      .split(/[.!?\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4);

    if (!points.length) {
      editor.chain().focus().insertContent("<h2>New section</h2><p></p>").run();
      return;
    }

    editor
      .chain()
      .focus()
      .insertContent(
        `<h2>Key points</h2><ul>${points.map((point) => `<li>${point}</li>`).join("")}</ul>`,
      )
      .run();
    setStatus("Formatted");
  };

  const getPointerSample = (
    surface: HTMLDivElement,
    pointer: {
      clientX: number;
      clientY: number;
      pressure: number;
      tiltX: number;
      tiltY: number;
      pointerType: string;
      timeStamp: number;
    },
    forcedPageId?: string,
  ): PointerSample => {
    let rect = surface.getBoundingClientRect();
    let pageId: string | undefined;

    if (selectedNote?.pageStyle === "pages") {
      const pages = Array.from(surface.querySelectorAll<HTMLElement>(".paper-page"));
      const forcedPage = forcedPageId
        ? pages.find((page) => page.dataset.pageId === forcedPageId)
        : undefined;
      const pointedPage = pages.find((page) => {
        const pageRect = page.getBoundingClientRect();
        return (
          pointer.clientX >= pageRect.left &&
          pointer.clientX <= pageRect.right &&
          pointer.clientY >= pageRect.top &&
          pointer.clientY <= pageRect.bottom
        );
      });
      const nearestPage =
        forcedPage ??
        pointedPage ??
        pages.reduce<HTMLElement | undefined>((nearest, page) => {
          if (!nearest) return page;
          const pageRect = page.getBoundingClientRect();
          const nearestRect = nearest.getBoundingClientRect();
          const pageDistance = Math.abs(pointer.clientX - (pageRect.left + pageRect.width / 2));
          const nearestDistance = Math.abs(
            pointer.clientX - (nearestRect.left + nearestRect.width / 2),
          );
          return pageDistance < nearestDistance ? page : nearest;
        }, undefined);

      if (nearestPage) {
        rect = nearestPage.getBoundingClientRect();
        pageId = nearestPage.dataset.pageId;
      }
    }

    const reportedPressure = Number.isFinite(pointer.pressure) ? pointer.pressure : 0;
    const pressure =
      pointer.pointerType === "pen"
        ? Math.min(1, Math.max(0.08, reportedPressure || 0.45))
        : Math.min(1, Math.max(0.3, reportedPressure || 0.5));

    return {
      pageId,
      point: {
        x: Math.min(100, Math.max(0, ((pointer.clientX - rect.left) / rect.width) * 100)),
        y: Math.min(100, Math.max(0, ((pointer.clientY - rect.top) / rect.height) * 100)),
        pressure,
        tiltX: pointer.tiltX || 0,
        tiltY: pointer.tiltY || 0,
        time: pointer.timeStamp,
      },
    };
  };

  const strokeIsOnSamplePage = (
    stroke: DrawingStroke,
    sample: PointerSample,
    note: Note,
  ) => {
    if (!sample.pageId) return !stroke.pageId;
    const firstPageId = getNotePages(note)[0]?.id;
    return stroke.pageId === sample.pageId || (!stroke.pageId && sample.pageId === firstPageId);
  };

  const applyEraserSamples = (samples: PointerSample[]) => {
    if (!samples.length) return;
    const noteId = selectedNoteIdRef.current;
    let erased = false;

    setNotes((current) =>
      current.map((note) => {
        if (note.id !== noteId) return note;
        const nextStrokes = note.strokes.filter((stroke) => {
          const threshold = Math.max(1.15, stroke.width / 3.4);
          const shouldErase = samples.some(
            (sample) =>
              strokeIsOnSamplePage(stroke, sample, note) &&
              stroke.points.some((strokePoint) => distance(strokePoint, sample.point) <= threshold),
          );
          erased ||= shouldErase;
          return !shouldErase;
        });
        return nextStrokes.length === note.strokes.length
          ? note
          : touchNote(note, { strokes: nextStrokes });
      }),
    );

    if (erased) setStatus("Saving...");
  };

  const queueInkRender = () => {
    pendingInkRenderRef.current = true;
    if (inkFrameRef.current) return;
    inkFrameRef.current = window.requestAnimationFrame(() => {
      inkFrameRef.current = null;
      if (eraserPointsRef.current.length) {
        const samples = eraserPointsRef.current;
        eraserPointsRef.current = [];
        applyEraserSamples(samples);
      }
      if (pendingInkRenderRef.current) {
        pendingInkRenderRef.current = false;
        setActiveStroke(activeStrokeRef.current);
      }
    });
  };

  const handleInkPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectedNote || !selectedNoteUnlocked || activePointerIdRef.current !== null) return;
    if (activeTool === "type") return;

    const isPen = event.pointerType === "pen";
    const isRecentPenPalm =
      event.pointerType === "touch" && performance.now() - lastPenInputAtRef.current < 900;
    if (isRecentPenPalm) {
      event.preventDefault();
      return;
    }

    const isStylusEraser =
      isPen && (event.button === 5 || (event.buttons & 32) === 32);
    const inputTool =
      isStylusEraser
        ? "eraser"
        : activeTool;

    if (event.pointerType === "touch" && !drawWithTouch) return;

    event.preventDefault();
    if (isPen) {
      lastPenInputAtRef.current = performance.now();
    }

    activePointerIdRef.current = event.pointerId;
    activePointerTypeRef.current = event.pointerType;
    activeInputToolRef.current = inputTool;
    event.currentTarget.setPointerCapture(event.pointerId);

    const sample = getPointerSample(event.currentTarget, event);
    activeInkPageIdRef.current = sample.pageId;

    if (inputTool === "eraser") {
      eraserPointsRef.current.push(sample);
      queueInkRender();
      return;
    }

    const tool: DrawingTool = inputTool === "marker" ? "marker" : "pen";
    const stroke: DrawingStroke = {
      id: makeId("stroke"),
      color: inkColor,
      width: tool === "marker" ? strokeWidth + 8 : strokeWidth,
      tool,
      points: [sample.point],
      pageId: sample.pageId,
      createdAt: new Date().toISOString(),
    };
    activeStrokeRef.current = stroke;
    setActiveStroke(stroke);
  };

  const handleInkPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerIdRef.current || !activeInputToolRef.current) return;
    event.preventDefault();
    if (event.pointerType === "pen") lastPenInputAtRef.current = performance.now();

    const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const pointerEvents = coalescedEvents.length ? coalescedEvents : [event.nativeEvent];
    const samples = pointerEvents.map((pointer) =>
      getPointerSample(event.currentTarget, pointer, activeInkPageIdRef.current),
    );

    if (activeInputToolRef.current === "eraser") {
      eraserPointsRef.current.push(...samples);
      queueInkRender();
      return;
    }

    const currentStroke = activeStrokeRef.current;
    if (!currentStroke) return;
    const nextPoints = [...currentStroke.points];
    for (const sample of samples) {
      const previous = nextPoints[nextPoints.length - 1];
      if (!previous || distance(previous, sample.point) >= 0.035) {
        nextPoints.push(sample.point);
      }
    }
    if (nextPoints.length === currentStroke.points.length) return;

    activeStrokeRef.current = { ...currentStroke, points: nextPoints };
    queueInkRender();
  };

  const handleInkPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerIdRef.current) return;
    event.preventDefault();
    if (event.pointerType === "pen") lastPenInputAtRef.current = performance.now();

    if (eraserPointsRef.current.length) {
      const samples = eraserPointsRef.current;
      eraserPointsRef.current = [];
      applyEraserSamples(samples);
    }

    const stroke = activeStrokeRef.current;
    if (stroke?.points.length) {
      const noteId = selectedNoteIdRef.current;
      setNotes((current) =>
        current.map((note) =>
          note.id === noteId
            ? touchNote(note, { strokes: [...note.strokes, stroke] })
            : note,
        ),
      );
      setStatus("Saving...");
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerIdRef.current = null;
    activePointerTypeRef.current = "";
    activeInputToolRef.current = null;
    activeInkPageIdRef.current = undefined;
    activeStrokeRef.current = null;
    pendingInkRenderRef.current = false;
    setActiveStroke(null);
  };

  const handleUndoInk = () => {
    if (!selectedNote) return;
    updateNoteById(selectedNote.id, { strokes: selectedNote.strokes.slice(0, -1) });
  };

  const handleRestoreSelectedTrash = async () => {
    const restored = notes.map((note) =>
      selectedTrashIds.includes(note.id) ? touchNote(note, { archived: false }) : note,
    );
    setNotes(restored);
    for (const note of restored.filter((item) => selectedTrashIds.includes(item.id))) {
      await saveNote(note);
    }
    setIsTrashEditMode(false);
    setSelectedTrashIds([]);
  };

  const handleDeleteSelectedTrash = async () => {
    const ids = selectedTrashIds;
    setNotes((current) => current.filter((note) => !ids.includes(note.id)));
    for (const id of ids) await removeNote(id);
    setIsTrashEditMode(false);
    setSelectedTrashIds([]);
  };

  const renderAttachment = (attachment: NoteAttachment) => {
    const icon =
      attachment.kind === "image" ? (
        <ImageIcon size={18} />
      ) : attachment.kind === "audio" ? (
        <FileAudio size={18} />
      ) : (
        <FileText size={18} />
      );

    return (
      <article className={`attachment-card ${attachment.kind}`} key={attachment.id}>
        <div className="attachment-heading">
          {icon}
          <span>{attachment.name}</span>
          <button type="button" onClick={() => handleRemoveAttachment(attachment.id)} aria-label="Remove attachment">
            <X size={15} />
          </button>
        </div>
        {attachment.kind === "image" && <img src={attachment.dataUrl} alt={attachment.name} />}
        {attachment.kind === "audio" && <audio controls src={attachment.dataUrl} />}
        {(attachment.kind === "pdf" || attachment.kind === "file") && (
          <a href={attachment.dataUrl} download={attachment.name}>
            Open file
          </a>
        )}
      </article>
    );
  };

  const renderNoteCollection = (items: Note[]) => (
    <div className={`note-list ${viewMode}${isNoteListReordering ? " is-reordering" : ""}`}>
      {items.map((note) => {
        const locked = note.locked && !unlockedNoteIds.includes(note.id);
        const selected = selectedLibraryNoteIds.includes(note.id);
        const cardClassName = [
          selectedNoteId === note.id && !isNoteEditMode ? "active" : "",
          isNoteEditMode ? "is-selecting" : "",
          selected ? "is-selected" : "",
          pressedLibraryNoteId === note.id ? "is-selection-press" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={note.id}
            className={cardClassName ? `note-card ${cardClassName}` : "note-card"}
            type="button"
            aria-pressed={isNoteEditMode ? selected : undefined}
            onClick={(event) => {
              if (suppressNoteClickRef.current) {
                suppressNoteClickRef.current = false;
                return;
              }
              if (isNoteEditMode) {
                toggleNoteSelection(note.id);
                return;
              }
              openEditorFromCard(note.id, event);
            }}
            onPointerDown={(event) => handleNoteCardPointerDown(note.id, event)}
            onPointerMove={handleNoteCardPointerMove}
            onPointerUp={cancelNoteLongPress}
            onPointerCancel={cancelNoteLongPress}
            onContextMenu={(event) => {
              if (isCompactLayout) event.preventDefault();
            }}
          >
            {isNoteEditMode && (
              <span className="note-select-circle" aria-hidden="true">
                {selected && <Check size={14} />}
              </span>
            )}
            <div className={`note-thumb template-${note.pageTemplate}`} aria-hidden="true">
              <div className="paper-lines">
                <strong>{locked ? "Locked note" : note.title || "Untitled note"}</strong>
                {(locked || note.plainText) && <span>{locked ? "Passcode required" : note.plainText}</span>}
                <span>{note.tags.join("  ") || " "}</span>
                <span>{note.attachments.length ? `${note.attachments.length} attachments` : " "}</span>
              </div>
              <div className="card-flags">
                {note.pinned && <Pin size={13} />}
                {note.favorite && <Star size={13} />}
                {note.locked && <Lock size={13} />}
              </div>
            </div>
            <div className="note-card-meta">
              <h3>{note.title || "Untitled note"}</h3>
              <span>{formatDate(note.updatedAt)}</span>
            </div>
          </button>
        );
      })}
      {!items.length && (
        <div className="empty-state">
          <FilePlus2 size={26} />
          <h3>No notes here</h3>
        </div>
      )}
    </div>
  );

  const renderTrashGrid = (items: Note[]) => (
    <div className="trash-list">
      {items.map((note) => {
        const selected = selectedTrashIds.includes(note.id);
        return (
          <button
            key={note.id}
            className={selected ? "trash-card selected" : "trash-card"}
            type="button"
            onClick={(event) => {
              if (isTrashEditMode) {
                setSelectedTrashIds((current) =>
                  current.includes(note.id)
                    ? current.filter((id) => id !== note.id)
                    : [...current, note.id],
                );
              } else {
                openEditorFromCard(note.id, event);
              }
            }}
          >
            {isTrashEditMode && <span className="trash-check">{selected ? "✓" : ""}</span>}
            <div className={`trash-thumb template-${note.pageTemplate}`} aria-hidden="true">
              <span>30 days</span>
            </div>
            <h3>{note.title || "Untitled note"}</h3>
            <p>{formatDate(note.updatedAt)}</p>
          </button>
        );
      })}
      {!items.length && (
        <div className="empty-state">
          <Trash2 size={26} />
          <h3>Trash is empty</h3>
        </div>
      )}
    </div>
  );

  const renderFolderNav = (parentId: string | null, depth = 0) =>
    userFolders
      .filter((folder) => folder.parentId === parentId)
      .map((folder) => (
        <div className="folder-group" key={folder.id}>
          <button
            className={selectedFolderId === folder.id ? `folder depth-${depth} active` : `folder depth-${depth}`}
            type="button"
            onClick={() => openLibrary(folder.id)}
          >
            <FolderIcon size={20} />
            <span>{folder.name}</span>
            <strong>{countText(folderCounts.get(folder.id) ?? 0)}</strong>
          </button>
          {renderFolderNav(folder.id, depth + 1)}
        </div>
      ));

  const topActions = isNoteEditMode ? (
    <div className="top-action-pill edit-mode-actions">
      <button
        type="button"
        onClick={toggleAllVisibleNotes}
        aria-label={allVisibleNotesSelected ? "Clear selection" : "Select all notes"}
      >
        <Check size={20} />
      </button>
      <button type="button" onClick={exitNoteEditMode} aria-label="Done">
        <X size={20} />
      </button>
    </div>
  ) : (
    <div className="top-action-pill">
      <button type="button" onClick={() => attachmentInputRef.current?.click()} aria-label="Import attachment">
        <FilePlus2 size={20} />
      </button>
      <div className="search-box" onClick={() => searchInputRef.current?.focus()}>
        <Search size={20} />
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          placeholder="Search"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search notes"
        />
      </div>
      <button type="button" onClick={cycleViewMode} aria-label="Change view">
        {viewMode === "grid" ? <LayoutGrid size={20} /> : <LayoutList size={20} />}
      </button>
      <button
        type="button"
        onClick={toggleMoreMenu}
        aria-label="More"
        aria-expanded={isMoreMenuOpen && !isMoreMenuClosing}
      >
        <MoreVertical size={20} />
      </button>
      {isMoreMenuOpen && (
        <div className={isMoreMenuClosing ? "more-menu is-closing" : "more-menu"}>
          <button type="button" onClick={handleMenuEdit}>Edit</button>
          <button type="button" onClick={cycleViewMode}>View</button>
          <button type="button" onClick={cycleSortMode}>Sort</button>
          <button
            type="button"
            onClick={togglePinFavoritesToTop}
          >
            {pinFavoritesToTop ? "Unpin favorites to top" : "Pin favorites to top"}
          </button>
        </div>
      )}
    </div>
  );

  if (isEditorOpen && selectedNote) {
    const locked = selectedNote.locked && !selectedNoteUnlocked;
    const isPagedNote = selectedNote.pageStyle === "pages";
    const renderedPages = selectedNotePages.length
      ? selectedNotePages
      : getNotePages(selectedNote);
    const visiblePageCount = isPagedNote ? renderedPages.length : editorPageCount;
    const paperStyle = {
      backgroundColor: selectedNote.pageColor,
      "--page-count": visiblePageCount,
      zoom: editorZoom,
    } as CSSProperties;
    const launchStyle = launchRect
      ? ({
          "--launch-x": `${launchRect.x}px`,
          "--launch-y": `${launchRect.y}px`,
          "--launch-w": `${launchRect.width}px`,
          "--launch-h": `${launchRect.height}px`,
        } as CSSProperties)
      : undefined;
    const editorStyle = {
      ...launchStyle,
      "--editor-swipe-x": `${editorSwipeOffset}px`,
    } as CSSProperties;
    return (
      <div
        className={`editor-screen${isLaunchingNote ? " is-launching" : ""}${isEditorClosing ? " is-closing" : ""}`}
        style={editorStyle}
        onPointerDown={handleEditorPointerDown}
        onPointerMove={handleEditorPointerMove}
        onPointerUp={handleEditorPointerUp}
        onPointerCancel={handleEditorPointerUp}
      >
        {isLaunchingNote && launchRect && (
          <div className={`note-launch-ghost template-${selectedNote.pageTemplate}`} aria-hidden="true">
            <div className="paper-lines">
              <strong>{selectedNote.title || "Untitled note"}</strong>
              {selectedNote.plainText && <span>{selectedNote.plainText}</span>}
              <span>{selectedNote.tags.join("  ") || " "}</span>
            </div>
          </div>
        )}
        <header className="note-topbar">
          <button type="button" onClick={closeEditor} aria-label="Back">
            <ChevronLeft size={26} />
          </button>
          <input
            className="note-title-inline"
            value={locked ? "Locked note" : draftTitle}
            readOnly={locked || activeTool !== "type"}
            onChange={(event) => handleTitleChange(event.target.value)}
            aria-label="Note title"
          />
          <div className="note-top-actions">
            <button
              className={isPageManagerOpen ? "is-active" : ""}
              type="button"
              onClick={() => {
                if (!isPagedNote) {
                  updateNoteById(selectedNote.id, {
                    pageStyle: "pages",
                    pages: getNotePages(selectedNote),
                  });
                }
                setIsPageManagerOpen((value) => !value);
                setOpenPageMenuId(null);
              }}
              aria-label="Page manager"
              aria-pressed={isPageManagerOpen}
            >
              <BookOpen size={21} />
            </button>
            <button
              type="button"
              onClick={() => insertPageAfter(renderedPages.length - 1)}
              aria-label="Add page"
            >
              <Plus size={23} />
            </button>
            <button type="button" onClick={() => void handleShareNote()} aria-label="Share note">
              <Share2 size={21} />
            </button>
            <button
              type="button"
              onClick={() => setIsEditorMenuOpen(true)}
              aria-label="Note actions"
              aria-expanded={isEditorMenuOpen}
            >
              <MoreVertical size={23} />
            </button>
          </div>
        </header>

        {isEditorMenuOpen && (
          <div
            className="editor-action-backdrop"
            role="presentation"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setIsEditorMenuOpen(false);
            }}
          >
            <section className="editor-action-sheet" role="dialog" aria-modal="true" aria-label="Note actions">
              <span className="sheet-handle" aria-hidden="true" />
              <button
                type="button"
                onClick={() => {
                  updateNoteById(selectedNote.id, { favorite: !selectedNote.favorite });
                  setIsEditorMenuOpen(false);
                }}
              >
                <Star size={21} />
                {selectedNote.favorite ? "Remove from favorites" : "Add to favorites"}
              </button>
              <button
                type="button"
                onClick={() => {
                  updateNoteById(selectedNote.id, { pinned: !selectedNote.pinned });
                  setIsEditorMenuOpen(false);
                }}
              >
                <Pin size={21} />
                {selectedNote.pinned ? "Unpin note" : "Pin note"}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleToggleLock();
                  setIsEditorMenuOpen(false);
                }}
              >
                <Lock size={21} />
                {selectedNote.locked ? "Remove lock" : "Lock note"}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleDuplicateNote();
                  setIsEditorMenuOpen(false);
                }}
              >
                <Copy size={21} />
                Duplicate note
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedNote.archived) {
                    void handleDeleteNote();
                  } else {
                    handleToggleArchive();
                  }
                  setIsEditorMenuOpen(false);
                }}
              >
                <Trash2 size={21} />
                {selectedNote.archived ? "Delete permanently" : "Move to trash"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleCreateNote();
                  setIsEditorMenuOpen(false);
                }}
              >
                <Plus size={22} />
                New note
              </button>
              <button className="sheet-cancel" type="button" onClick={() => setIsEditorMenuOpen(false)}>
                Cancel
              </button>
            </section>
          </div>
        )}

        {isPageManagerOpen && isPagedNote && !locked && (
          <>
            <button
              className="page-manager-backdrop"
              type="button"
              onClick={() => {
                setIsPageManagerOpen(false);
                setOpenPageMenuId(null);
              }}
              aria-label="Close page manager"
            />
            <aside className="page-manager" aria-label="Page manager">
              <header className="page-manager-header">
                <div>
                  <strong>Pages</strong>
                  <span>
                    {currentEditorPage} / {renderedPages.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsPageManagerOpen(false);
                    setOpenPageMenuId(null);
                  }}
                  aria-label="Close page manager"
                >
                  <X size={20} />
                </button>
              </header>
              <div className="page-manager-list">
                {renderedPages.map((page, pageIndex) => (
                  <article
                    className={
                      currentEditorPage === pageIndex + 1
                        ? "page-manager-item is-current"
                        : "page-manager-item"
                    }
                    key={page.id}
                  >
                    <button
                      className={`page-thumbnail template-${page.pageTemplate}`}
                      type="button"
                      style={{ backgroundColor: page.pageColor }}
                      onClick={() => scrollToEditorPage(pageIndex)}
                      aria-label={`Go to page ${pageIndex + 1}`}
                    >
                      <span>{page.plainText || " "}</span>
                    </button>
                    <footer>
                      <span>{pageIndex + 1}</span>
                      <div className="page-reorder-buttons">
                        <button
                          type="button"
                          disabled={pageIndex === 0}
                          onClick={() => movePage(pageIndex, -1)}
                          aria-label={`Move page ${pageIndex + 1} left`}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <button
                          type="button"
                          disabled={pageIndex === renderedPages.length - 1}
                          onClick={() => movePage(pageIndex, 1)}
                          aria-label={`Move page ${pageIndex + 1} right`}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenPageMenuId((value) => (value === page.id ? null : page.id))
                        }
                        aria-label={`Page ${pageIndex + 1} actions`}
                        aria-expanded={openPageMenuId === page.id}
                      >
                        <MoreVertical size={18} />
                      </button>
                    </footer>
                    {openPageMenuId === page.id && (
                      <div className="page-action-menu">
                        <button type="button" onClick={() => insertPageAfter(pageIndex)}>
                          <Plus size={17} />
                          Add page after
                        </button>
                        <button type="button" onClick={() => void copyPage(pageIndex)}>
                          <Copy size={17} />
                          Copy page
                        </button>
                        <button type="button" onClick={() => duplicatePage(pageIndex)}>
                          <Copy size={17} />
                          Duplicate page
                        </button>
                        <button type="button" onClick={() => erasePage(pageIndex)}>
                          <Eraser size={17} />
                          Erase page
                        </button>
                        <button type="button" onClick={() => void sharePage(pageIndex)}>
                          <Share2 size={17} />
                          Share page
                        </button>
                        <button type="button" onClick={() => void savePageImage(pageIndex)}>
                          <ImageDown size={17} />
                          Save as image
                        </button>
                        <button className="is-danger" type="button" onClick={() => deletePage(pageIndex)}>
                          <Trash2 size={17} />
                          Delete page
                        </button>
                      </div>
                    )}
                  </article>
                ))}
                <button
                  className="page-add-thumbnail"
                  type="button"
                  onClick={() => insertPageAfter(renderedPages.length - 1)}
                >
                  <Plus size={26} />
                  <span>Add page</span>
                </button>
              </div>
            </aside>
          </>
        )}

        {locked ? (
          <main className="locked-stage">
            <section className="locked-card">
              <Lock size={34} />
              <h2>This note is locked</h2>
              <input
                value={unlockInput}
                type="password"
                placeholder="Passcode"
                onChange={(event) => setUnlockInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleUnlock();
                }}
              />
              <button type="button" onClick={handleUnlock}>
                Unlock
              </button>
            </section>
          </main>
        ) : (
          <>
            <div className="drawing-toolbar" role="toolbar" aria-label="Note tools">
              <div className="primary-tool-group">
                <button
                  className={activeTool === "type" ? "selected" : ""}
                  type="button"
                  onClick={() => selectEditorTool("type")}
                  aria-label="Keyboard mode"
                >
                  <Keyboard size={18} />
                </button>
                <button
                  className={activeTool === "pen" ? "selected" : ""}
                  type="button"
                  onClick={() => selectEditorTool("pen")}
                  aria-label="Pen"
                >
                  <PenLine size={20} />
                </button>
                <button
                  className={activeTool === "marker" ? "selected" : ""}
                  type="button"
                  onClick={() => selectEditorTool("marker")}
                  aria-label="Highlighter"
                >
                  <Highlighter size={19} />
                </button>
                <button
                  className={activeTool === "eraser" ? "selected" : ""}
                  type="button"
                  onClick={() => selectEditorTool("eraser")}
                  aria-label="Eraser"
                >
                  <Eraser size={19} />
                </button>
                <button
                  className={drawWithTouch ? "touch-input-toggle selected" : "touch-input-toggle"}
                  type="button"
                  onClick={() => setDrawWithTouch((value) => !value)}
                  disabled={activeTool === "type"}
                  aria-label={drawWithTouch ? "Disable drawing with touch" : "Enable drawing with touch"}
                  aria-pressed={drawWithTouch}
                  title={drawWithTouch ? "Finger drawing on" : "Finger drawing off"}
                >
                  <Hand size={19} />
                </button>
              </div>
              <span className="pen-hint">
                {activeTool === "type"
                  ? "Keyboard mode"
                  : drawWithTouch
                    ? "Finger drawing on"
                    : "Finger drawing off"}
              </span>
              <span className="tool-divider" />
              {inkColors.map((color) => (
                <button
                  className={inkColor === color ? "dot active" : "dot"}
                  key={color}
                  style={{ background: color }}
                  type="button"
                  onClick={() => setInkColor(color)}
                  aria-label={`${color} ink`}
                />
              ))}
              <label className="stroke-control">
                <span className="stroke-preview" style={{ height: Math.max(2, strokeWidth / 2) }} />
                <input
                  id="stroke-width"
                  type="range"
                  min="2"
                  max="14"
                  step="1"
                  value={strokeWidth}
                  onChange={(event) => setStrokeWidth(Number(event.target.value))}
                  aria-label="Stroke width"
                  aria-valuetext={`${strokeWidth} pixels`}
                />
                <output className="stroke-value" htmlFor="stroke-width">
                  {strokeWidth} px
                </output>
              </label>
              <span className="tool-divider" />
              <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="Bold">
                <Bold size={18} />
              </button>
              <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label="Italic">
                <Italic size={18} />
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                aria-label="Bullet list"
              >
                <LayoutList size={18} />
              </button>
              <button
                type="button"
                onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
                aria-label="Heading"
              >
                <Type size={18} />
              </button>
              <button type="button" onClick={handleSmartFormat} aria-label="Auto format">
                <Sparkles size={18} />
              </button>
              <button type="button" onClick={() => attachmentInputRef.current?.click()} aria-label="Add attachment">
                <FilePlus2 size={18} />
              </button>
              <button type="button" onClick={handleToggleRecording} aria-label="Record audio">
                {isRecording ? <CircleStop size={18} /> : <Mic size={18} />}
              </button>
              <button type="button" onClick={handleUndoInk} aria-label="Undo ink">
                <RotateCcw size={18} />
              </button>
              <button type="button" onClick={handleSaveAsText} aria-label="Save as text">
                <Save size={18} />
              </button>
              <span className="tool-divider" />
              <select
                value={selectedNote.pageTemplate}
                onChange={(event) => {
                  const pageTemplate = event.target.value as PageTemplate;
                  updateNoteById(selectedNote.id, {
                    pageTemplate,
                    pages: getNotePages(selectedNote).map((page) => ({ ...page, pageTemplate })),
                  });
                }}
                aria-label="Page template"
              >
                {pageTemplates.map((template) => (
                  <option key={template} value={template}>
                    {template}
                  </option>
                ))}
              </select>
              <select
                value={selectedNote.pageStyle}
                onChange={(event) => {
                  const pageStyle = event.target.value as PageStyle;
                  updateNoteById(selectedNote.id, {
                    pageStyle,
                    pages: getNotePages(selectedNote),
                  });
                }}
                aria-label="Page style"
              >
                <option value="infinite">Infinite</option>
                <option value="pages">Pages</option>
              </select>
              <div className="page-colors">
                {pageColors.map((color) => (
                  <button
                    className={selectedNote.pageColor === color ? "page-color active" : "page-color"}
                    key={color}
                    style={{ background: color }}
                    type="button"
                    onClick={() =>
                      updateNoteById(selectedNote.id, {
                        pageColor: color,
                        pages: getNotePages(selectedNote).map((page) => ({
                          ...page,
                          pageColor: color,
                        })),
                      })
                    }
                    aria-label={`${color} paper`}
                  />
                ))}
              </div>
              <span className="save-chip">
                <Check size={14} />
                {status}
              </span>
            </div>
            <main
              ref={paperStageRef}
              className={`note-paper-stage style-${selectedNote.pageStyle}`}
              onScroll={updateEditorPageMetrics}
              onWheel={handlePaperStageWheel}
              onPointerDownCapture={handleStagePointerDownCapture}
              onPointerMoveCapture={handleStagePointerMoveCapture}
              onPointerUpCapture={finishStageTouch}
              onPointerCancelCapture={finishStageTouch}
            >
              <div className="editor-zoom-controls" aria-label="Page zoom">
                <button
                  type="button"
                  onClick={() => setSafeEditorZoom(editorZoom - 0.1)}
                  aria-label="Zoom out"
                >
                  <ZoomOut size={18} />
                </button>
                <output>{Math.round(editorZoom * 100)}%</output>
                <button
                  type="button"
                  onClick={() => setSafeEditorZoom(editorZoom + 0.1)}
                  aria-label="Zoom in"
                >
                  <ZoomIn size={18} />
                </button>
              </div>
              <div
                ref={paperSpreadRef}
                className={`paper-spread template-${selectedNote.pageTemplate} style-${selectedNote.pageStyle}${activeTool === "type" ? "" : " drawing-mode"}${drawWithTouch ? " touch-drawing" : ""}`}
                style={paperStyle}
                onPointerDown={handleInkPointerDown}
                onPointerMove={handleInkPointerMove}
                onPointerUp={handleInkPointerUp}
                onPointerCancel={handleInkPointerUp}
                onContextMenu={(event) => {
                  if (activeTool !== "type" || activePointerTypeRef.current === "pen") {
                    event.preventDefault();
                  }
                }}
              >
                {isPagedNote && (
                  <div className="paper-page-strip">
                    {renderedPages.map((page, pageIndex) => (
                      <div
                        className={`paper-page template-${page.pageTemplate}`}
                        key={page.id}
                        data-page-id={page.id}
                        style={{ backgroundColor: page.pageColor }}
                      >
                        <textarea
                          ref={(element) => {
                            if (element) {
                              pageTextAreaRefs.current.set(pageIndex, element);
                            } else {
                              pageTextAreaRefs.current.delete(pageIndex);
                            }
                          }}
                          className="page-textarea"
                          data-page-index={pageIndex}
                          value={page.plainText}
                          readOnly={activeTool !== "type"}
                          spellCheck
                          onChange={(event) =>
                            handlePagedTextChange(
                              pageIndex,
                              event.currentTarget.value,
                              event.currentTarget.selectionStart,
                            )
                          }
                          onFocus={() => setCurrentEditorPage(pageIndex + 1)}
                          onKeyDownCapture={handlePagedTextKeyDown}
                          onKeyDown={handlePagedTextKeyDown}
                          aria-label={`Page ${pageIndex + 1} body`}
                        />
                        <InkCanvas
                          className="ink-layer page-ink-layer"
                          strokes={[
                            ...selectedNote.strokes.filter(
                              (stroke) =>
                                stroke.pageId === page.id || (!stroke.pageId && pageIndex === 0),
                            ),
                            ...(activeStroke &&
                            (activeStroke.pageId === page.id ||
                              (!activeStroke.pageId && pageIndex === 0))
                              ? [activeStroke]
                              : []),
                          ]}
                        />
                        <span className="paper-page-number">
                          {pageIndex + 1} / {visiblePageCount}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {!isPagedNote && <EditorContent className="editor-shell" editor={editor} />}
                {isPagedNote && (
                  <span className="current-page-chip" aria-live="polite">
                    {currentEditorPage} / {visiblePageCount}
                  </span>
                )}
                {!!selectedNote.attachments.length && (
                  <section className="attachment-shelf">
                    {selectedNote.attachments.map(renderAttachment)}
                  </section>
                )}
                {!isPagedNote && (
                  <InkCanvas
                    className="ink-layer"
                    strokes={[
                      ...selectedNote.strokes.filter((stroke) => !stroke.pageId),
                      ...(activeStroke && !activeStroke.pageId ? [activeStroke] : []),
                    ]}
                  />
                )}
              </div>
              {isPagedNote && pagePullProgress > 0 && (
                <div
                  className={pagePullProgress >= 0.72 ? "page-pull-indicator is-ready" : "page-pull-indicator"}
                  style={{ "--pull-progress": pagePullProgress } as CSSProperties}
                  aria-live="polite"
                >
                  <span className="page-pull-progress">
                    <i />
                  </span>
                  <Plus size={28} />
                  <strong>
                    {pagePullProgress >= 0.72 ? "Release to add page" : "Pull to add page"}
                  </strong>
                </div>
              )}
            </main>
          </>
        )}

        <input
          ref={attachmentInputRef}
          className="visually-hidden"
          type="file"
          accept="image/*,audio/*,application/pdf,.pdf,.txt,.md"
          multiple
          onChange={handleAttachmentImport}
        />
      </div>
    );
  }

  return (
    <div className={isSidebarOpen ? "app-shell sidebar-expanded" : "app-shell sidebar-collapsed"}>
      {isManageFoldersOpen ? (
        <main className="manage-screen">
          <header className="manage-header">
            <button
              type="button"
              onClick={() => {
                setIsManageFoldersOpen(false);
                setIsFolderEditMode(false);
                setSelectedManageFolderId(null);
              }}
              aria-label="Back"
            >
              <ChevronLeft size={28} />
            </button>
            <h1>{isFolderEditMode ? `${selectedManageFolderId ? "1" : "0"} selected` : "Manage folders"}</h1>
            <button type="button" onClick={() => setIsFolderEditMode((value) => !value)}>
              {isFolderEditMode ? "Done" : "Edit"}
            </button>
          </header>
          <section className="manager-card">
            <div className="manager-row header-row">
              <FolderPlus size={21} />
              <span>Folders</span>
              <strong>{countText(userFolders.length)}</strong>
            </div>
            {userFolders.map((folder) => (
              <button
                key={folder.id}
                className="manager-row"
                type="button"
                onClick={() =>
                  isFolderEditMode ? setSelectedManageFolderId(folder.id) : openLibrary(folder.id)
                }
              >
                {isFolderEditMode && (
                  <span
                    className={selectedManageFolderId === folder.id ? "select-dot checked" : "select-dot"}
                  />
                )}
                <FolderIcon size={22} />
                <span>{folder.parentId ? "   " : ""}{folder.name}</span>
                <strong>{countText(folderCounts.get(folder.id) ?? 0)}</strong>
              </button>
            ))}
            <button className="manager-row create-row" type="button" onClick={() => openFolderDialog()}>
              <Plus size={25} />
              <span>Create folder</span>
            </button>
          </section>
          {isFolderEditMode && (
            <div className="folder-edit-bar">
              <button type="button">
                <Move size={22} />
                Move
              </button>
              <button type="button" onClick={() => openFolderDialog(selectedManageFolderId)}>
                <Plus size={23} />
                Subfolder
              </button>
              <button type="button">
                <Palette size={22} />
                Color
              </button>
              <button
                type="button"
                onClick={() => {
                  const folder = folders.find((item) => item.id === selectedManageFolderId);
                  if (folder) handleRenameFolder(folder);
                }}
              >
                <PenLine size={22} />
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  const folder = folders.find((item) => item.id === selectedManageFolderId);
                  if (folder) handleDeleteFolder(folder);
                }}
              >
                <Trash2 size={22} />
                Delete
              </button>
            </div>
          )}
        </main>
      ) : (
        <>
          {isCompactLayout && isSidebarOpen && (
            <button
              className="sidebar-backdrop is-visible"
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="Close navigation"
            />
          )}
          <aside className={`sidebar ${isSidebarOpen ? "is-open" : ""}`}>
            <div className="brand-row">
              <button
                className="brand-mark"
                type="button"
                onClick={() => setIsSidebarOpen((value) => !value)}
                aria-label={isSidebarOpen ? "Collapse navigation" : "Expand navigation"}
              >
                <Menu size={22} />
              </button>
              <button className="settings-button" type="button" onClick={() => setIsSyncPanelOpen(true)} aria-label="Settings">
                <Settings size={20} />
              </button>
            </div>
            <nav className="nav-list" aria-label="Note views">
              <button
                className={selectedFolderId === "all" ? "active" : ""}
                type="button"
                onClick={() => openLibrary("all")}
              >
                <FileText size={19} />
                <span>All notes</span>
                <strong>{countText(allNotesCount)}</strong>
              </button>
              <button
                className={selectedFolderId === "favorites" ? "active" : ""}
                type="button"
                onClick={() => openLibrary("favorites")}
              >
                <Star size={19} />
                <span>Favorites</span>
                <strong>{countText(favoriteCount)}</strong>
              </button>
              <button
                className={selectedFolderId === "archive" ? "active" : ""}
                type="button"
                onClick={() => openLibrary("archive")}
              >
                <Trash2 size={19} />
                <span>Trash</span>
                <strong>{countText(trashCount)}</strong>
              </button>
            </nav>
            <button
              className={selectedFolderId === "folders" ? "section-label active" : "section-label"}
              type="button"
              onClick={() => openLibrary("folders")}
            >
              <FolderPlus size={20} />
              <span>Folders</span>
              <strong>{countText(userFolders.length)}</strong>
            </button>
            <div className="folder-list">{renderFolderNav(null)}</div>
            <button className="manage-folders-button" type="button" onClick={() => setIsManageFoldersOpen(true)}>
              Manage folders
            </button>
          </aside>
          <main className="workspace">
            {selectedFolderId === "archive" ? (
              <header className={isTrashEditMode ? "topbar trash-topbar trash-editing" : "topbar trash-topbar"}>
                <button
                  className="icon-button rail-open"
                  type="button"
                  onClick={() => setIsSidebarOpen(true)}
                  aria-label="Open navigation"
                >
                  <Menu size={21} />
                </button>
                <div className="trash-heading">
                  {isTrashEditMode ? (
                    <>
                      <span className="select-all-dot">✓<small>All</small></span>
                      <h2>{selectedTrashIds.length} selected</h2>
                    </>
                  ) : (
                    <h2>Trash</h2>
                  )}
                  <p>Items show the days left until they're deleted forever.</p>
                </div>
                <div className="trash-actions">
                  {isTrashEditMode ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsTrashEditMode(false);
                        setSelectedTrashIds([]);
                      }}
                    >
                      Cancel
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setIsTrashEditMode(true);
                          setSelectedTrashIds(filteredNotes.map((note) => note.id));
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" onClick={() => setIsMoreMenuOpen((value) => !value)} aria-label="More">
                        <MoreVertical size={20} />
                      </button>
                    </>
                  )}
                </div>
              </header>
            ) : (
              <header className={isFolderOverview || activeFolder ? "topbar folder-topbar" : "topbar"}>
                <button
                  className="icon-button rail-open"
                  type="button"
                  onClick={() => setIsSidebarOpen(true)}
                  aria-label="Open navigation"
                >
                  <Menu size={21} />
                </button>
                <div className="screen-title">
                  <h2>{isNoteEditMode ? `${selectedLibraryNoteIds.length} selected` : pageTitle}</h2>
                  {!isFolderOverview && <p>{isNoteEditMode ? "Tap notes to select" : `${filteredNotes.length} notes`}</p>}
                </div>
                {topActions}
              </header>
            )}
            <section className="content-grid browsing">
              {selectedFolderId === "archive" ? (
                <>
                  {renderTrashGrid(filteredNotes)}
                  {isTrashEditMode && (
                    <div className="trash-edit-bar">
                      <button type="button" onClick={handleRestoreSelectedTrash}>
                        <Archive size={22} />
                        Restore
                      </button>
                      <button type="button" onClick={handleDeleteSelectedTrash}>
                        <Trash2 size={22} />
                        Delete
                      </button>
                    </div>
                  )}
                </>
              ) : isFolderOverview ? (
                <div className="folder-card-grid">
                  {topLevelFolders.map((folder) => (
                    <button key={folder.id} className={`folder-tile ${folder.color}`} type="button" onClick={() => openLibrary(folder.id)}>
                      <span>{countText(folderCounts.get(folder.id) ?? 0)}</span>
                      <strong>{folder.name}</strong>
                    </button>
                  ))}
                  <button className="folder-tile create-folder-tile" type="button" onClick={() => openFolderDialog()}>
                    <Plus size={24} />
                    <strong>Create folder</strong>
                  </button>
                </div>
              ) : activeFolder ? (
                <>
                  <div className="breadcrumb">
                    <FolderIcon size={19} />
                    <ChevronRight size={17} />
                    <span>{activeFolder.name}</span>
                    <button type="button" onClick={() => openFolderDialog(activeFolder.id)}>
                      <Plus size={16} />
                    </button>
                  </div>
                  {renderNoteCollection(filteredNotes)}
                </>
              ) : (
                renderNoteCollection(filteredNotes)
              )}
            </section>
            {isNoteActionBarVisible && (
              <div
                className={isNoteActionBarClosing ? "selection-island is-closing" : "selection-island"}
                role="toolbar"
                aria-label="Selected note actions"
              >
                <span className="selection-count">{selectedLibraryNoteIds.length} selected</span>
                <button type="button" onClick={() => setIsMoveDialogOpen(true)}>
                  <Move size={18} />
                  <span>Move</span>
                </button>
                <button type="button" onClick={handleShareSelectedNotes}>
                  <Share2 size={18} />
                  <span>Share</span>
                </button>
                <button type="button" onClick={handleDeleteSelectedNotes}>
                  <Trash2 size={18} />
                  <span>Delete</span>
                </button>
                <button type="button" onClick={handleFavoriteSelectedNotes}>
                  <Star size={18} />
                  <span>{selectedNotesAreAllFavorite ? "Unfavourite" : "Favourite"}</span>
                </button>
                <button type="button" onClick={openCoverDialog}>
                  <Palette size={18} />
                  <span>Edit cover</span>
                </button>
                <button type="button" onClick={openDetailsDialog}>
                  <FileText size={18} />
                  <span>Details</span>
                </button>
              </div>
            )}
          </main>
          {!isNoteEditMode && (
            <button className="fab" type="button" onClick={handleCreateNote} aria-label="Create note">
              <PenLine size={25} />
            </button>
          )}
        </>
      )}

      <input
        ref={importInputRef}
        className="visually-hidden"
        type="file"
        accept="application/json"
        onChange={handleImport}
      />
      <input
        ref={attachmentInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*,audio/*,application/pdf,.pdf,.txt,.md"
        multiple
        onChange={handleAttachmentImport}
      />

      {isFolderDialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="folder-title">
            <div className="dialog-heading">
              <h2 id="folder-title">{folderDialogParentId ? "New subfolder" : "New folder"}</h2>
              <button className="icon-button" type="button" onClick={() => setIsFolderDialogOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <label className="field">
              Name
              <input
                autoFocus
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleCreateFolder();
                }}
              />
            </label>
            <div className="swatches" aria-label="Folder color">
              {folderColors.map((color) => (
                <button
                  className={folderColor === color ? `swatch ${color} active` : `swatch ${color}`}
                  key={color}
                  type="button"
                  onClick={() => setFolderColor(color)}
                  aria-label={`${color} folder color`}
                />
              ))}
            </div>
            <div className="dialog-actions">
              <button type="button" onClick={() => setIsFolderDialogOpen(false)}>
                Cancel
              </button>
              <button className="confirm" type="button" onClick={handleCreateFolder}>
                Create
              </button>
            </div>
          </section>
        </div>
      )}

      {isMoveDialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog selection-dialog" role="dialog" aria-modal="true" aria-labelledby="move-title">
            <div className="dialog-heading">
              <h2 id="move-title">Move to</h2>
              <button className="icon-button" type="button" onClick={() => setIsMoveDialogOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <div className="move-target-list">
              {[{ id: DEFAULT_FOLDER_ID, name: "All notes" }, ...userFolders].map((folder) => (
                <button key={folder.id} type="button" onClick={() => handleMoveSelectedNotes(folder.id)}>
                  <FolderIcon size={18} />
                  <span>{folder.name}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {isCoverDialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog selection-dialog" role="dialog" aria-modal="true" aria-labelledby="cover-title">
            <div className="dialog-heading">
              <h2 id="cover-title">Edit cover</h2>
              <button className="icon-button" type="button" onClick={() => setIsCoverDialogOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <div className="cover-template-list" aria-label="Paper template">
              {pageTemplates.map((template) => (
                <button
                  key={template}
                  className={coverTemplate === template ? `cover-template template-${template} active` : `cover-template template-${template}`}
                  type="button"
                  onClick={() => setCoverTemplate(template)}
                  aria-label={`${template} cover`}
                >
                  <span>{template}</span>
                </button>
              ))}
            </div>
            <div className="swatches" aria-label="Cover color">
              {pageColors.map((color) => (
                <button
                  key={color}
                  className={coverColor === color ? "page-cover-swatch active" : "page-cover-swatch"}
                  type="button"
                  onClick={() => setCoverColor(color)}
                  style={{ backgroundColor: color }}
                  aria-label={`${color} cover color`}
                />
              ))}
            </div>
            <div className="dialog-actions">
              <button type="button" onClick={() => setIsCoverDialogOpen(false)}>
                Cancel
              </button>
              <button className="confirm" type="button" onClick={handleApplyCoverToSelectedNotes}>
                Apply
              </button>
            </div>
          </section>
        </div>
      )}

      {isDetailsDialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog selection-dialog" role="dialog" aria-modal="true" aria-labelledby="details-title">
            <div className="dialog-heading">
              <h2 id="details-title">Details</h2>
              <button className="icon-button" type="button" onClick={() => setIsDetailsDialogOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <dl className="note-detail-list">
              <div>
                <dt>Selected</dt>
                <dd>{selectedLibraryNotes.length} notes</dd>
              </div>
              <div>
                <dt>Folders</dt>
                <dd>{selectedNotesFolderLabel}</dd>
              </div>
              <div>
                <dt>Words</dt>
                <dd>{selectedNotesWordCount}</dd>
              </div>
              <div>
                <dt>Attachments</dt>
                <dd>{selectedNotesAttachmentCount}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatLongDate(selectedNotesCreatedLabel)}</dd>
              </div>
              <div>
                <dt>Modified</dt>
                <dd>{formatLongDate(selectedNotesUpdatedLabel)}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}

      {isSyncPanelOpen && (
        <div className="dialog-backdrop right-sheet-backdrop" role="presentation">
          <section className="sync-panel" role="dialog" aria-modal="true" aria-labelledby="sync-title">
            <div className="dialog-heading">
              <h2 id="sync-title">Sync</h2>
              <button className="icon-button" type="button" onClick={() => setIsSyncPanelOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <div className="sync-status">
              <span>{syncFolderLabel ? `Cloud folder: ${syncFolderLabel}` : "Cloud folder not connected"}</span>
              <strong>
                {allNotesCount} notes · {syncDeviceCount} {syncDeviceCount === 1 ? "device" : "devices"}
              </strong>
              <small>{lastSyncLabel}</small>
            </div>
            <div className="sync-actions">
              <button type="button" onClick={handleChooseSyncFolder} disabled={isSyncing}>
                <FolderPlus size={18} />
                {syncFolderLabel ? "Change sync folder" : "Choose cloud sync folder"}
              </button>
              <button
                type="button"
                onClick={() => void performFolderSync()}
                disabled={!syncFolderLabel || isSyncing}
              >
                <RotateCcw size={18} />
                {isSyncing ? "Syncing..." : "Sync now"}
              </button>
              <button type="button" onClick={handleExport}>
                <Download size={18} />
                Export backup
              </button>
              <button type="button" onClick={() => importInputRef.current?.click()}>
                <Upload size={18} />
                Import backup
              </button>
            </div>
            <p className="sync-help">
              Choose the same Google Drive, OneDrive, or Dropbox folder on every device. Notes stay
              offline and sync automatically whenever the app is active.
            </p>
            <div className="settings-list">
              <label>
                <input
                  type="checkbox"
                  checked={pinFavoritesToTop}
                  onChange={(event) => setPinFavoritesToTop(event.target.checked)}
                />
                Pin favorites to top
              </label>
              <label>
                <ListFilter size={18} />
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                  <option value="updated">Date modified</option>
                  <option value="created">Date created</option>
                  <option value="title">Title</option>
                </select>
              </label>
              <label>
                <Tags size={18} />
                <select value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)}>
                  <option value="grid">Grid</option>
                  <option value="comfortable">Comfortable</option>
                  <option value="list">List</option>
                </select>
              </label>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
