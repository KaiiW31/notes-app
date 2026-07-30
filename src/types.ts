export type FolderColor = "ink" | "sky" | "mint" | "coral" | "gold" | "violet";

export type AttachmentKind = "image" | "audio" | "pdf" | "file";

export type PageTemplate = "lined" | "grid" | "dots" | "blank";

export type PageStyle = "infinite" | "pages";

export type NoteAttachment = {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  createdAt: string;
};

export type DrawingTool = "pen" | "marker";

export type DrawingPoint = {
  x: number;
  y: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  time?: number;
};

export type DrawingStroke = {
  id: string;
  color: string;
  width: number;
  tool: DrawingTool;
  points: DrawingPoint[];
  pageId?: string;
  createdAt: string;
};

export type NotePage = {
  id: string;
  contentHtml: string;
  plainText: string;
  pageTemplate: PageTemplate;
  pageColor: string;
};

export type Folder = {
  id: string;
  name: string;
  color: FolderColor;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Note = {
  id: string;
  title: string;
  contentHtml: string;
  plainText: string;
  folderId: string;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  locked: boolean;
  pageTemplate: PageTemplate;
  pageStyle: PageStyle;
  pageColor: string;
  pages: NotePage[];
  attachments: NoteAttachment[];
  strokes: DrawingStroke[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExportPayload = {
  version: 1 | 2;
  exportedAt: string;
  folders: Folder[];
  notes: Note[];
};

export type SyncTombstones = {
  folders: Record<string, string>;
  notes: Record<string, string>;
};

export type SyncSnapshot = {
  version: 1;
  deviceId: string;
  updatedAt: string;
  folders: Folder[];
  notes: Note[];
  deleted: SyncTombstones;
};

export type ViewMode = "grid" | "list" | "comfortable";

export type SortMode = "updated" | "created" | "title";
