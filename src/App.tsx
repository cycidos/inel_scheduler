import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import settingsIcon from "./assets/settings-gear.svg";
import logoImage from "./assets/logo.png";
import chzzkCategoriesSeed from "./data/chzzk-categories.seed.json";

declare global {
  interface Window {
    electronAPI?: {
      appName: string;
      startChzzkPolling: (url: string, intervalMs: number) => Promise<{ ok: boolean; error?: string; channelId?: string }>;
      stopChzzkPolling: () => Promise<{ ok: boolean }>;
      onChzzkStatus: (cb: (data: ChzzkStatus) => void) => () => void;
      onChzzkCategoryChange: (cb: (data: ChzzkCategoryChange) => void) => () => void;
      onChzzkTitleChange: (cb: (data: ChzzkTitleChange) => void) => () => void;
      onChzzkError: (cb: (data: { message: string }) => void) => () => void;
      sheetsPickKeyfile: () => Promise<{ ok: boolean; path?: string; clientEmail?: string; error?: string }>;
      sheetsInitAuth: (keyFilePath: string) => Promise<{ ok: boolean; clientEmail?: string; error?: string }>;
      sheetsImport: (sheetUrl: string, tabKey: string, year: number, headers: Array<{ key: string; label: string }>) =>
        Promise<{ ok: boolean; rows?: RowItem[]; headerRow?: string[]; sheetNotFound?: boolean; error?: string }>;
      sheetsExport: (sheetUrl: string, tabKey: string, year: number, headers: Array<{ key: string; label: string }>, rows: RowItem[]) =>
        Promise<{ ok: boolean; sheetName?: string; rowCount?: number; error?: string }>;
      sheetsPatchRow: (
        sheetUrl: string,
        tabKey: string,
        year: number,
        headers: Array<{ key: string; label: string; shared?: boolean }>,
        matchPairs: Array<[string, string]>,
        rowValues: Record<string, string>
      ) => Promise<{ ok: boolean; action?: "updated" | "appended"; rowNum?: number; error?: string }>;
      sheetsTestConnection: (sheetUrl: string) =>
        Promise<{ ok: boolean; title?: string; sheets?: string[]; clientEmail?: string; error?: string }>;
      categoriesLoadUser: () =>
        Promise<{ ok: boolean; categories?: Array<{ categoryId: string; categoryValue: string; categoryType: string; addedAt?: string }>; path?: string }>;
      categoriesAddUser: (categoryId: string, categoryValue: string, categoryType?: string) =>
        Promise<{ ok: boolean; added?: boolean; categories?: Array<{ categoryId: string; categoryValue: string; categoryType: string; addedAt?: string }>; error?: string }>;
      categoriesSearchOnline: (keyword: string, limit?: number) =>
        Promise<{ ok: boolean; categories?: Array<{ categoryId: string; categoryValue: string; categoryType: string }>; keyword?: string; error?: string }>;
      helpOpenSheetsSetup: () => Promise<{ ok: boolean; url?: string; error?: string }>;
      helpOpenAppGuide: () => Promise<{ ok: boolean; url?: string; error?: string }>;
      helpOpenAiSetup: () => Promise<{ ok: boolean; url?: string; error?: string }>;
      aiListModels: (provider: string, apiKey: string) => Promise<{
        ok: boolean;
        provider?: string;
        models?: Array<{ id: string; label: string; created?: number | string | null }>;
        totalCount?: number;
        elapsedMs?: number;
        error?: string;
        log?: string;
      }>;
      aiAnalyzeCsv: (
        provider: string,
        apiKey: string,
        model: string,
        csvHeader: string[],
        csvSample: string[][],
        ourSchema: Array<{ key: string; label: string; type: string; options?: string[] }>
      ) => Promise<{
        ok: boolean;
        mapping?: AiMapping;
        elapsedMs?: number;
        error?: string;
        trace?: string[];
      }>;
      getFilePath: (file: File) => string;
    };
  }
}

type AiProvider = "openai" | "anthropic" | "google";

type AiMapping = {
  headerMap: Record<string, string | null>;
  valueMaps?: Record<string, Record<string, string>>;
  dateFormat?: Record<string, string>;
  splitColumns?: Record<string, { delimiter: string; trim?: boolean }>;
  ignoreColumns?: string[];
  twoRowAssignment?: { thumbnailerColumn?: string | null; editorColumn?: string | null };
  notes?: string;
};

type AiModelInfo = { id: string; label: string; created?: number | string | null };

type ChzzkStatus = {
  live: boolean;
  category?: string;
  categoryId?: string;
  categoryValue?: string;
  categoryType?: string;
  title?: string;
  openDate?: string;
  uptime?: string;
  status?: string;
};

type ChzzkCategoryChange = {
  prev: string;
  next: string;
  nextId?: string;
  nextValue?: string;
  nextType?: string;
  title: string;
  uptime: string;
  timestamp: string;
};

type ChzzkTitleChange = {
  prev: string;
  next: string;
  category: string;
  uptime: string;
  timestamp: string;
};

type TabKey = "shorts" | "longform" | "fullReplay";
type ColumnType = "text" | "select" | "status" | "date" | "url" | "preset";

type ColumnDef = {
  key: string;
  label: string;
  type: ColumnType;
  width?: number;
  shared?: boolean;
  /** type === "preset" 일 때 사용. dropdown 후보 옵션 (직접 입력도 허용) */
  presetOptions?: string[];
  /** type === "preset" 일 때 사용. 역할별 초기값 */
  presetDefaults?: { thumbnailer?: string; editor?: string; default?: string };
};

type RowItem = {
  id: string;
  values: Record<string, string>;
  thumbnailer?: Record<string, string>;
  editor?: Record<string, string>;
};

type EditorRole = "thumbnailer" | "editor";

type StaffMember = {
  id: string;
  name: string;
  role: EditorRole;
};

type ChzzkCategory = {
  categoryId: string;
  categoryValue: string;
  categoryType: string;
};

const ROLE_LABEL: Record<EditorRole, string> = {
  thumbnailer: "썸네일러",
  editor: "영상편집자"
};

type AppDataState = {
  schemaByTab: Record<TabKey, ColumnDef[]>;
  rowsByTab: Record<TabKey, RowItem[]>;
};

type UndoSnapshot = {
  state: AppDataState;
  reason: string;
  at: string;
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "shorts", label: "숏폼" },
  { key: "longform", label: "롱폼" },
  { key: "fullReplay", label: "다시보기" }
];

const EDIT_TYPE_OPTIONS = ["미설정", "하이라이트 편집", "컷편집", "무편집", "풀편집", "-"];
const SUBTITLE_OPTIONS = ["미설정", "기본 자막", "자막X", "효과자막 포함", "-"];

const buildShortLongSchema = (): ColumnDef[] => [
  { key: "upload", label: "업로드", type: "status", width: 100, shared: true },
  { key: "broadcastDate", label: "방송일", type: "date", width: 140, shared: true },
  { key: "videoTitle", label: "영상제목", type: "text", width: 240, shared: true },
  { key: "videoCategory", label: "영상 카테고리", type: "select", width: 220, shared: true },
  { key: "assignee", label: "담당자", type: "text", width: 160 },
  {
    key: "editType",
    label: "편집 유형",
    type: "preset",
    width: 150,
    presetOptions: EDIT_TYPE_OPTIONS,
    presetDefaults: { thumbnailer: "-", editor: "미설정" }
  },
  {
    key: "subtitle",
    label: "자막",
    type: "preset",
    width: 140,
    presetOptions: SUBTITLE_OPTIONS,
    presetDefaults: { thumbnailer: "-", editor: "미설정" }
  },
  { key: "editStartDate", label: "작업시작일", type: "date", width: 150 },
  { key: "workStatus", label: "작업상태", type: "status", width: 140 },
  { key: "deliveryDate", label: "납품일", type: "date", width: 140 },
  { key: "sourceShare", label: "원본 공유", type: "url", width: 180 },
  { key: "deliveryShare", label: "납품 공유", type: "url", width: 180 }
];

const tableSchema: Record<TabKey, ColumnDef[]> = {
  shorts: buildShortLongSchema(),
  longform: buildShortLongSchema(),
  fullReplay: [
    { key: "upload", label: "업로드", type: "status", width: 100, shared: true },
    { key: "broadcastDate", label: "방송일", type: "date", width: 140, shared: true },
    { key: "broadcastStartTime", label: "방송시작시간", type: "text", width: 120, shared: true },
    { key: "videoTitle", label: "영상제목", type: "text", width: 280, shared: true },
    { key: "categoryTimeline", label: "카테고리 타임라인", type: "text", width: 320, shared: true }
  ]
};

const columnTypeOptions: ColumnType[] = ["text", "select", "status", "date", "url", "preset"];
const categoryOptions = ["게임", "노래음악", "토크"];

const initialRows: Record<TabKey, RowItem[]> = {
  shorts: [
    {
      id: "s-1",
      values: {
        upload: "",
        broadcastDate: "2026-04-13",
        videoTitle: "발로란트 하이라이트 #12",
        videoCategory: "게임"
      },
      thumbnailer: {
        assignee: "",
        editStartDate: "2026-04-13",
        workStatus: "",
        deliveryDate: "2026-04-15",
        editType: "-",
        subtitle: "-",
        sourceShare: "https://drive.example/source-1",
        deliveryShare: ""
      },
      editor: {
        assignee: "",
        editStartDate: "",
        workStatus: "",
        deliveryDate: "",
        editType: "미설정",
        subtitle: "미설정",
        sourceShare: "",
        deliveryShare: ""
      }
    }
  ],
  longform: [
    {
      id: "l-1",
      values: {
        upload: "",
        broadcastDate: "2026-04-12",
        videoTitle: "주간 방송 정리 VLOG",
        videoCategory: "토크"
      },
      thumbnailer: {
        assignee: "",
        editStartDate: "",
        workStatus: "",
        deliveryDate: "",
        editType: "-",
        subtitle: "-",
        sourceShare: "",
        deliveryShare: ""
      },
      editor: {
        assignee: "",
        editStartDate: "",
        workStatus: "Wip",
        deliveryDate: "2026-04-18",
        editType: "풀편집",
        subtitle: "효과자막 포함",
        sourceShare: "https://drive.example/source-2",
        deliveryShare: ""
      }
    }
  ],
  fullReplay: [
    {
      id: "f-1",
      values: {
        upload: "",
        broadcastDate: "2026-04-10",
        broadcastStartTime: "21:00:00",
        videoTitle: "풀 리플레이 #31",
        categoryTimeline: "00:00:00 - 노래음악\n01:10:30 - 토크"
      }
    }
  ]
};

function cloneState(state: AppDataState): AppDataState {
  return {
    schemaByTab: JSON.parse(JSON.stringify(state.schemaByTab)) as Record<TabKey, ColumnDef[]>,
    rowsByTab: JSON.parse(JSON.stringify(state.rowsByTab)) as Record<TabKey, RowItem[]>
  };
}

function createEmptyRow(columns: ColumnDef[], tab: TabKey): RowItem {
  const values: Record<string, string> = {};
  const thumbnailer: Record<string, string> = {};
  const editor: Record<string, string> = {};
  columns.forEach((column) => {
    const defaults = column.presetDefaults;
    if (column.shared) {
      values[column.key] = defaults?.default ?? "";
    } else {
      thumbnailer[column.key] = defaults?.thumbnailer ?? "";
      editor[column.key] = defaults?.editor ?? "";
    }
  });
  const row: RowItem = {
    id: `row_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    values
  };
  if (tab !== "fullReplay") {
    row.thumbnailer = thumbnailer;
    row.editor = editor;
  }
  return row;
}

function createColumnKey() {
  return `col_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function parseTags(raw: string): string[] {
  if (!raw) return [];
  return raw.split("|").map((t) => t.trim()).filter((t) => t.length > 0);
}

function stringifyTags(tags: string[]): string {
  return tags.filter((t) => t.length > 0).join("|");
}

function parseMonthKey(rawDate: string): string | null {
  if (!rawDate) return null;
  const matched = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${matched[1]}-${matched[2]}`;
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" 키를 ±delta 개월 만큼 이동시켜 다시 "YYYY-MM" 으로 반환 */
function shiftMonthKey(monthKey: string, delta: number): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return currentMonthKey();
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 앱 시작 시 모든 탭을 "오늘 달"로 초기화한다.
// (이전엔 데이터의 마지막 달로 자동 점프했지만, 사용자 입장에선 항상 현재 달이
// 보이는 게 직관적. 행이 없는 달이면 빈 표가 보이고 사용자가 직접 이전/다음
// 달로 이동할 수 있다.)
function buildDefaultMonthMap(): Record<TabKey, string> {
  const key = currentMonthKey();
  return { shorts: key, longform: key, fullReplay: key };
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("shorts");
  const [appData, setAppData] = useState<AppDataState>({
    schemaByTab: tableSchema,
    rowsByTab: initialRows
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sheetLink, setSheetLink] = useState("");
  const [serviceAccountPath, setServiceAccountPath] = useState("");
  const [sheetsStatus, setSheetsStatus] = useState("");
  const [syncPhase, setSyncPhase] = useState<"idle" | "downloading" | "uploading" | "success" | "error">("idle");
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; label: string }>({
    current: 0,
    total: 0,
    label: ""
  });
  const autoSyncDoneRef = useRef(false);
  const [clientEmail, setClientEmail] = useState("");
  const [isDraggingJson, setIsDraggingJson] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"sheet" | "connection" | "ai" | "etc">("sheet");
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [autoStartLoading, setAutoStartLoading] = useState(false);
  const [autoStartMessage, setAutoStartMessage] = useState("");
  const settingsPanelRef = useRef<HTMLElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [chzzkLink, setChzzkLink] = useState("https://chzzk.naver.com/live/1482d68b3478d2962e9d000ed6a33167");
  const [statusOptions, setStatusOptions] = useState(["Wait", "Wip", "Done", "Publish", "Retake", "Omit"]);
  const [newStatus, setNewStatus] = useState("");
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<EditorRole>("editor");
  const [openAssigneeMenuKey, setOpenAssigneeMenuKey] = useState<string | null>(null);
  const [userCategories, setUserCategories] = useState<ChzzkCategory[]>([]);
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const [onlineCategoryResults, setOnlineCategoryResults] = useState<ChzzkCategory[]>([]);
  const [onlineSearching, setOnlineSearching] = useState(false);

  const seedCategories = useMemo<ChzzkCategory[]>(
    () => (chzzkCategoriesSeed.categories as ChzzkCategory[]) || [],
    []
  );

  const allCategories = useMemo<ChzzkCategory[]>(() => {
    const map = new Map<string, ChzzkCategory>();
    for (const c of seedCategories) map.set(c.categoryId, c);
    for (const c of userCategories) map.set(c.categoryId, c);
    return Array.from(map.values());
  }, [seedCategories, userCategories]);

  const filteredCategories = useMemo(() => {
    const q = categorySearchQuery.trim().toLowerCase();
    if (!q) return [];
    return allCategories
      .filter((c) =>
        c.categoryValue.toLowerCase().includes(q) ||
        c.categoryId.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [allCategories, categorySearchQuery]);

  /**
   * 로컬(시드+사용자) 검색 결과가 비어있을 때만 비공식 search/lives로 온라인 폴백.
   * 350ms debounce + 결과는 별도 영역으로 표기 (사용자가 클릭 시 영구 등록).
   */
  useEffect(() => {
    const q = categorySearchQuery.trim();
    if (!q) {
      setOnlineCategoryResults([]);
      setOnlineSearching(false);
      return;
    }
    if (filteredCategories.length > 0) {
      setOnlineCategoryResults([]);
      setOnlineSearching(false);
      return;
    }
    const api = window.electronAPI;
    if (!api?.categoriesSearchOnline) return;
    setOnlineSearching(true);
    const handle = window.setTimeout(async () => {
      const res = await api.categoriesSearchOnline(q, 20);
      const localIds = new Set(allCategories.map((c) => c.categoryId));
      const fresh = (res.ok && res.categories ? res.categories : []).filter(
        (c) => !localIds.has(c.categoryId)
      );
      setOnlineCategoryResults(fresh);
      setOnlineSearching(false);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [categorySearchQuery, filteredCategories.length, allCategories]);
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<UndoSnapshot[]>([]);
  const [maxUndoSize, setMaxUndoSize] = useState(10);
  /** 같은 (cellKey) 연속 편집은 한 번의 history entry로 묶기 위한 ref */
  const lastEditCellRef = useRef<string | null>(null);
  const [historyLogs, setHistoryLogs] = useState<string[]>([]);
  const [urlViewMode, setUrlViewMode] = useState<Record<string, boolean>>({});
  const [typeMenuColumnKey, setTypeMenuColumnKey] = useState<string | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const [dragColumnKey, setDragColumnKey] = useState<string | null>(null);
  const [dropTargetRowId, setDropTargetRowId] = useState<string | null>(null);
  const [dropTargetColumnKey, setDropTargetColumnKey] = useState<string | null>(null);
  const dragHistoryPushedRef = useRef(false);
  const [openStatusMenuKey, setOpenStatusMenuKey] = useState<string | null>(null);
  const [openPresetMenuKey, setOpenPresetMenuKey] = useState<string | null>(null);
  const [presetCustomInput, setPresetCustomInput] = useState("");
  const [resizingColumnKey, setResizingColumnKey] = useState<string | null>(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(180);
  const [editingTagCell, setEditingTagCell] = useState<string | null>(null);
  const [editingTagIndex, setEditingTagIndex] = useState<number>(-1);
  const [newTagCell, setNewTagCell] = useState<string | null>(null);

  const [isDetecting, setIsDetecting] = useState(false);
  const [chzzkLive, setChzzkLive] = useState(false);
  const [chzzkCategory, setChzzkCategory] = useState("");
  const [chzzkTitle, setChzzkTitle] = useState("");
  const [chzzkUptime, setChzzkUptime] = useState("");
  const [pollingInterval, setPollingInterval] = useState(3000);
  const [timelineLog, setTimelineLog] = useState<string[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // 숏폼/롱폼 [할 일] / [완료됨] 그룹 접힘 상태. 탭별로 보존하고 localStorage에 저장.
  type GroupKey = "todo" | "done";
  const [groupCollapsed, setGroupCollapsed] = useState<Record<TabKey, Record<GroupKey, boolean>>>(() => {
    try {
      const raw = localStorage.getItem("inel-scheduler-group-collapsed");
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          shorts: { todo: !!parsed?.shorts?.todo, done: !!parsed?.shorts?.done },
          longform: { todo: !!parsed?.longform?.todo, done: !!parsed?.longform?.done },
          fullReplay: { todo: !!parsed?.fullReplay?.todo, done: !!parsed?.fullReplay?.done }
        };
      }
    } catch {}
    return {
      shorts: { todo: false, done: false },
      longform: { todo: false, done: false },
      fullReplay: { todo: false, done: false }
    };
  });
  const toggleGroupCollapsed = (tab: TabKey, group: GroupKey) => {
    setGroupCollapsed((prev) => {
      const next: Record<TabKey, Record<GroupKey, boolean>> = {
        ...prev,
        [tab]: { ...prev[tab], [group]: !prev[tab][group] }
      };
      try {
        localStorage.setItem("inel-scheduler-group-collapsed", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // 할 일 / 모두 보기 필터 (탭별 / 기본은 할일만 보기)
  type TaskFilter = "todoOnly" | "all";
  const [taskFilter, setTaskFilter] = useState<Record<TabKey, TaskFilter>>(() => {
    try {
      const raw = localStorage.getItem("inel-scheduler-task-filter");
      if (raw) {
        const parsed = JSON.parse(raw);
        const norm = (v: any): TaskFilter => (v === "all" ? "all" : "todoOnly");
        return {
          shorts: norm(parsed?.shorts),
          longform: norm(parsed?.longform),
          fullReplay: norm(parsed?.fullReplay)
        };
      }
    } catch {}
    return { shorts: "todoOnly", longform: "todoOnly", fullReplay: "todoOnly" };
  });
  const setTaskFilterFor = (tab: TabKey, value: TaskFilter) => {
    setTaskFilter((prev) => {
      const next = { ...prev, [tab]: value };
      try { localStorage.setItem("inel-scheduler-task-filter", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // 그룹별 표시 행 수 (기본 10, 5~30). 그룹 헤더의 컨트롤로 조절.
  const GROUP_VISIBLE_DEFAULT = 10;
  const GROUP_VISIBLE_MIN = 5;
  const GROUP_VISIBLE_MAX = 30;
  const [groupVisibleCount, setGroupVisibleCount] = useState<Record<TabKey, Record<GroupKey, number>>>(() => {
    try {
      const raw = localStorage.getItem("inel-scheduler-group-visible-count");
      if (raw) {
        const parsed = JSON.parse(raw);
        const norm = (v: any) => {
          const n = Math.round(Number(v));
          if (!Number.isFinite(n)) return GROUP_VISIBLE_DEFAULT;
          return Math.min(GROUP_VISIBLE_MAX, Math.max(GROUP_VISIBLE_MIN, n));
        };
        return {
          shorts: { todo: norm(parsed?.shorts?.todo), done: norm(parsed?.shorts?.done) },
          longform: { todo: norm(parsed?.longform?.todo), done: norm(parsed?.longform?.done) },
          fullReplay: { todo: norm(parsed?.fullReplay?.todo), done: norm(parsed?.fullReplay?.done) }
        };
      }
    } catch {}
    return {
      shorts: { todo: GROUP_VISIBLE_DEFAULT, done: GROUP_VISIBLE_DEFAULT },
      longform: { todo: GROUP_VISIBLE_DEFAULT, done: GROUP_VISIBLE_DEFAULT },
      fullReplay: { todo: GROUP_VISIBLE_DEFAULT, done: GROUP_VISIBLE_DEFAULT }
    };
  });
  const adjustGroupVisible = (tab: TabKey, group: GroupKey, delta: number) => {
    setGroupVisibleCount((prev) => {
      const cur = prev[tab]?.[group] ?? GROUP_VISIBLE_DEFAULT;
      const nv = Math.min(GROUP_VISIBLE_MAX, Math.max(GROUP_VISIBLE_MIN, cur + delta));
      const next: Record<TabKey, Record<GroupKey, number>> = {
        ...prev,
        [tab]: { ...prev[tab], [group]: nv }
      };
      try { localStorage.setItem("inel-scheduler-group-visible-count", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // AI provider/모델/API key + 임시 모달 상태
  const [aiProvider, setAiProvider] = useState<AiProvider>(() => {
    try {
      const v = localStorage.getItem("inel-scheduler-ai-provider");
      if (v === "openai" || v === "anthropic" || v === "google") return v;
    } catch {}
    return "google";
  });
  const [aiApiKey, setAiApiKey] = useState<string>(() => {
    try { return localStorage.getItem("inel-scheduler-ai-apikey") || ""; } catch { return ""; }
  });
  const [aiModel, setAiModel] = useState<string>(() => {
    try { return localStorage.getItem("inel-scheduler-ai-model") || ""; } catch { return ""; }
  });
  const [aiAvailableModels, setAiAvailableModels] = useState<AiModelInfo[]>(() => {
    try {
      const raw = localStorage.getItem("inel-scheduler-ai-models");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.slice(0, 5);
      }
    } catch {}
    return [];
  });
  const [aiModelLoading, setAiModelLoading] = useState(false);
  const [aiModelError, setAiModelError] = useState("");
  const [aiKeyVisible, setAiKeyVisible] = useState(false);

  const persistAiState = (
    provider: AiProvider,
    apiKey: string,
    model: string,
    models?: AiModelInfo[]
  ) => {
    try {
      localStorage.setItem("inel-scheduler-ai-provider", provider);
      localStorage.setItem("inel-scheduler-ai-apikey", apiKey);
      localStorage.setItem("inel-scheduler-ai-model", model);
      if (models) localStorage.setItem("inel-scheduler-ai-models", JSON.stringify(models));
    } catch {}
  };

  const refreshAiModels = async () => {
    setAiModelError("");
    setAiModelLoading(true);
    dlog(`[AI:list-models] 요청 시작 provider=${aiProvider} apiKey=${aiApiKey ? aiApiKey.slice(0, 8) + "…(" + aiApiKey.length + "자)" : "(없음)"}`);
    try {
      if (!window.electronAPI?.aiListModels) {
        throw new Error("Electron API 사용 불가 (브라우저 단독 실행?)");
      }
      if (!aiApiKey) throw new Error("API 키를 먼저 입력해주세요");
      const res = await window.electronAPI.aiListModels(aiProvider, aiApiKey);
      if (!res.ok) {
        dlog(`[AI:list-models] 실패: ${res.error || "(no error)"}`);
        throw new Error(res.error || "모델 조회 실패");
      }
      const list = res.models || [];
      dlog(`[AI:list-models] 성공: ${res.totalCount}개 중 상위 ${list.length}개 (${res.elapsedMs}ms)`);
      list.forEach((m, i) => dlog(`  ${i + 1}. ${m.id} (${m.label})`));
      setAiAvailableModels(list);
      const newModel = list.find((m) => m.id === aiModel)?.id || list[0]?.id || "";
      setAiModel(newModel);
      persistAiState(aiProvider, aiApiKey, newModel, list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiModelError(msg);
      dlog(`[AI:list-models] FAIL: ${msg}`);
    } finally {
      setAiModelLoading(false);
    }
  };

  const openAiSetupHelp = async () => {
    const api = window.electronAPI;
    if (!api?.helpOpenAiSetup) {
      dlog("AI 가이드 열기 불가 (Electron 환경 아님)");
      return;
    }
    const res = await api.helpOpenAiSetup();
    if (res.ok) dlog(`[AI:help] 가이드 열림: ${res.url}`);
    else dlog(`[AI:help] 실패: ${res.error}`);
  };

  // ── 윈도우 시작 시 자동 실행 ──
  useEffect(() => {
    let cancelled = false;
    const api = (window as any).electronAPI;
    if (!api?.autostartGet) return;
    api.autostartGet().then((res: any) => {
      if (cancelled) return;
      if (res?.ok) setAutoStartEnabled(!!res.openAtLogin);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const toggleAutoStart = async (next: boolean) => {
    const api = (window as any).electronAPI;
    if (!api?.autostartSet) {
      setAutoStartMessage("Electron 환경이 아니라 적용 불가");
      return;
    }
    setAutoStartLoading(true);
    setAutoStartMessage("");
    try {
      const res = await api.autostartSet(next);
      if (res?.ok) {
        setAutoStartEnabled(!!res.openAtLogin);
        if (res.warning) setAutoStartMessage(res.warning);
        else setAutoStartMessage(next ? "자동 실행 활성화됨" : "자동 실행 비활성화됨");
        dlog(`[autostart] ${next ? "ON" : "OFF"} (effective=${res.openAtLogin})`);
      } else {
        setAutoStartMessage(`실패: ${res?.error || "unknown"}`);
        dlog(`[autostart] FAIL: ${res?.error}`);
      }
    } catch (err: any) {
      setAutoStartMessage(`예외: ${err?.message || String(err)}`);
    } finally {
      setAutoStartLoading(false);
    }
  };

  // ── CSV 임포트 모달 ──
  type CsvImportPhase = "idle" | "parsed" | "analyzing" | "analyzed" | "failed" | "uploading" | "uploaded";
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvIsDragging, setCsvIsDragging] = useState(false);
  const [csvFileName, setCsvFileName] = useState("");
  const [csvHeader, setCsvHeader] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvPhase, setCsvPhase] = useState<CsvImportPhase>("idle");
  const [csvErrorMsg, setCsvErrorMsg] = useState("");
  const [csvMapping, setCsvMapping] = useState<AiMapping | null>(null);
  const [csvConvertedRows, setCsvConvertedRows] = useState<RowItem[]>([]);
  const [csvTargetTab, setCsvTargetTab] = useState<TabKey>("shorts");

  const resetCsvModal = () => {
    setCsvFileName("");
    setCsvHeader([]);
    setCsvRows([]);
    setCsvPhase("idle");
    setCsvErrorMsg("");
    setCsvMapping(null);
    setCsvConvertedRows([]);
  };

  // RFC4180 호환 간단 CSV 파서 (UTF-8 BOM, quoted field, escaped quote, CRLF/LF)
  const parseCSV = (text: string): string[][] => {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\r") { /* skip CR */ }
        else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((x) => (x || "").length > 0));
  };

  const handleCsvFileLoaded = async (file: File) => {
    dlog(`[AI:csv] 파일 로드: name=${file.name} size=${file.size}B type=${file.type || "?"}`);
    setCsvErrorMsg("");
    setCsvFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setCsvPhase("failed");
      setCsvErrorMsg("CSV 파일만 가능합니다.");
      dlog(`[AI:csv] FAIL: 확장자 .csv 아님`);
      return;
    }
    try {
      const text = await file.text();
      dlog(`[AI:csv] 파싱 시작 chars=${text.length}`);
      const rows = parseCSV(text);
      if (rows.length === 0) throw new Error("CSV에 행이 없습니다");
      const header = rows[0];
      const data = rows.slice(1);
      dlog(`[AI:csv] 파싱 완료: header=${header.length} cols, data=${data.length} rows`);
      dlog(`[AI:csv] header: ${JSON.stringify(header)}`);
      setCsvHeader(header);
      setCsvRows(data);
      setCsvPhase("parsed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCsvPhase("failed");
      setCsvErrorMsg(`CSV 파싱 실패: ${msg}`);
      dlog(`[AI:csv] FAIL: 파싱 ${msg}`);
    }
  };

  const handleCsvDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    setCsvIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) {
      dlog(`[AI:csv] 드롭에 파일 없음`);
      setCsvPhase("failed");
      setCsvErrorMsg("파일을 드롭해주세요.");
      return;
    }
    await handleCsvFileLoaded(file);
  };

  const csvSchemaForAI = () => {
    const cols = tableSchema[csvTargetTab];
    return cols.map((c) => ({
      key: c.key,
      label: c.label,
      type: c.type,
      options: c.type === "preset" ? c.presetOptions : (c.type === "status" ? statusOptions.map((s) => s.value) : undefined)
    }));
  };

  // 매핑 + 우리 schema에 맞춰 RowItem[] 생성
  const applyCsvMapping = (mapping: AiMapping): RowItem[] => {
    const SAMPLE_KEYS = new Set(tableSchema[csvTargetTab].map((c) => c.key));
    const sharedKeys = new Set(tableSchema[csvTargetTab].filter((c) => c.shared).map((c) => c.key));
    const headerMap = mapping.headerMap || {};
    const valueMaps = mapping.valueMaps || {};
    const splitColumns = mapping.splitColumns || {};
    const dateFormat = mapping.dateFormat || {};

    const ignored = new Set((mapping.ignoreColumns || []).map(String));
    const indexByCsvHeader: Record<string, number> = {};
    csvHeader.forEach((h, i) => { indexByCsvHeader[h] = i; });

    let invalidCount = 0;
    const out: RowItem[] = [];

    for (let rIdx = 0; rIdx < csvRows.length; rIdx++) {
      const csvRow = csvRows[rIdx];
      const values: Record<string, string> = {};
      const editor: Record<string, string> = {};
      const thumb: Record<string, string> = {};

      for (const csvCol of csvHeader) {
        if (ignored.has(csvCol)) continue;
        const ourKey = headerMap[csvCol];
        if (!ourKey || ourKey === "null" || !SAMPLE_KEYS.has(ourKey)) continue;
        let raw = csvRow[indexByCsvHeader[csvCol]] ?? "";
        raw = String(raw).trim();

        // value map (enum 변환)
        if (valueMaps[ourKey] && valueMaps[ourKey][raw]) raw = valueMaps[ourKey][raw];

        // date format 정규화 (YYYY-MM-DD)
        if (dateFormat[ourKey] && raw) raw = normalizeDate(raw, dateFormat[ourKey]) || raw;

        // multi-tag split
        if (splitColumns[ourKey] && raw) {
          const parts = raw.split(splitColumns[ourKey].delimiter)
            .map((s) => splitColumns[ourKey].trim ? s.trim() : s)
            .filter(Boolean);
          raw = parts.join("|");
        }

        if (sharedKeys.has(ourKey)) {
          values[ourKey] = raw;
        } else {
          // 2행 구조 — twoRowAssignment 힌트 우선
          const twoRow = mapping.twoRowAssignment || {};
          if (twoRow.thumbnailerColumn && csvCol === twoRow.thumbnailerColumn) thumb[ourKey] = raw;
          else if (twoRow.editorColumn && csvCol === twoRow.editorColumn) editor[ourKey] = raw;
          else editor[ourKey] = raw; // 기본: 영상편집자 행
        }
      }

      if (Object.keys(values).length === 0 && Object.keys(editor).length === 0 && Object.keys(thumb).length === 0) {
        invalidCount++;
        continue;
      }

      const newRow: RowItem = {
        id: `csv-${Date.now()}-${rIdx}-${Math.random().toString(36).slice(2, 7)}`,
        values
      };
      if (csvTargetTab !== "fullReplay") {
        newRow.thumbnailer = thumb;
        newRow.editor = editor;
      } else {
        // 다시보기 탭은 단일 행 — editor/thumb 합치기
        newRow.values = { ...values, ...editor, ...thumb };
      }
      out.push(newRow);
    }

    dlog(`[AI:apply] 변환 완료: 입력 ${csvRows.length}행 → 출력 ${out.length}행 (무효 ${invalidCount}행)`);
    return out;
  };

  // YYYY-MM-DD로 정규화
  const normalizeDate = (raw: string, format: string): string | null => {
    const f = (format || "YYYY-MM-DD").toUpperCase();
    const m = raw.match(/(\d{1,4})\D(\d{1,2})\D(\d{1,4})/);
    if (!m) return null;
    let y: string, mo: string, d: string;
    if (f.startsWith("Y")) { y = m[1]; mo = m[2]; d = m[3]; }
    else if (f.startsWith("M")) { mo = m[1]; d = m[2]; y = m[3]; }
    else if (f.startsWith("D")) { d = m[1]; mo = m[2]; y = m[3]; }
    else { y = m[1]; mo = m[2]; d = m[3]; }
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    const yy = y.padStart(4, "0");
    const mm = mo.padStart(2, "0");
    const dd = d.padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };

  const runCsvAnalyze = async () => {
    setCsvErrorMsg("");
    setCsvPhase("analyzing");
    dlog(`[AI:analyze] CSV 분석 시작 provider=${aiProvider} model=${aiModel || "(없음)"} target=${csvTargetTab}`);
    if (!aiApiKey) {
      setCsvPhase("failed");
      setCsvErrorMsg("AI API 키를 먼저 설정에서 등록해주세요.");
      dlog(`[AI:analyze] FAIL: API 키 없음`);
      return;
    }
    if (!aiModel) {
      setCsvPhase("failed");
      setCsvErrorMsg("AI 모델을 먼저 선택해주세요. (설정 → AI 연결 → 모델 갱신)");
      dlog(`[AI:analyze] FAIL: 모델 없음`);
      return;
    }
    try {
      const sample = csvRows.slice(0, Math.min(8, csvRows.length));
      dlog(`[AI:analyze] 전송: header=${csvHeader.length}컬럼, sample=${sample.length}행 (전체 ${csvRows.length}행 중)`);
      const ourSchema = csvSchemaForAI();
      const res = await window.electronAPI?.aiAnalyzeCsv?.(
        aiProvider, aiApiKey, aiModel, csvHeader, sample, ourSchema
      );
      // trace를 디버그 패널에 그대로 흘림
      if (res?.trace) res.trace.forEach((line) => dlog(line));
      if (!res?.ok) {
        setCsvPhase("failed");
        setCsvErrorMsg(res?.error || "AI 분석 실패");
        dlog(`[AI:analyze] FAIL: ${res?.error}`);
        return;
      }
      const mapping = res.mapping!;
      setCsvMapping(mapping);
      dlog(`[AI:analyze] OK (${res.elapsedMs}ms)`);
      dlog(`[AI:analyze] mapping notes: ${mapping.notes || "(없음)"}`);
      dlog(`[AI:analyze] headerMap raw: ${JSON.stringify(mapping.headerMap)}`);
      const converted = applyCsvMapping(mapping);
      setCsvConvertedRows(converted);
      if (converted.length === 0) {
        setCsvPhase("failed");
        setCsvErrorMsg("매핑 결과 변환된 행이 없습니다. 매핑이 너무 적을 수 있어요.");
        return;
      }
      setCsvPhase("analyzed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCsvPhase("failed");
      setCsvErrorMsg(`AI 분석 실패: ${msg}`);
      dlog(`[AI:analyze] FAIL exception: ${msg}`);
    }
  };

  const runCsvUpload = async () => {
    if (csvConvertedRows.length === 0) return;
    setCsvPhase("uploading");
    dlog(`[AI:upload] ${csvConvertedRows.length}행을 ${csvTargetTab} 탭에 추가`);

    // 1) 활성 데이터에 추가 (undo 가능)
    pushHistory(`AI CSV 가져오기 (${csvTargetTab}, ${csvConvertedRows.length}행)`);
    setAppData((prev) => {
      const next = cloneState(prev);
      next.rowsByTab[csvTargetTab] = [...next.rowsByTab[csvTargetTab], ...csvConvertedRows];
      return next;
    });
    dlog(`[AI:upload] 로컬 상태 갱신 완료`);

    // 2) 시트에 자동 업로드
    try {
      const ok = await runExport({ silent: true });
      if (ok) {
        dlog(`[AI:upload] 시트 업로드 성공`);
        setCsvPhase("uploaded");
      } else {
        dlog(`[AI:upload] 시트 업로드 실패 (runExport=false). 로컬에는 추가됨.`);
        setCsvPhase("uploaded");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dlog(`[AI:upload] 시트 업로드 예외: ${msg}`);
      setCsvPhase("uploaded");
    }
  };

  const copyDebugLogs = async () => {
    const text = debugLogsRef.current.join("\n");
    if (!text) {
      dlog("디버그 로그가 비어있습니다");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      dlog(`[debug] 로그 ${debugLogsRef.current.length}줄을 클립보드에 복사`);
    } catch (err) {
      dlog(`[debug] 클립보드 복사 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const debugLogsRef = useRef<string[]>([]);
  const [debugLogsVersion, setDebugLogsVersion] = useState(0);
  const debugPanelRef = useRef<HTMLDivElement>(null);

  const dlog = (msg: string) => {
    const ts = new Date().toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    debugLogsRef.current = [...debugLogsRef.current, `[${ts}] ${msg}`];
    queueMicrotask(() => setDebugLogsVersion((v) => v + 1));
  };

  const clearDebugLogs = () => {
    debugLogsRef.current = [];
    setDebugLogsVersion((v) => v + 1);
  };

  const debugLogs = debugLogsRef.current;

  useEffect(() => {
    if (debugPanelRef.current) {
      debugPanelRef.current.scrollTop = debugPanelRef.current.scrollHeight;
    }
  }, [debugLogsVersion]);
  const [detectedCategoryDraft, setDetectedCategoryDraft] = useState("");
  const [selectedRowByTab, setSelectedRowByTab] = useState<Record<TabKey, string | null>>({
    shorts: null,
    longform: null,
    fullReplay: null
  });
  const [selectedMonthByTab, setSelectedMonthByTab] = useState<Record<TabKey, string>>(
    buildDefaultMonthMap()
  );

  const columns = useMemo(() => appData.schemaByTab[activeTab], [activeTab, appData.schemaByTab]);
  const data = useMemo(() => appData.rowsByTab[activeTab], [activeTab, appData.rowsByTab]);
  const availableMonthKeys = useMemo(() => {
    const keys = data
      .map((row) => parseMonthKey(row.values.broadcastDate || ""))
      .filter((key): key is string => Boolean(key));
    return Array.from(new Set(keys)).sort();
  }, [data]);
  const selectedMonth = selectedMonthByTab[activeTab];
  const filteredData = useMemo(() => {
    // 데이터가 한 건도 없으면 그대로 (월 필터 적용 안 함)
    if (data.length === 0) return data;
    // selectedMonth 에 해당하는 행만. 데이터가 다른 달에만 있어도 빈 배열 반환 (의도된 동작)
    return data.filter((row) => parseMonthKey(row.values.broadcastDate || "") === selectedMonth);
  }, [data, selectedMonth]);
  // 월 이동은 데이터 유무와 무관하게 ±1개월씩 자유롭게.
  // 화살표는 항상 활성화 (사용자가 직접 조작). 데이터 있는 가장 빠른/늦은 달 ±12개월
  // 까지만 허용해서 무한 이동을 살짝 제한한다.
  const monthBounds = useMemo(() => {
    const todayKey = currentMonthKey();
    const allKeys = [...availableMonthKeys, selectedMonth, todayKey].filter(Boolean).sort();
    const earliest = allKeys[0] || todayKey;
    const latest = allKeys[allKeys.length - 1] || todayKey;
    return { earliest: shiftMonthKey(earliest, -12), latest: shiftMonthKey(latest, 12) };
  }, [availableMonthKeys, selectedMonth]);
  const hasPrevMonth = !!selectedMonth && selectedMonth > monthBounds.earliest;
  const hasNextMonth = !!selectedMonth && selectedMonth < monthBounds.latest;

  /**
   * 새 변경 직전의 상태(appData)를 스택에 push.
   * cellGroupKey가 직전과 동일하면 (같은 셀 연속 편집) 새 항목을 만들지 않고
   * 기존 마지막 항목을 그대로 두어 셀 단위로 묶음. 다른 셀로 이동하거나 구조 변경이면 새 항목 push.
   * 새 변경이 들어오면 redoStack은 비워진다 (분기 상실).
   */
  const pushHistory = (reason: string, cellGroupKey: string | null = null) => {
    if (cellGroupKey && cellGroupKey === lastEditCellRef.current) {
      lastEditCellRef.current = cellGroupKey;
      return;
    }
    lastEditCellRef.current = cellGroupKey;
    const now = new Date().toLocaleString("ko-KR");
    setUndoStack((prev) => {
      const next = [...prev, { state: cloneState(appData), reason, at: now }];
      const overflow = next.length - maxUndoSize;
      return overflow > 0 ? next.slice(overflow) : next;
    });
    setRedoStack([]);
    setHistoryLogs((prev) => [`${now} - ${reason}`, ...prev].slice(0, 20));
  };

  const addRow = () => {
    pushHistory(`${tabs.find((tab) => tab.key === activeTab)?.label || activeTab} 행 추가`);
    const row = createEmptyRow(columns, activeTab);
    if ("broadcastDate" in row.values) {
      row.values.broadcastDate = `${selectedMonthByTab[activeTab]}-01`;
    }
    setAppData((prev) => ({
      ...prev,
      rowsByTab: {
        ...prev.rowsByTab,
        [activeTab]: [...prev.rowsByTab[activeTab], row]
      }
    }));
  };

  const deleteRow = (rowId: string) => {
    pushHistory(`${tabs.find((tab) => tab.key === activeTab)?.label || activeTab} 행 삭제`);
    setAppData((prev) => ({
      ...prev,
      rowsByTab: {
        ...prev.rowsByTab,
        [activeTab]: prev.rowsByTab[activeTab].filter((row) => row.id !== rowId)
      }
    }));
  };

  const updateCell = (rowId: string, columnKey: string, value: string, role: EditorRole | null = null) => {
    const cellGroupKey = `${activeTab}|${rowId}|${columnKey}|${role ?? "shared"}`;
    pushHistory(`셀 수정 (${columnKey})`, cellGroupKey);
    setAppData((prev) => {
      const nextRows = prev.rowsByTab[activeTab].map((row) => {
        if (row.id !== rowId) return row;
        if (role === "thumbnailer") {
          return { ...row, thumbnailer: { ...(row.thumbnailer || {}), [columnKey]: value } };
        }
        if (role === "editor") {
          return { ...row, editor: { ...(row.editor || {}), [columnKey]: value } };
        }
        return { ...row, values: { ...row.values, [columnKey]: value } };
      });
      return {
        ...prev,
        rowsByTab: {
          ...prev.rowsByTab,
          [activeTab]: nextRows
        }
      };
    });
  };

  const addColumn = () => {
    pushHistory(`${tabs.find((tab) => tab.key === activeTab)?.label || activeTab} 열 추가`);
    const newKey = createColumnKey();
    const column: ColumnDef = {
      key: newKey,
      label: "새 헤더",
      type: "text",
      width: 180
    };

    setAppData((prev) => ({
      ...prev,
      schemaByTab: {
        ...prev.schemaByTab,
        [activeTab]: [...prev.schemaByTab[activeTab], column]
      },
      rowsByTab: {
        ...prev.rowsByTab,
        [activeTab]: prev.rowsByTab[activeTab].map((row) => ({
          ...row,
          values: { ...row.values, [newKey]: "" }
        }))
      }
    }));
  };

  const deleteColumn = (columnKey: string) => {
    pushHistory(`${tabs.find((tab) => tab.key === activeTab)?.label || activeTab} 열 삭제`);
    setAppData((prev) => ({
      ...prev,
      schemaByTab: {
        ...prev.schemaByTab,
        [activeTab]: prev.schemaByTab[activeTab].filter((column) => column.key !== columnKey)
      },
      rowsByTab: {
        ...prev.rowsByTab,
        [activeTab]: prev.rowsByTab[activeTab].map((row) => {
          const nextValues = { ...row.values };
          delete nextValues[columnKey];
          return { ...row, values: nextValues };
        })
      }
    }));
  };

  const updateColumnMeta = (columnKey: string, field: "label" | "type", value: string) => {
    setAppData((prev) => ({
      ...prev,
      schemaByTab: {
        ...prev.schemaByTab,
        [activeTab]: prev.schemaByTab[activeTab].map((column) =>
          column.key === columnKey
            ? {
                ...column,
                [field]: field === "type" ? (value as ColumnType) : value
              }
            : column
        )
      }
    }));
  };

  const addStatusOption = () => {
    const trimmed = newStatus.trim();
    if (!trimmed) return;
    if (statusOptions.includes(trimmed)) return;
    setStatusOptions((prev) => [...prev, trimmed]);
    setNewStatus("");
  };

  const removeStatusOption = (target: string) => {
    setStatusOptions((prev) => prev.filter((item) => item !== target));
  };

  const normalizeName = (s: string) => s.trim().normalize("NFC");

  const addStaff = () => {
    const trimmed = normalizeName(newStaffName);
    if (!trimmed) return;
    if (staffList.some((s) => normalizeName(s.name) === trimmed && s.role === newStaffRole)) {
      dlog(`이미 등록된 ${ROLE_LABEL[newStaffRole]}: ${trimmed}`);
      return;
    }
    const member: StaffMember = {
      id: `stf_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: trimmed,
      role: newStaffRole
    };
    setStaffList((prev) => [...prev, member]);
    setNewStaffName("");
    dlog(`${ROLE_LABEL[member.role]} 등록: ${member.name}`);
  };

  const removeStaff = (id: string) => {
    const target = staffList.find((s) => s.id === id);
    setStaffList((prev) => prev.filter((s) => s.id !== id));
    if (target) dlog(`${ROLE_LABEL[target.role]} 삭제: ${target.name}`);
  };

  /** maxUndoSize 줄이면 기존 스택도 즉시 잘라냄. */
  useEffect(() => {
    setUndoStack((prev) => (prev.length > maxUndoSize ? prev.slice(prev.length - maxUndoSize) : prev));
    setRedoStack((prev) => (prev.length > maxUndoSize ? prev.slice(prev.length - maxUndoSize) : prev));
  }, [maxUndoSize]);

  /**
   * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 단축키.
   * 입력 컴포넌트(input/textarea/contenteditable)에서는 OS 기본 동작이 우선하도록 위임.
   * 그래야 셀 편집 중 한 글자 단위 OS undo가 살아있고, 셀 외부 영역에서는 앱 단위 undo가 동작한다.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      const lower = e.key.toLowerCase();
      if (lower === "z" && !e.shiftKey) {
        e.preventDefault();
        undoLast();
      } else if ((lower === "z" && e.shiftKey) || lower === "y") {
        e.preventDefault();
        redoLast();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const undoLast = () => {
    if (undoStack.length === 0) return;
    const snapshot = undoStack[undoStack.length - 1];
    const now = new Date().toLocaleString("ko-KR");
    setRedoStack((prev) => [...prev, { state: cloneState(appData), reason: snapshot.reason, at: now }]);
    setAppData(snapshot.state);
    setUndoStack((prev) => prev.slice(0, -1));
    lastEditCellRef.current = null;
    setHistoryLogs((prev) => [`${now} - 되살리기: ${snapshot.reason}`, ...prev].slice(0, 20));
  };

  const redoLast = () => {
    if (redoStack.length === 0) return;
    const snapshot = redoStack[redoStack.length - 1];
    const now = new Date().toLocaleString("ko-KR");
    setUndoStack((prev) => {
      const next = [...prev, { state: cloneState(appData), reason: snapshot.reason, at: now }];
      const overflow = next.length - maxUndoSize;
      return overflow > 0 ? next.slice(overflow) : next;
    });
    setAppData(snapshot.state);
    setRedoStack((prev) => prev.slice(0, -1));
    lastEditCellRef.current = null;
    setHistoryLogs((prev) => [`${now} - 다시실행: ${snapshot.reason}`, ...prev].slice(0, 20));
  };

  const toggleUrlViewMode = (cellKey: string, nextMode: boolean) => {
    setUrlViewMode((prev) => ({ ...prev, [cellKey]: nextMode }));
  };

  const getTypeIcon = (type: ColumnType) => {
    const commonProps = {
      width: 14,
      height: 14,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const
    };

    switch (type) {
      case "text":
        return (
          <svg {...commonProps}>
            <path d="M4 18L10 6L16 18" />
            <path d="M6.8 13H13.2" />
            <path d="M19 8V18" />
            <path d="M16 11H22" />
          </svg>
        );
      case "select":
        return (
          <svg {...commonProps}>
            <path d="M5 7H19" />
            <path d="M5 12H15" />
            <path d="M5 17H11" />
          </svg>
        );
      case "status":
        return (
          <svg {...commonProps}>
            <circle cx="12" cy="12" r="7" />
            <path d="M9 12L11 14L15 10" />
          </svg>
        );
      case "date":
        return (
          <svg {...commonProps}>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3V7" />
            <path d="M8 3V7" />
            <path d="M3 11H21" />
          </svg>
        );
      case "url":
        return (
          <svg {...commonProps}>
            <path d="M10 13A5 5 0 0 0 17 13L19 11A5 5 0 0 0 12 4L11 5" />
            <path d="M14 11A5 5 0 0 0 7 11L5 13A5 5 0 0 0 12 20L13 19" />
          </svg>
        );
      case "preset":
        return (
          <svg {...commonProps}>
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d="M8 10H16" />
            <path d="M8 14H13" />
            <path d="M16 16L18 18L21 14" />
          </svg>
        );
      default:
        return (
          <svg {...commonProps}>
            <path d="M5 12H19" />
            <path d="M12 5V19" />
          </svg>
        );
    }
  };

  const swapRow = (targetRowId: string) => {
    if (!dragRowId || dragRowId === targetRowId) return;
    if (!dragHistoryPushedRef.current) {
      pushHistory(`${tabs.find((tab) => tab.key === activeTab)?.label || activeTab} 행 순서 변경`);
      dragHistoryPushedRef.current = true;
    }
    setAppData((prev) => {
      const rows = [...prev.rowsByTab[activeTab]];
      const fromIndex = rows.findIndex((row) => row.id === dragRowId);
      const toIndex = rows.findIndex((row) => row.id === targetRowId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const [moved] = rows.splice(fromIndex, 1);
      rows.splice(toIndex, 0, moved);
      return {
        ...prev,
        rowsByTab: {
          ...prev.rowsByTab,
          [activeTab]: rows
        }
      };
    });
  };

  const swapColumn = (targetColumnKey: string) => {
    if (!dragColumnKey || dragColumnKey === targetColumnKey) return;
    if (!dragHistoryPushedRef.current) {
      pushHistory(`${tabs.find((tab) => tab.key === activeTab)?.label || activeTab} 열 순서 변경`);
      dragHistoryPushedRef.current = true;
    }
    setAppData((prev) => {
      const columnsNow = [...prev.schemaByTab[activeTab]];
      const fromIndex = columnsNow.findIndex((column) => column.key === dragColumnKey);
      const toIndex = columnsNow.findIndex((column) => column.key === targetColumnKey);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const [moved] = columnsNow.splice(fromIndex, 1);
      columnsNow.splice(toIndex, 0, moved);
      return {
        ...prev,
        schemaByTab: {
          ...prev.schemaByTab,
          [activeTab]: columnsNow
        }
      };
    });
  };

  const endDrag = () => {
    setDragRowId(null);
    setDragColumnKey(null);
    setDropTargetRowId(null);
    setDropTargetColumnKey(null);
    dragHistoryPushedRef.current = false;
  };

  const updateColumnWidth = (columnKey: string, width: number) => {
    const nextWidth = Math.max(120, width);
    setAppData((prev) => ({
      ...prev,
      schemaByTab: {
        ...prev.schemaByTab,
        [activeTab]: prev.schemaByTab[activeTab].map((column) =>
          column.key === columnKey ? { ...column, width: nextWidth } : column
        )
      }
    }));
  };

  const startResize = (columnKey: string, currentWidth: number, clientX: number) => {
    setResizingColumnKey(columnKey);
    setResizeStartX(clientX);
    setResizeStartWidth(currentWidth);
  };

  const commitGuard = useRef(false);

  const startNewTag = (rowId: string, colKey: string) => {
    dlog(`startNewTag: row=${rowId}, col=${colKey}`);
    commitGuard.current = false;
    setNewTagCell(`${rowId}_${colKey}`);
  };

  const commitNewTag = (rowId: string, colKey: string, tagName: string) => {
    try {
      dlog(`commitNewTag called: tag="${tagName}", guard=${commitGuard.current}`);
      if (commitGuard.current) { dlog("commitNewTag: BLOCKED by guard"); return; }
      commitGuard.current = true;

      const trimmed = tagName.trim();
      dlog(`commitNewTag: trimmed="${trimmed}", rowId=${rowId}, colKey=${colKey}`);

      if (!trimmed) {
        dlog("commitNewTag: empty tag, skip");
        setNewTagCell(null);
        return;
      }

      const tab = activeTab;
      dlog(`commitNewTag: tab=${tab}`);
      const rows = appData.rowsByTab[tab];
      dlog(`commitNewTag: rows count=${rows?.length}`);
      const currentRow = rows?.find((r) => r.id === rowId);
      dlog(`commitNewTag: currentRow found=${!!currentRow}`);
      const currentVal = currentRow?.values[colKey] || "";
      dlog(`commitNewTag: currentVal="${currentVal}"`);
      const currentTags = parseTags(currentVal);
      dlog(`commitNewTag: currentTags=[${currentTags.join(",")}], adding "${trimmed}"`);

      if (currentTags.includes(trimmed)) {
        dlog("commitNewTag: duplicate! skip");
        setNewTagCell(null);
        return;
      }

      const newTags = [...currentTags, trimmed];
      const newVal = stringifyTags(newTags);
      dlog(`commitNewTag: newVal="${newVal}"`);

      pushHistory("addCategoryTag");
      setAppData((prev) => ({
        ...prev,
        rowsByTab: {
          ...prev.rowsByTab,
          [tab]: prev.rowsByTab[tab].map((r) =>
            r.id === rowId ? { ...r, values: { ...r.values, [colKey]: newVal } } : r
          )
        }
      }));
      dlog("commitNewTag: setAppData called, now clearing newTagCell");
      setNewTagCell(null);
      dlog("commitNewTag: DONE");
    } catch (err: unknown) {
      dlog(`commitNewTag ERROR: ${err instanceof Error ? err.message : String(err)}`);
      setNewTagCell(null);
    }
  };

  const editGuard = useRef(false);

  const startEditTag = (rowId: string, colKey: string, idx: number) => {
    dlog(`startEditTag: row=${rowId}, col=${colKey}, idx=${idx}`);
    editGuard.current = false;
    setEditingTagCell(`${rowId}_${colKey}`);
    setEditingTagIndex(idx);
  };

  const commitEditTag = (rowId: string, colKey: string, idx: number, newName: string) => {
    dlog(`commitEditTag: idx=${idx}, name="${newName}", guard=${editGuard.current}`);
    if (editGuard.current) { dlog("commitEditTag: BLOCKED by guard"); return; }
    editGuard.current = true;

    const tab = activeTab;
    const currentRow = appData.rowsByTab[tab]?.find((r) => r.id === rowId);
    const existing = parseTags(currentRow?.values[colKey] || "");
    if (!newName.trim()) {
      existing.splice(idx, 1);
    } else {
      existing[idx] = newName.trim();
    }
    const newVal = stringifyTags(existing);
    dlog(`commitEditTag: saving newVal="${newVal}"`);
    pushHistory("editCategoryTag");
    setAppData((prev) => ({
      ...prev,
      rowsByTab: {
        ...prev.rowsByTab,
        [tab]: prev.rowsByTab[tab].map((r) =>
          r.id === rowId ? { ...r, values: { ...r.values, [colKey]: newVal } } : r
        )
      }
    }));
    setEditingTagCell(null);
    setEditingTagIndex(-1);
  };

  const addCategoryTag = (rowId: string, colKey: string, newTag: string) => {
    dlog(`addCategoryTag: row=${rowId}, tag="${newTag}"`);
    if (!newTag.trim()) return;
    const tab = activeTab;
    const rows = appData.rowsByTab[tab];
    const row = rows?.find((r) => r.id === rowId);
    if (!row) return;
    const existing = parseTags(row.values[colKey] || "");
    if (existing.includes(newTag.trim())) return;
    existing.push(newTag.trim());
    pushHistory("addCategoryTag");
    setAppData((prev) => ({
      ...prev,
      rowsByTab: {
        ...prev.rowsByTab,
        [tab]: prev.rowsByTab[tab].map((r) =>
          r.id === rowId ? { ...r, values: { ...r.values, [colKey]: stringifyTags(existing) } } : r
        )
      }
    }));
  };

  const removeCategoryTag = (rowId: string, colKey: string, tagIndex: number) => {
    dlog(`removeCategoryTag: row=${rowId}, idx=${tagIndex}`);
    const tab = activeTab;
    const rows = appData.rowsByTab[tab];
    const row = rows?.find((r) => r.id === rowId);
    if (!row) return;
    const existing = parseTags(row.values[colKey] || "");
    existing.splice(tagIndex, 1);
    pushHistory("removeCategoryTag");
    setAppData((prev) => ({
      ...prev,
      rowsByTab: {
        ...prev.rowsByTab,
        [tab]: prev.rowsByTab[tab].map((r) =>
          r.id === rowId ? { ...r, values: { ...r.values, [colKey]: stringifyTags(existing) } } : r
        )
      }
    }));
  };

  const applyDetectedCategoryTag = () => {
    const rowId = selectedRowByTab[activeTab];
    if (!rowId || !detectedCategoryDraft.trim()) return;
    const schema = appData.schemaByTab[activeTab];
    const catCol = schema?.find((c) => c.label.includes("카테고리"));
    if (!catCol) return;
    addCategoryTag(rowId, catCol.key, detectedCategoryDraft.trim());
    setDetectedCategoryDraft("");
  };

  const detectRowId = useRef<string | null>(null);
  const firstCategoryRecorded = useRef(false);
  // 같은 세션 polling 중 openDate 흔들림을 잡기 위한 검증용 ref. 디버그 로그로만 사용
  const lastSeenOpenDate = useRef<string>("");
  // 카테고리 변경 즉시 시트 patch (t12-a) 디바운스 timer
  const patchDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // useEffect deps 폭증 방지용. 활성 polling 핸들러 내부에서 최신 값 참조
  const appDataRef = useRef<AppData | null>(null);
  const sheetLinkRef = useRef<string>("");
  const allCategoriesRef = useRef<ChzzkCategory[]>([]);

  /**
   * 방송 감지 시 다시보기 탭의 활성 행을 보장한다.
   *
   * 정책:
   * - 한 행 = 한 방송 세션(LIVE ON → OFF 까지). 자정을 넘겨도 같은 행 유지.
   * - 같은 날 방송 여러 번 = 방송시작시간 다른 새 행.
   * - **세션 핑거프린트(broadcastDate + broadcastStartTime[HH:MM:SS])** 매칭으로
   *   인터넷 끊김 / 앱 재시작 / 감지 OFF→ON 같은 외부 단절 후에도 같은 행 재사용.
   *   → 치지직의 openDate 는 방송이 켜진 그 시점에서 변하지 않으므로 안전한 키.
   *
   * 매칭 안전장치:
   * 1) 활성 세션(detectRowId.current) 동안에는 매칭 자체를 건너뛴다 (매 polling no-op)
   *    → 같은 세션 내에서 openDate 가 만에 하나 흔들려도 영향 없음.
   * 2) 매칭은 다단계: 정확(HH:MM:SS) → 분 단위(HH:MM) prefix → 실패 시 새 행.
   *    → 1분 이내의 미세 흔들림이나 구 시트 데이터(HH:MM)와도 호환.
   *
   * 시작시간 산정:
   * - openDate(KST "YYYY-MM-DD HH:mm:ss") 가 있으면 초까지 그대로 사용.
   * - 없으면 PC 의 KST(Asia/Seoul) 현재 시각(초 포함)으로 폴백.
   */
  const ensureDetectRow = useCallback((title: string, openDate?: string, currentCategory?: string) => {
    setAppData((prev) => {
      const tab: TabKey = "fullReplay";
      const rows = prev.rowsByTab[tab];

      // 활성 행 존재 시 매칭 자체를 건너뜀 (안전장치 1)
      if (detectRowId.current && rows.some((r) => r.id === detectRowId.current)) {
        return prev;
      }

      // 1) openDate 파싱 → HH:MM:SS 까지
      let datePart = "";
      let timePartFull = "";
      let timePartMin = "";
      if (openDate) {
        const m = openDate.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
        if (m) {
          datePart = m[1];
          timePartFull = m[2].length === 5 ? `${m[2]}:00` : m[2];
          timePartMin = timePartFull.slice(0, 5);
        }
      }

      // 2) 다단계 매칭 (안전장치 2): 정확 → 분 단위 prefix
      if (datePart && timePartFull) {
        let matched = rows.find(
          (r) => r.values.broadcastDate === datePart && r.values.broadcastStartTime === timePartFull
        );
        let matchKind = "exact";
        if (!matched) {
          matched = rows.find(
            (r) =>
              r.values.broadcastDate === datePart &&
              (r.values.broadcastStartTime || "").slice(0, 5) === timePartMin
          );
          matchKind = "minute-fallback";
        }
        if (matched) {
          detectRowId.current = matched.id;
          const tl = matched.values.categoryTimeline || "";
          const lastLine = tl.split("\n").filter(Boolean).pop() || "";
          const lastCat = lastLine.includes(" - ") ? lastLine.split(" - ").slice(1).join(" - ") : "";
          firstCategoryRecorded.current = !!currentCategory && lastCat === currentCategory;
          dlog(`방송 재감지: 기존 행 재사용 (rowId=${matched.id}, fp=${datePart} ${timePartFull}, match=${matchKind}${firstCategoryRecorded.current ? ", same category" : ""})`);
          return prev;
        }
      }

      // 3) 매칭 행 없음 → 새 행. openDate 없으면 KST 현재 시각으로 폴백
      if (!datePart || !timePartFull) {
        const fmt = new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
        });
        const parts = fmt.formatToParts(new Date());
        const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
        if (!datePart) datePart = `${get("year")}-${get("month")}-${get("day")}`;
        if (!timePartFull) timePartFull = `${get("hour").replace(/^24$/, "00")}:${get("minute")}:${get("second")}`;
      }

      const rowId = `fr_${Date.now()}`;
      detectRowId.current = rowId;
      firstCategoryRecorded.current = false;
      const newRow: RowItem = {
        id: rowId,
        values: {
          upload: "",
          broadcastDate: datePart,
          broadcastStartTime: timePartFull,
          videoTitle: title || "",
          categoryTimeline: ""
        }
      };
      dlog(`createDetectRow: id=${rowId}, title="${title}", date=${datePart}, start=${timePartFull}`);
      return {
        ...prev,
        rowsByTab: {
          ...prev.rowsByTab,
          [tab]: [...rows, newRow]
        }
      };
    });
  }, []);

  // useEffect deps 폭증 방지를 위해 핸들러 내부에서 ref 로 최신 값 참조
  useEffect(() => { appDataRef.current = appData; }, [appData]);
  useEffect(() => { sheetLinkRef.current = sheetLink; }, [sheetLink]);
  useEffect(() => { allCategoriesRef.current = allCategories; }, [allCategories]);

  /**
   * t12-a: 활성 다시보기 행을 시트에 즉시 patch (1행만 update/append).
   * - 매칭 키: (broadcastDate, broadcastStartTime). 이 둘이 unique 하므로 안전.
   * - 시트에 없으면 append, 있으면 같은 행 update.
   * - 인증/링크 누락 시 silent skip (로그만).
   */
  const flushPatchActiveRow = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    const rowId = detectRowId.current;
    if (!rowId) return;
    const sheetUrl = sheetLinkRef.current;
    if (!sheetUrl) {
      dlog(`[patch] 스킵: 시트 링크 없음`);
      return;
    }
    const data = appDataRef.current;
    if (!data) return;
    const row = data.rowsByTab.fullReplay.find((r) => r.id === rowId);
    if (!row) {
      dlog(`[patch] 스킵: row 없음 (rowId=${rowId})`);
      return;
    }
    const date = row.values.broadcastDate || "";
    const time = row.values.broadcastStartTime || "";
    if (!date || !time) {
      dlog(`[patch] 스킵: 매칭 키 부족 (date=${date}, time=${time})`);
      return;
    }
    const headers = data.schemaByTab.fullReplay;
    const year = parseInt(date.slice(0, 4), 10) || new Date().getFullYear();
    const matchPairs: Array<[string, string]> = [
      ["broadcastDate", date],
      ["broadcastStartTime", time]
    ];
    const tlLen = (row.values.categoryTimeline || "").length;
    dlog(`[patch] 시도: rowId=${rowId}, ${date} ${time}, timeline길이=${tlLen}`);
    setSheetsStatus("시트 patch...");
    try {
      const res = await api.sheetsPatchRow(sheetUrl, "fullReplay", year, headers, matchPairs, row.values);
      if (res.ok) {
        dlog(`[patch] ${res.action || "ok"} (rowNum=${res.rowNum ?? "-"})`);
        setSheetsStatus(res.action === "appended" ? "시트 추가됨" : "시트 갱신됨");
      } else {
        dlog(`[patch] 실패: ${res.error}`);
        setSheetsStatus(`시트 patch 실패: ${res.error || "오류"}`);
      }
    } catch (e) {
      dlog(`[patch] 예외: ${(e as Error).message}`);
      setSheetsStatus("시트 patch 실패");
    }
  }, []);

  /** 5초 디바운스로 patch 예약. 같은 row 가 짧은 시간에 여러 번 갱신될 때 마지막만 1번 실행. */
  const schedulePatchActiveRow = useCallback(() => {
    if (patchDebounceTimer.current) clearTimeout(patchDebounceTimer.current);
    patchDebounceTimer.current = setTimeout(() => {
      patchDebounceTimer.current = null;
      flushPatchActiveRow();
    }, 5000);
  }, [flushPatchActiveRow]);

  const appendTimeline = useCallback((uptime: string, category: string) => {
    const rowId = detectRowId.current;
    if (!rowId) return;
    const entry = `${uptime} - ${category}`;
    dlog(`appendTimeline: row=${rowId}, entry="${entry}"`);
    setAppData((prev) => {
      const tab: TabKey = "fullReplay";
      const rows = prev.rowsByTab[tab];
      const row = rows.find((r) => r.id === rowId);
      if (!row) return prev;
      const existing = row.values.categoryTimeline || "";
      const updated = existing ? `${existing}\n${entry}` : entry;
      return {
        ...prev,
        rowsByTab: {
          ...prev.rowsByTab,
          [tab]: rows.map((r) =>
            r.id === rowId ? { ...r, values: { ...r.values, categoryTimeline: updated } } : r
          )
        }
      };
    });
    // 카테고리 추가 후 5초 디바운스로 시트 patch (t12-a)
    schedulePatchActiveRow();
  }, [schedulePatchActiveRow]);


  const saveSettings = () => {
    try {
      const data = {
        sheetLink,
        serviceAccountPath,
        chzzkLink,
        pollingInterval,
        statusOptions,
        showDebugPanel,
        staffList,
        maxUndoSize,
        // 사용자가 헤더 드래그/추가/삭제/이름변경 한 결과를 영구 저장.
        // 다음 앱 실행 시에도 같은 컬럼 구성을 그대로 복원한다.
        schemaByTab: appData.schemaByTab
      };
      localStorage.setItem("inel.settings.v1", JSON.stringify(data));
      setSheetsStatus("설정 저장 완료");
      dlog("설정 저장됨");
    } catch (err: unknown) {
      dlog(`설정 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.categoriesLoadUser().then((res) => {
      if (res.ok && res.categories) {
        setUserCategories(res.categories);
        dlog(`사용자 카테고리 로드: ${res.categories.length}개`);
      }
    }).catch(() => undefined);
  }, []);

  const addUserCategory = useCallback(async (cat: ChzzkCategory) => {
    const api = window.electronAPI;
    if (!api) return false;
    const res = await api.categoriesAddUser(cat.categoryId, cat.categoryValue, cat.categoryType);
    if (res.ok && res.categories) setUserCategories(res.categories);
    if (res.added) dlog(`카테고리 자동 등록: ${cat.categoryValue} (${cat.categoryId})`);
    return res.ok;
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("inel.settings.v1");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.sheetLink) setSheetLink(data.sheetLink);
      if (data.serviceAccountPath) setServiceAccountPath(data.serviceAccountPath);
      if (data.chzzkLink) setChzzkLink(data.chzzkLink);
      if (typeof data.pollingInterval === "number") setPollingInterval(data.pollingInterval);
      if (Array.isArray(data.statusOptions)) setStatusOptions(data.statusOptions);
      if (typeof data.showDebugPanel === "boolean") setShowDebugPanel(data.showDebugPanel);
      if (Array.isArray(data.staffList)) setStaffList(data.staffList);
      if (typeof data.maxUndoSize === "number") {
        setMaxUndoSize(Math.min(50, Math.max(5, data.maxUndoSize)));
      }
      // 저장된 컬럼 schema 복원. 단 코드의 기본 schema 가 새로 추가된 컬럼은
      // 자동으로 끝에 보충해서 마이그레이션 안전성을 유지한다.
      if (data.schemaByTab && typeof data.schemaByTab === "object") {
        const merged: Record<TabKey, ColumnDef[]> = { ...tableSchema };
        (Object.keys(tableSchema) as TabKey[]).forEach((tab) => {
          const stored: ColumnDef[] = Array.isArray(data.schemaByTab[tab]) ? data.schemaByTab[tab] : [];
          if (stored.length === 0) {
            merged[tab] = tableSchema[tab];
            return;
          }
          // 1) stored 의 각 컬럼은 그대로 유지 (사용자 변경 보존)
          // 2) tableSchema 에는 있는데 stored 에 없는 키(코드가 새로 추가한 컬럼)는 끝에 append
          const storedKeys = new Set(stored.map((c) => c.key));
          const missing = tableSchema[tab].filter((c) => !storedKeys.has(c.key));
          merged[tab] = [...stored, ...missing];
        });
        setAppData((prev) => ({ ...prev, schemaByTab: merged }));
      }
    } catch {
      // ignore
    }
  }, []);

  // schemaByTab 변경 자동 저장.
  // 사용자가 헤더 드래그/추가/삭제/이름변경할 때마다 즉시 localStorage 에 저장 →
  // 앱 재시작 후에도 같은 컬럼 구성을 유지. 첫 마운트 시점은 가드해서
  // 빈 상태로 덮어쓰지 않도록 한다.
  const schemaPersistInitRef = useRef(false);
  useEffect(() => {
    if (!schemaPersistInitRef.current) {
      schemaPersistInitRef.current = true;
      return;
    }
    try {
      const raw = localStorage.getItem("inel.settings.v1");
      const base = raw ? JSON.parse(raw) : {};
      const next = { ...base, schemaByTab: appData.schemaByTab };
      localStorage.setItem("inel.settings.v1", JSON.stringify(next));
    } catch {
      // ignore
    }
  }, [appData.schemaByTab]);

  useEffect(() => {
    if (autoSyncDoneRef.current) return;
    if (!sheetLink || !serviceAccountPath) return;
    const api = window.electronAPI;
    if (!api) return;
    autoSyncDoneRef.current = true;
    (async () => {
      dlog("앱 시작 자동 동기화 시작");
      setSheetsStatus("앱 시작 - 인증 중...");
      const auth = await api.sheetsInitAuth(serviceAccountPath);
      if (!auth.ok) {
        dlog(`자동 인증 실패: ${auth.error}`);
        setSheetsStatus(`인증 실패: ${auth.error}`);
        setSyncPhase("error");
        return;
      }
      if (auth.clientEmail) setClientEmail(auth.clientEmail);
      await runImport({ silent: false });
    })();
  }, [sheetLink, serviceAccountPath]);

  const pickServiceAccount = async () => {
    const api = window.electronAPI;
    if (!api) { dlog("electronAPI not available"); return; }
    const result = await api.sheetsPickKeyfile();
    if (result.ok && result.path) {
      setServiceAccountPath(result.path);
      setClientEmail(result.clientEmail || "");
      dlog(`Service Account 설정 완료: ${result.path}`);
      setSheetsStatus("인증 완료");
    } else if (result.error) {
      dlog(`Service Account 에러: ${result.error}`);
      setSheetsStatus(`에러: ${result.error}`);
    }
  };

  const registerJsonByPath = async (filePath: string) => {
    const api = window.electronAPI;
    if (!api) { dlog("electronAPI not available"); return; }
    const result = await api.sheetsInitAuth(filePath);
    if (result.ok) {
      setServiceAccountPath(filePath);
      setClientEmail(result.clientEmail || "");
      setSheetsStatus("인증 완료");
      dlog(`JSON 등록(드래그&드롭): ${filePath}`);
    } else {
      setSheetsStatus(`에러: ${result.error}`);
      dlog(`JSON 등록 실패: ${result.error}`);
    }
  };

  const handleJsonDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingJson(false);

    const items = Array.from(e.dataTransfer.items || []);
    const files = Array.from(e.dataTransfer.files || []);
    dlog(`JSON drop: items=${items.length}, files=${files.length}`);

    const file = files[0];
    if (!file) {
      dlog("드롭에 파일이 없음 (텍스트 등 다른 데이터일 수 있음)");
      setSheetsStatus("파일을 직접 드래그&드롭해주세요.");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".json")) {
      dlog(`드롭한 파일이 JSON이 아님: ${file.name}`);
      setSheetsStatus("JSON 파일만 등록 가능합니다.");
      return;
    }

    const api = window.electronAPI;
    let filePath = "";
    if (api?.getFilePath) {
      try {
        filePath = api.getFilePath(file) || "";
      } catch (err) {
        dlog(`getFilePath 호출 실패: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!filePath) {
      filePath = (file as unknown as { path?: string }).path || "";
    }

    if (!filePath) {
      dlog(`경로를 얻을 수 없음. 파일명='${file.name}', size=${file.size}, electronAPI=${!!api}`);
      setSheetsStatus("파일 경로를 얻을 수 없습니다. [파일 선택] 버튼을 사용해주세요.");
      return;
    }

    dlog(`드롭한 JSON 경로: ${filePath}`);
    await registerJsonByPath(filePath);
  };

  const copyClientEmail = async () => {
    if (!clientEmail) return;
    try {
      await navigator.clipboard.writeText(clientEmail);
      setSheetsStatus("이메일이 클립보드에 복사되었습니다.");
      dlog(`이메일 복사: ${clientEmail}`);
    } catch (err: unknown) {
      dlog(`복사 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const testConnection = async () => {
    const api = window.electronAPI;
    if (!api) { dlog("electronAPI not available"); return; }
    if (!sheetLink) {
      setSheetsStatus("Google Sheets 링크를 입력하세요.");
      return;
    }
    if (!serviceAccountPath) {
      setSheetsStatus("Service Account JSON을 먼저 등록하세요.");
      return;
    }
    setSheetsStatus("연결 테스트 중...");
    const result = await api.sheetsTestConnection(sheetLink);
    if (result.ok) {
      setSheetsStatus(`연결 성공: ${result.title} (시트 ${result.sheets?.length ?? 0}개)`);
      dlog(`연결 테스트 OK: ${result.title} / ${result.sheets?.join(", ")}`);
    } else {
      setSheetsStatus(`연결 실패: ${result.error}`);
      dlog(`연결 테스트 실패: ${result.error}`);
    }
  };

  const openSheetsSetupHelp = async () => {
    const api = window.electronAPI;
    if (!api?.helpOpenSheetsSetup) {
      dlog("도움말 열기 기능 불가 (Electron 환경 아님)");
      return;
    }
    const res = await api.helpOpenSheetsSetup();
    if (res.ok) {
      dlog(`도움말 열림: ${res.url}`);
    } else {
      dlog(`도움말 열기 실패: ${res.error}`);
    }
  };

  const openAppGuideHelp = async () => {
    const api = window.electronAPI;
    if (!api?.helpOpenAppGuide) {
      dlog("앱 사용방법 가이드 열기 불가 (Electron 환경 아님)");
      return;
    }
    const res = await api.helpOpenAppGuide();
    if (res.ok) {
      dlog(`앱 사용방법 가이드 열림: ${res.url}`);
    } else {
      dlog(`앱 사용방법 가이드 열기 실패: ${res.error}`);
    }
  };

  const TAB_LABELS: Record<TabKey, string> = {
    shorts: "숏폼",
    longform: "롱폼",
    fullReplay: "다시보기"
  };

  const runImport = async (opts: { silent?: boolean } = {}) => {
    const api = window.electronAPI;
    if (!api) { dlog("electronAPI not available"); return false; }
    if (!sheetLink) {
      if (!opts.silent) { dlog("Google Sheets 링크를 입력하세요"); setSheetsStatus("시트 링크 없음"); }
      return false;
    }
    if (!serviceAccountPath) {
      if (!opts.silent) { dlog("Service Account JSON을 먼저 설정하세요"); setSheetsStatus("인증 필요"); }
      return false;
    }

    const year = new Date().getFullYear();
    const tabKeys: TabKey[] = ["shorts", "longform", "fullReplay"];
    let totalImported = 0;

    setSyncPhase("downloading");
    setSyncProgress({ current: 0, total: tabKeys.length, label: "준비 중" });

    for (let i = 0; i < tabKeys.length; i++) {
      const tabKey = tabKeys[i];
      const tabLabel = TAB_LABELS[tabKey];
      const headers = appData.schemaByTab[tabKey].map((col) => ({
        key: col.key,
        label: col.label,
        shared: !!col.shared
      }));

      setSyncProgress({ current: i, total: tabKeys.length, label: `${tabLabel}_${year}` });
      setSheetsStatus(`시트 내려받는 중... (${i + 1}/${tabKeys.length} ${tabLabel})`);
      dlog(`가져오기: ${tabKey} (${year})`);

      const result = await api.sheetsImport(sheetLink, tabKey, year, headers);
      if (!result.ok) {
        dlog(`가져오기 실패 (${tabKey}): ${result.error}`);
        setSheetsStatus(`동기화 실패: ${result.error}`);
        setSyncPhase("error");
        return false;
      }

      if (result.sheetNotFound) {
        dlog(`시트 없음: ${tabKey}_${year} → 건너뜀`);
      } else if (result.rows && result.rows.length > 0) {
        setAppData((prev) => ({
          ...prev,
          rowsByTab: {
            ...prev.rowsByTab,
            [tabKey]: result.rows!
          }
        }));
        totalImported += result.rows.length;
        dlog(`가져오기 완료 (${tabKey}): ${result.rows.length}행`);
      }

      setSyncProgress({ current: i + 1, total: tabKeys.length, label: `${tabLabel} 완료` });
    }

    setSheetsStatus(`동기화 완료 (총 ${totalImported}행)`);
    setSyncPhase("success");
    dlog(`전체 가져오기 완료: ${totalImported}행`);
    return true;
  };

  const runExport = async () => {
    const api = window.electronAPI;
    if (!api) { dlog("electronAPI not available"); return false; }
    if (!sheetLink) { dlog("Google Sheets 링크를 입력하세요"); setSheetsStatus("시트 링크 없음"); return false; }
    if (!serviceAccountPath) { dlog("Service Account JSON을 먼저 설정하세요"); setSheetsStatus("인증 필요"); return false; }

    const year = new Date().getFullYear();
    const tabKeys: TabKey[] = ["shorts", "longform", "fullReplay"];
    let totalExported = 0;

    setSyncPhase("uploading");
    setSyncProgress({ current: 0, total: tabKeys.length, label: "준비 중" });

    for (let i = 0; i < tabKeys.length; i++) {
      const tabKey = tabKeys[i];
      const tabLabel = TAB_LABELS[tabKey];
      const headers = appData.schemaByTab[tabKey].map((col) => ({
        key: col.key,
        label: col.label,
        shared: !!col.shared
      }));
      const rows = appData.rowsByTab[tabKey];

      setSyncProgress({ current: i, total: tabKeys.length, label: `${tabLabel}_${year}` });
      setSheetsStatus(`시트 올리는 중... (${i + 1}/${tabKeys.length} ${tabLabel})`);
      dlog(`내보내기: ${tabKey} (${rows.length}행)`);

      const result = await api.sheetsExport(sheetLink, tabKey, year, headers, rows);
      if (!result.ok) {
        dlog(`내보내기 실패 (${tabKey}): ${result.error}`);
        setSheetsStatus(`동기화 실패: ${result.error}`);
        setSyncPhase("error");
        return false;
      }

      totalExported += rows.length;
      dlog(`내보내기 완료: ${result.sheetName} (${result.rowCount}행)`);
      setSyncProgress({ current: i + 1, total: tabKeys.length, label: `${tabLabel} 완료` });
    }

    setSheetsStatus(`동기화 완료 (총 ${totalExported}행)`);
    setSyncPhase("success");
    dlog(`전체 내보내기 완료: ${totalExported}행`);
    return true;
  };

  const handleImport = () => { void runImport(); };
  const handleExport = () => { void runExport(); };

  const toggleDetection = async () => {
    const api = window.electronAPI;
    if (!api) {
      dlog("electronAPI not available (running in browser?)");
      return;
    }

    if (isDetecting) {
      await api.stopChzzkPolling();
      setIsDetecting(false);
      setChzzkLive(false);
      setChzzkCategory("");
      setChzzkTitle("");
      setChzzkUptime("");
      // 대기 중인 patch 가 있으면 즉시 flush 후 ref 리셋
      if (patchDebounceTimer.current) {
        clearTimeout(patchDebounceTimer.current);
        patchDebounceTimer.current = null;
      }
      if (detectRowId.current) {
        await flushPatchActiveRow();
      }
      detectRowId.current = null;
      firstCategoryRecorded.current = false;
      lastSeenOpenDate.current = "";
      dlog("방송감지 OFF");
    } else {
      if (!chzzkLink) {
        dlog("치지직 방송 링크가 설정되지 않았습니다.");
        return;
      }
      const result = await api.startChzzkPolling(chzzkLink, pollingInterval);
      if (result.ok) {
        setIsDetecting(true);
        // 토글 ON 시점에는 ref 만 비워둠. ensureDetectRow 가 핑거프린트(broadcastDate+broadcastStartTime)
        // 로 다시보기 탭에서 진행 중인 세션 행을 찾아 재사용하므로,
        // 인터넷 끊김 / 잠깐 OFF→ON 같은 단절 후에도 같은 행으로 이어서 기록된다.
        detectRowId.current = null;
        firstCategoryRecorded.current = false;
        lastSeenOpenDate.current = "";
        setTimelineLog([]);
        dlog(`방송감지 ON (interval=${pollingInterval}ms, channel=${result.channelId})`);
      } else {
        dlog(`방송감지 실패: ${result.error}`);
      }
    }
  };

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const unsub1 = api.onChzzkStatus((status) => {
      setChzzkLive(status.live);
      if (status.live) {
        setChzzkCategory(status.category || "");
        setChzzkTitle(status.title || "");
        setChzzkUptime(status.uptime || "");

        // openDate 일관성 검증: 같은 세션이 진행 중인데 polling 응답의 openDate 가
        // 변하면(=치지직 측 흔들림) 디버그 로그로 즉시 경고. 매칭은 ensureDetectRow
        // 의 활성 세션 가드 + 분 단위 fallback 으로 보호되지만, 운영 중 패턴 파악을
        // 위해 변화 자체를 기록한다.
        const od = (status as any).openDate || "";
        if (od) {
          if (!lastSeenOpenDate.current) {
            lastSeenOpenDate.current = od;
            dlog(`치지직 openDate 수신: "${od}"`);
          } else if (od !== lastSeenOpenDate.current) {
            dlog(`주의: 같은 세션 내 openDate 변경 감지 "${lastSeenOpenDate.current}" → "${od}" (분 단위 fallback 으로 같은 행 유지)`);
            lastSeenOpenDate.current = od;
          }
        }

        // 한 세션 = 한 행. ensureDetectRow 가 핑거프린트 매칭으로
        // 같은 방송이면 기존 행을 재사용, 새 방송이면 새 행을 만든다.
        // (인터넷 끊김/감지 OFF→ON 후에도 같은 행으로 이어 기록)
        ensureDetectRow(
          status.title || "",
          od,
          status.category || ""
        );

        if (!firstCategoryRecorded.current && status.category) {
          firstCategoryRecorded.current = true;
          appendTimeline(status.uptime || "00:00:00", status.category);
          setTimelineLog((prev) => [...prev, `${status.uptime || "00:00:00"} - ${status.category}`]);
        }
      } else {
        // LIVE OFF: 행 닫기. 다음 LIVE ON 때 새 행이 만들어지도록 ref 들 리셋.
        if (detectRowId.current) {
          dlog(`방송 종료 감지 → 행 마감 (rowId=${detectRowId.current})`);
          // 디바운스 대기 중인 patch 가 있으면 즉시 flush (마지막 상태를 시트에 반영)
          if (patchDebounceTimer.current) {
            clearTimeout(patchDebounceTimer.current);
            patchDebounceTimer.current = null;
          }
          flushPatchActiveRow();
        }
        detectRowId.current = null;
        firstCategoryRecorded.current = false;
        lastSeenOpenDate.current = "";
        setChzzkCategory("");
        setChzzkTitle("");
        setChzzkUptime("");
      }
    });

    const unsub2 = api.onChzzkCategoryChange((change) => {
      const entry = `${change.uptime} - ${change.next}`;
      dlog(`카테고리 변경: ${change.prev} → ${change.next}`);
      setTimelineLog((prev) => [...prev, entry]);
      appendTimeline(change.uptime, change.next);

      // t12-b: 처음 보는 카테고리면 사용자 카테고리 목록에 자동 등록
      const cid = change.nextId || "";
      const cval = change.nextValue || change.next || "";
      if (cid && cval) {
        const exists = allCategoriesRef.current.some((c) => c.categoryId === cid);
        if (!exists) {
          dlog(`[auto-register] 새 카테고리 자동 등록 시도: id=${cid}, value="${cval}", type=${change.nextType || ""}`);
          (async () => {
            try {
              const apiRef = window.electronAPI;
              if (!apiRef) return;
              const res = await apiRef.categoriesAddUser(cid, cval, change.nextType || "");
              if (res.ok && res.added && res.categories) {
                setUserCategories(res.categories);
                dlog(`[auto-register] 등록 완료: ${cid} (총 user ${res.categories.length}개)`);
              } else if (res.ok && !res.added) {
                dlog(`[auto-register] 이미 등록되어 있음: ${cid}`);
              } else {
                dlog(`[auto-register] 실패: ${res.error || "원인 미상"}`);
              }
            } catch (e) {
              dlog(`[auto-register] 예외: ${(e as Error).message}`);
            }
          })();
        }
      }
    });

    const unsub3 = api.onChzzkTitleChange((change) => {
      dlog(`제목 변경: "${change.prev}" → "${change.next}"`);
    });

    const unsub4 = api.onChzzkError((err) => {
      dlog(`치지직 에러: ${err.message}`);
    });

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [ensureDetectRow, appendTimeline, flushPatchActiveRow]);

  useEffect(() => {
    if (!resizingColumnKey) return;

    const handleMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - resizeStartX;
      updateColumnWidth(resizingColumnKey, resizeStartWidth + delta);
    };

    const handleMouseUp = () => {
      setResizingColumnKey(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingColumnKey, resizeStartX, resizeStartWidth]);

  // (이전엔 선택된 달에 데이터가 없으면 데이터의 마지막 달로 강제 이동시켰지만,
  // 사용자가 항상 현재 달로 시작하기를 원하므로 자동 점프 로직 제거.
  // 화살표 좌우로 자유롭게 이동 가능, 빈 달이면 빈 표가 보인다.)

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (isSettingsOpen) {
        const inPanel = settingsPanelRef.current?.contains(target);
        const onButton = settingsButtonRef.current?.contains(target);
        if (!inPanel && !onButton) {
          setIsSettingsOpen(false);
        }
      }

      if (openStatusMenuKey) {
        const inStatusDropdown = (target as HTMLElement)?.closest?.(".status-dropdown");
        const onStatusPill = (target as HTMLElement)?.closest?.(".status-pill");
        if (!inStatusDropdown && !onStatusPill) {
          setOpenStatusMenuKey(null);
        }
      }

      if (typeMenuColumnKey) {
        const inTypeMenu = (target as HTMLElement)?.closest?.(".type-menu");
        const onTypeIcon = (target as HTMLElement)?.closest?.(".type-icon-button");
        if (!inTypeMenu && !onTypeIcon) {
          setTypeMenuColumnKey(null);
        }
      }

      if (openAssigneeMenuKey) {
        const inAssignee = (target as HTMLElement)?.closest?.(".assignee-dropdown");
        const onAssigneePill = (target as HTMLElement)?.closest?.(".assignee-pill");
        if (!inAssignee && !onAssigneePill) {
          setOpenAssigneeMenuKey(null);
        }
      }

      if (openPresetMenuKey) {
        const inPresetDropdown = (target as HTMLElement)?.closest?.(".preset-dropdown");
        const onPresetPill = (target as HTMLElement)?.closest?.(".preset-pill");
        if (!inPresetDropdown && !onPresetPill) {
          setOpenPresetMenuKey(null);
          setPresetCustomInput("");
        }
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isSettingsOpen, openStatusMenuKey, typeMenuColumnKey, openAssigneeMenuKey, openPresetMenuKey]);

  const moveMonth = (direction: "prev" | "next") => {
    if (!selectedMonth) return;
    const delta = direction === "prev" ? -1 : 1;
    const next = shiftMonthKey(selectedMonth, delta);
    // 경계(±12개월) 체크
    if (direction === "prev" && next < monthBounds.earliest) return;
    if (direction === "next" && next > monthBounds.latest) return;
    setSelectedMonthByTab((prev) => ({ ...prev, [activeTab]: next }));
  };

  const renderCellEditor = (row: RowItem, column: ColumnDef, role: EditorRole | null = null) => {
    let value = "";
    if (column.shared || role === null) {
      value = row.values[column.key] || "";
    } else if (role === "thumbnailer") {
      value = row.thumbnailer?.[column.key] || "";
    } else if (role === "editor") {
      value = row.editor?.[column.key] || "";
    }
    const cellRole = column.shared ? null : role;
    const cellKey = `${activeTab}-${row.id}-${column.key}-${cellRole ?? "shared"}`;

    if (column.key === "categoryTimeline") {
      return (
        <div className="timeline-cell">
          {value.split("\n").map((line, i) => (
            <div key={i} className="timeline-entry">{line}</div>
          ))}
        </div>
      );
    }

    if (column.key === "upload") {
      const done = value === "완";
      return (
        <button
          type="button"
          className={`upload-toggle ${done ? "done" : ""}`}
          onClick={() => updateCell(row.id, column.key, done ? "" : "완", cellRole)}
          title={done ? "업로드 완료 (클릭 시 해제)" : "업로드 미완 (클릭 시 완료 표시)"}
        >
          {done ? "완" : ""}
        </button>
      );
    }

    if (column.key === "assignee") {
      const candidates = cellRole
        ? staffList.filter((s) => s.role === cellRole)
        : staffList;
      const placeholder = cellRole === "thumbnailer"
        ? "썸네일러 선택"
        : cellRole === "editor"
        ? "영상편집자 선택"
        : "담당자 선택";
      return (
        <div className="assignee-cell-wrap">
          <button
            type="button"
            className={`assignee-pill ${value ? "has-value" : ""}`}
            onClick={() => setOpenAssigneeMenuKey((prev) => (prev === cellKey ? null : cellKey))}
          >
            {value || placeholder}
          </button>
          {openAssigneeMenuKey === cellKey && (
            <div className="assignee-dropdown">
              {candidates.length === 0 ? (
                <p className="assignee-empty">
                  {cellRole
                    ? `등록된 ${ROLE_LABEL[cellRole]}이(가) 없습니다.`
                    : "설정에서 편집자를 먼저 등록하세요"}
                </p>
              ) : (
                <>
                  {cellRole ? (
                    <div className="assignee-group">
                      <p>{ROLE_LABEL[cellRole]}</p>
                      <div className="assignee-option-list">
                        {candidates.map((staff) => (
                          <button
                            key={staff.id}
                            type="button"
                            className={`assignee-option ${value === staff.name ? "active" : ""}`}
                            onClick={() => {
                              updateCell(row.id, column.key, staff.name, cellRole);
                              setOpenAssigneeMenuKey(null);
                            }}
                          >
                            {staff.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    (["thumbnailer", "editor"] as EditorRole[]).map((role) => {
                      const list = staffList.filter((s) => s.role === role);
                      if (list.length === 0) return null;
                      return (
                        <div key={role} className="assignee-group">
                          <p>{ROLE_LABEL[role]}</p>
                          <div className="assignee-option-list">
                            {list.map((staff) => (
                              <button
                                key={staff.id}
                                type="button"
                                className={`assignee-option ${value === staff.name ? "active" : ""}`}
                                onClick={() => {
                                  updateCell(row.id, column.key, staff.name, cellRole);
                                  setOpenAssigneeMenuKey(null);
                                }}
                              >
                                {staff.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  )}
                  {value && (
                    <button
                      type="button"
                      className="assignee-clear"
                      onClick={() => {
                        updateCell(row.id, column.key, "", cellRole);
                        setOpenAssigneeMenuKey(null);
                      }}
                    >
                      선택 해제
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      );
    }

    if (column.type === "date") {
      return (
        <input
          className="cell-input"
          type="date"
          value={value}
          onChange={(e) => updateCell(row.id, column.key, e.target.value, cellRole)}
        />
      );
    }

    if (column.type === "status") {
      const statusGroups: Array<{ label: string; values: string[] }> = [
        { label: "할 일", values: ["Wait", "Omit"] },
        { label: "진행 중", values: ["Wip", "Retake"] },
        { label: "완료", values: ["Done", "Publish"] }
      ];
      const groupedStatuses = statusGroups
        .map((group) => ({
          label: group.label,
          values: group.values.filter((status) => statusOptions.includes(status))
        }))
        .filter((group) => group.values.length > 0);

      const used = new Set(groupedStatuses.flatMap((group) => group.values));
      const extraStatuses = statusOptions.filter((status) => !used.has(status));
      if (extraStatuses.length > 0) {
        groupedStatuses.push({ label: "기타", values: extraStatuses });
      }

      return (
        <div className="status-cell-wrap">
          <button
            type="button"
            className={`status-pill status-${value || "empty"}`}
            onClick={() => setOpenStatusMenuKey((prev) => (prev === cellKey ? null : cellKey))}
          >
            {value || "선택"}
          </button>
          {openStatusMenuKey === cellKey && (
            <div className="status-dropdown">
              {groupedStatuses.map((group) => (
                <div key={group.label} className="status-group">
                  <p>{group.label}</p>
                  <div className="status-option-list">
                    {group.values.map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={`status-option-pill status-${status}`}
                        onClick={() => {
                          updateCell(row.id, column.key, status, cellRole);
                          setOpenStatusMenuKey(null);
                        }}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (column.type === "preset") {
      const options = column.presetOptions || [];
      const fallback = column.presetDefaults?.[role ?? "default"] || "";
      const display = value || fallback || "선택";
      const isOpen = openPresetMenuKey === cellKey;
      const isDash = display === "-";
      const isUnset = display === "미설정";
      const presetClass = `preset-pill ${isDash ? "preset-dash" : isUnset ? "preset-unset" : "preset-filled"}`;
      return (
        <div className="preset-cell-wrap" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={presetClass}
            title={`${column.label} 변경`}
            onClick={() => {
              setOpenPresetMenuKey((prev) => (prev === cellKey ? null : cellKey));
              setPresetCustomInput("");
            }}
          >
            {display}
          </button>
          {isOpen && (
            <div className="preset-dropdown">
              {options.map((opt) => {
                const isSelected = opt === value;
                const optClass = `preset-option ${
                  opt === "-" ? "preset-option-dash" : opt === "미설정" ? "preset-option-unset" : ""
                } ${isSelected ? "preset-option-selected" : ""}`;
                return (
                  <button
                    key={opt}
                    type="button"
                    className={optClass}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      updateCell(row.id, column.key, opt, cellRole);
                      setOpenPresetMenuKey(null);
                      setPresetCustomInput("");
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
              <div className="preset-divider" />
              <input
                className="preset-custom-input"
                placeholder="직접 입력 (Enter)"
                value={presetCustomInput}
                onChange={(e) => setPresetCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = presetCustomInput.trim();
                    if (v) {
                      updateCell(row.id, column.key, v, cellRole);
                      setOpenPresetMenuKey(null);
                      setPresetCustomInput("");
                    }
                  } else if (e.key === "Escape") {
                    setOpenPresetMenuKey(null);
                    setPresetCustomInput("");
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </div>
      );
    }

    if (column.type === "select") {
      const tags = parseTags(value);
      const thisCellKey = `${row.id}_${column.key}`;
      const isEditingHere = editingTagCell === thisCellKey;
      const isNewTagHere = newTagCell === thisCellKey;
      const isCategoryColumn = column.key === "videoCategory";
      return (
        <div className="tag-editor" onClick={(e) => e.stopPropagation()}>
          <div className="tag-list-inline">
            {tags.map((tag, idx) =>
              isEditingHere && editingTagIndex === idx ? (
                <input
                  key={`edit-${idx}`}
                  className="tag-inline-input"
                  autoFocus
                  defaultValue={tag}
                  onBlur={(e) => commitEditTag(row.id, column.key, idx, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitEditTag(row.id, column.key, idx, (e.target as HTMLInputElement).value);
                    } else if (e.key === "Escape") {
                      setEditingTagCell(null);
                      setEditingTagIndex(-1);
                    }
                  }}
                />
              ) : (
                <span key={`tag-${idx}`} className="tag-chip">
                  <span
                    className="tag-label"
                    onClick={() => startEditTag(row.id, column.key, idx)}
                  >
                    {tag}
                  </span>
                  <button
                    type="button"
                    className="tag-remove"
                    onClick={() => removeCategoryTag(row.id, column.key, idx)}
                  >
                    ×
                  </button>
                </span>
              )
            )}
            {isNewTagHere ? (
              isCategoryColumn ? (
                <div className="category-search-wrap">
                  <div className="category-input-wrap">
                    <input
                      className="tag-inline-input category-search-input"
                      autoFocus
                      placeholder="카테고리 검색 (직접 입력 후 Enter도 가능)"
                      value={categorySearchQuery}
                      onChange={(e) => setCategorySearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const q = categorySearchQuery.trim();
                          if (q) {
                            commitNewTag(row.id, column.key, q);
                            setCategorySearchQuery("");
                          }
                        } else if (e.key === "Escape") {
                          setNewTagCell(null);
                          setCategorySearchQuery("");
                        }
                      }}
                    />
                    {onlineSearching && (
                      <span className="category-input-spinner" aria-label="검색 중" title="치지직 검색 중" />
                    )}
                  </div>
                  {categorySearchQuery.trim() && (
                    <div className="category-search-dropdown">
                      {filteredCategories.length > 0 && (
                        <>
                          <p className="category-section-label">로컬 (시드 + 등록)</p>
                          {filteredCategories.map((cat) => (
                            <button
                              key={cat.categoryId}
                              type="button"
                              className={`category-option category-${cat.categoryType.toLowerCase()}`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                commitNewTag(row.id, column.key, cat.categoryValue);
                                setCategorySearchQuery("");
                              }}
                            >
                              <span className="category-tag-type">{cat.categoryType}</span>
                              <span className="category-tag-name">{cat.categoryValue}</span>
                            </button>
                          ))}
                        </>
                      )}
                      {filteredCategories.length === 0 && onlineSearching && (
                        <div className="category-loading" role="status" aria-live="polite">
                          <span className="category-loading-spinner" />
                          <div className="category-loading-text">
                            <strong>치지직에서 검색 중…</strong>
                            <span>활동 중인 라이브가 있는 카테고리만 찾을 수 있어요.</span>
                          </div>
                        </div>
                      )}
                      {onlineCategoryResults.length > 0 && (
                        <>
                          <p className="category-section-label">
                            치지직 라이브에서 발견 (선택 시 자동 등록)
                            {onlineSearching && <span className="category-section-spinner" />}
                          </p>
                          {onlineCategoryResults.map((cat) => (
                            <button
                              key={`online-${cat.categoryId}`}
                              type="button"
                              className={`category-option category-online category-${cat.categoryType.toLowerCase()}`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={async () => {
                                await addUserCategory(cat);
                                commitNewTag(row.id, column.key, cat.categoryValue);
                                setCategorySearchQuery("");
                                setOnlineCategoryResults([]);
                              }}
                            >
                              <span className="category-tag-type">{cat.categoryType}</span>
                              <span className="category-tag-name">{cat.categoryValue}</span>
                              <span className="category-online-badge">+ 등록</span>
                            </button>
                          ))}
                        </>
                      )}
                      {filteredCategories.length === 0 && !onlineSearching && onlineCategoryResults.length === 0 && (
                        <p className="category-empty">검색 결과 없음 (Enter로 직접 추가)</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <input
                  className="tag-inline-input"
                  autoFocus
                  placeholder="카테고리"
                  onBlur={(e) => commitNewTag(row.id, column.key, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitNewTag(row.id, column.key, (e.target as HTMLInputElement).value);
                    } else if (e.key === "Escape") {
                      setNewTagCell(null);
                    }
                  }}
                />
              )
            ) : (
              <button
                type="button"
                className="tag-add-btn"
                onClick={() => {
                  startNewTag(row.id, column.key);
                  setCategorySearchQuery("");
                }}
              >
                +
              </button>
            )}
          </div>
        </div>
      );
    }

    if (column.type === "url") {
      const isViewMode = urlViewMode[cellKey] ?? false;
      if (isViewMode && value) {
        return (
          <div className="url-view">
            <a href={value} target="_blank" rel="noreferrer">
              {column.label || "링크"}
            </a>
            <button
              type="button"
              className="icon-button"
              title="URL 수정"
              onClick={() => toggleUrlViewMode(cellKey, false)}
            >
              수정
            </button>
          </div>
        );
      }

      return (
        <div className="url-edit">
          <input
            className="cell-input"
            value={value}
            onChange={(e) => updateCell(row.id, column.key, e.target.value, cellRole)}
            placeholder="https://..."
          />
          <button
            type="button"
            className="icon-button"
            title="링크로 보기"
            onClick={() => toggleUrlViewMode(cellKey, true)}
          >
            링크
          </button>
        </div>
      );
    }

    return (
      <input
        className="cell-input"
        value={value}
        onChange={(e) => updateCell(row.id, column.key, e.target.value, cellRole)}
        placeholder={column.type}
      />
    );
  };

  return (
    <div className={`app-shell ${showDebugPanel ? "with-debug" : "no-debug"}`}>
      <header className="topbar">
        <div className="brand-area">
          <img className="brand-logo" src={logoImage} alt="logo" />
          <div className="title-wrap" aria-label="title-slot" />
        </div>
        <div className="actions">
          <div className="action-group action-group-data" data-label="데이터">
            <div className="detect-toggle-wrap">
              <button
                type="button"
                className={`detect-toggle ${isDetecting ? "on" : "off"}`}
                onClick={toggleDetection}
              >
                {isDetecting ? "방송감지 On" : "방송감지 Off"}
              </button>
              <span className={`live-badge ${chzzkLive && isDetecting ? "active" : ""}`}>LIVE</span>
              {chzzkLive && isDetecting && chzzkCategory && (
                <span className="live-category">{chzzkCategory}</span>
              )}
            </div>
            <button type="button" onClick={handleImport}>구글시트 다운로드</button>
            <button type="button" onClick={handleExport}>구글시트 업로드</button>
            <button
              type="button"
              onClick={() => { resetCsvModal(); setCsvTargetTab(activeTab === "fullReplay" ? "shorts" : activeTab); setCsvModalOpen(true); }}
              title="외부 협업 툴(Monday 등)에서 내려받은 CSV를 AI로 우리 시트 형식으로 변환해 추가"
            >
              CSV 가져오기 (AI)
            </button>
            <button
              type="button"
              onClick={undoLast}
              disabled={undoStack.length === 0}
              title="되살리기 (Ctrl+Z)"
            >
              되살리기
            </button>
            <button
              type="button"
              onClick={redoLast}
              disabled={redoStack.length === 0}
              title="다시실행 (Ctrl+Shift+Z / Ctrl+Y)"
            >
              다시실행
            </button>
          </div>
          <div className="action-group action-group-system" data-label="시스템">
            <button
              type="button"
              className={`debug-toggle ${showDebugPanel ? "on" : "off"}`}
              onClick={() => setShowDebugPanel((prev) => !prev)}
              title={showDebugPanel ? "디버그 패널 숨기기" : "디버그 패널 보이기"}
              aria-label="디버그 패널 토글"
            >
              {showDebugPanel ? "디버그 ▶" : "◀ 디버그"}
            </button>
            <button
              ref={settingsButtonRef}
              type="button"
              className="settings-button"
              onClick={() => setIsSettingsOpen((prev) => !prev)}
              aria-label="설정 열기"
            >
              <img src={settingsIcon} alt="설정" />
            </button>
          </div>
        </div>
      </header>

      <nav className="tabbar">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "tab active" : "tab"}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="meta">
        <span className={`sync-indicator sync-${syncPhase}`}>
          {syncPhase === "idle" && "동기화 대기 중"}
          {syncPhase === "downloading" && `시트 내려받는 중... ${syncProgress.label}`}
          {syncPhase === "uploading" && `시트 올리는 중... ${syncProgress.label}`}
          {syncPhase === "success" && (sheetsStatus || "동기화 완료")}
          {syncPhase === "error" && (sheetsStatus || "동기화 실패")}
        </span>
        {(syncPhase === "downloading" || syncPhase === "uploading") && syncProgress.total > 0 && (
          <span className="sync-progress-bar">
            <span
              className="sync-progress-fill"
              style={{ width: `${Math.round((syncProgress.current / syncProgress.total) * 100)}%` }}
            />
            <span className="sync-progress-text">
              {syncProgress.current}/{syncProgress.total} ({Math.round((syncProgress.current / syncProgress.total) * 100)}%)
            </span>
          </span>
        )}
      </section>

      <section className="month-nav">
        <button type="button" onClick={() => moveMonth("prev")} disabled={!hasPrevMonth}>
          {"<"}
        </button>
        <strong>
          {selectedMonth ? `${selectedMonth.slice(0, 4)}. ${selectedMonth.slice(5, 7)}` : "월 없음"}
        </strong>
        <button type="button" onClick={() => moveMonth("next")} disabled={!hasNextMonth}>
          {">"}
        </button>
        {(activeTab === "shorts" || activeTab === "longform") && (
          <div className="task-filter-toggle" role="tablist" aria-label="작업 필터">
            <button
              type="button"
              role="tab"
              aria-selected={(taskFilter[activeTab] ?? "todoOnly") === "todoOnly"}
              className={`task-filter-btn ${(taskFilter[activeTab] ?? "todoOnly") === "todoOnly" ? "active" : ""}`}
              onClick={() => setTaskFilterFor(activeTab, "todoOnly")}
            >
              할일만 보기
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={(taskFilter[activeTab] ?? "todoOnly") === "all"}
              className={`task-filter-btn ${(taskFilter[activeTab] ?? "todoOnly") === "all" ? "active" : ""}`}
              onClick={() => setTaskFilterFor(activeTab, "all")}
            >
              모두 보기
            </button>
          </div>
        )}
      </section>

      <main className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="row-action-col" aria-label="행 작업" />
              {columns.map((column) => {
                const isDropTarget = dropTargetColumnKey === column.key && dragColumnKey && dragColumnKey !== column.key;
                const isDragSource = dragColumnKey === column.key;
                return (
                <th
                  key={column.key}
                  className={`header-cell ${isDropTarget ? "drop-target-col" : ""} ${isDragSource ? "drag-source-col" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragColumnKey && dragColumnKey !== column.key) {
                      swapColumn(column.key);
                    }
                  }}
                  onDrop={(e) => { e.preventDefault(); endDrag(); }}
                  style={{ width: column.width ?? 180, minWidth: column.width ?? 180 }}
                >
                  <button
                    type="button"
                    className="col-drag-handle"
                    draggable
                    onDragStart={() => {
                      setDragColumnKey(column.key);
                      dragHistoryPushedRef.current = false;
                    }}
                    onDragEnd={endDrag}
                    title="열 순서 이동"
                    aria-label="열 순서 이동"
                  >
                    ⋮⋮
                  </button>
                  <button type="button" className="column-delete" onClick={() => deleteColumn(column.key)}>
                    -
                  </button>
                  <div className="header-inline">
                    <button
                      type="button"
                      className="type-icon-button"
                      onClick={() => setTypeMenuColumnKey((prev) => (prev === column.key ? null : column.key))}
                      title={`${column.label} 열 타입 변경`}
                      aria-label={`${column.label} 열 타입 변경`}
                    >
                      {getTypeIcon(column.type)}
                    </button>
                    <input
                      className="header-label-inline"
                      value={column.label}
                      onChange={(e) => updateColumnMeta(column.key, "label", e.target.value)}
                      aria-label={`${column.label} 헤더 이름`}
                    />
                    {typeMenuColumnKey === column.key && (
                      <div className="type-menu">
                        {columnTypeOptions.map((type) => (
                          <button
                            key={type}
                            type="button"
                            className={column.type === type ? "type-menu-item active" : "type-menu-item"}
                            onClick={() => {
                              updateColumnMeta(column.key, "type", type);
                              setTypeMenuColumnKey(null);
                            }}
                          >
                            <span>{getTypeIcon(type)}</span>
                            <span>{type}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div
                    className="column-resizer"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      startResize(column.key, column.width ?? 180, event.clientX);
                    }}
                  />
                </th>
                );
              })}
              <th className="spacer-col" aria-hidden="true" />
            </tr>
          </thead>
          {(() => {
            const renderTaskRow = (row: RowItem) => {
              const isDropRow = dropTargetRowId === row.id && dragRowId && dragRowId !== row.id;
              const isDragRow = dragRowId === row.id;
              const isSelected = selectedRowByTab[activeTab] === row.id;
              const hasTwoRows = activeTab !== "fullReplay" && row.thumbnailer !== undefined && row.editor !== undefined;
              const subRoles: Array<EditorRole | null> = hasTwoRows ? ["thumbnailer", "editor"] : [null];
              const isRowLocked = (row.values.upload || "") === "완";

              const rowDragOver = (e: React.DragEvent) => {
                e.preventDefault();
                if (dragRowId && dragRowId !== row.id) {
                  swapRow(row.id);
                }
              };
              const rowDrop = (e: React.DragEvent) => {
                e.preventDefault();
                endDrag();
              };
              const rowClick = () =>
                setSelectedRowByTab((prev) => ({ ...prev, [activeTab]: row.id }));

              return subRoles.map((role, subIdx) => {
                const isFirstSub = subIdx === 0;
                const rowClasses = [
                  isSelected ? "selected-row" : "",
                  isDropRow ? "drop-target-row" : "",
                  isDragRow ? "drag-source-row" : "",
                  hasTwoRows ? (isFirstSub ? "task-row task-row-first" : "task-row task-row-second") : "",
                  isRowLocked ? "row-locked" : ""
                ].filter(Boolean).join(" ") || undefined;

                return (
                  <tr
                    key={`${activeTab}-${row.id}-${role ?? "single"}`}
                    className={rowClasses}
                    onDragOver={rowDragOver}
                    onDrop={rowDrop}
                    onClick={rowClick}
                  >
                    {isFirstSub ? (
                      <td className="row-action-col" rowSpan={hasTwoRows ? 2 : 1}>
                        <div className="row-hover-actions">
                          <button
                            type="button"
                            className="row-drag-handle"
                            draggable
                            onDragStart={(e) => {
                              e.stopPropagation();
                              setDragRowId(row.id);
                              dragHistoryPushedRef.current = false;
                            }}
                            onDragEnd={endDrag}
                            title="행 순서 이동"
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M4 7H20" />
                              <path d="M4 12H20" />
                              <path d="M4 17H20" />
                            </svg>
                          </button>
                          <button type="button" className="row-delete" onClick={(e) => { e.stopPropagation(); deleteRow(row.id); }}>
                            -
                          </button>
                        </div>
                      </td>
                    ) : null}
                    {columns.map((column) => {
                      const isShared = !!column.shared;
                      if (hasTwoRows && isShared && !isFirstSub) {
                        return null;
                      }
                      const tdProps: React.TdHTMLAttributes<HTMLTableCellElement> = {};
                      if (hasTwoRows && isShared && isFirstSub) {
                        tdProps.rowSpan = 2;
                      }
                      const isUploadCol = column.key === "upload";
                      const cellClassName = [
                        isShared ? "shared-cell" : "role-cell",
                        role ? `role-${role}` : "",
                        isRowLocked && !isUploadCol ? "is-locked" : ""
                      ].filter(Boolean).join(" ") || undefined;
                      return (
                        <td key={column.key} className={cellClassName} {...tdProps}>
                          {renderCellEditor(row, column, role)}
                        </td>
                      );
                    })}
                    {isFirstSub ? (
                      <td className="spacer-col" rowSpan={hasTwoRows ? 2 : 1} aria-hidden="true" />
                    ) : null}
                  </tr>
                );
              });
            };

            const isGroupTab = activeTab === "shorts" || activeTab === "longform";
            if (!isGroupTab) {
              return <tbody>{filteredData.map(renderTaskRow)}</tbody>;
            }

            const todoRows = filteredData.filter((r) => (r.values.upload || "") !== "완");
            const doneRows = filteredData.filter((r) => (r.values.upload || "") === "완");
            const totalCols = columns.length + 2;
            const todoCollapsed = groupCollapsed[activeTab]?.todo ?? false;
            const doneCollapsed = groupCollapsed[activeTab]?.done ?? false;
            const filterMode = taskFilter[activeTab] ?? "todoOnly";
            const showDoneGroup = filterMode === "all";
            const todoVisible = groupVisibleCount[activeTab]?.todo ?? GROUP_VISIBLE_DEFAULT;
            const doneVisible = groupVisibleCount[activeTab]?.done ?? GROUP_VISIBLE_DEFAULT;
            const visibleTodoRows = todoRows.slice(0, todoVisible);
            const visibleDoneRows = doneRows.slice(0, doneVisible);
            const todoOverflow = todoRows.length - visibleTodoRows.length;
            const doneOverflow = doneRows.length - visibleDoneRows.length;

            const renderGroupHeader = (
              variant: GroupKey,
              label: string,
              count: number,
              collapsed: boolean,
              visible: number,
              overflow: number
            ) => (
              <tr
                className={`group-header group-header-${variant} ${collapsed ? "is-collapsed" : ""}`}
                title={collapsed ? `${label} 펼치기` : `${label} 접기`}
              >
                <td colSpan={totalCols}>
                  <div className="group-header-inner">
                    <button
                      type="button"
                      className="group-header-toggle"
                      onClick={() => toggleGroupCollapsed(activeTab, variant)}
                    >
                      <span className={`group-caret ${collapsed ? "is-collapsed" : ""}`} aria-hidden="true">▾</span>
                      <span className="group-dot" />
                      <span className="group-label">{label}</span>
                      <span className="group-count">{count}</span>
                    </button>
                    {!collapsed && count > 0 && (
                      <div className="group-visible-control" onClick={(e) => e.stopPropagation()}>
                        <span className="group-visible-label">
                          표시 {Math.min(visible, count)} / {count}
                          {overflow > 0 && <span className="group-visible-hidden"> · {overflow}개 더</span>}
                        </span>
                        <button
                          type="button"
                          className="group-visible-btn"
                          onClick={() => adjustGroupVisible(activeTab, variant, -5)}
                          disabled={visible <= GROUP_VISIBLE_MIN}
                          title="표시 행 5개 줄이기"
                        >
                          −
                        </button>
                        <button
                          type="button"
                          className="group-visible-btn"
                          onClick={() => adjustGroupVisible(activeTab, variant, +5)}
                          disabled={visible >= GROUP_VISIBLE_MAX}
                          title="표시 행 5개 늘리기 (최대 30)"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
            const emptyRow = (text: string) => (
              <tr className="group-empty-row">
                <td colSpan={totalCols} className="group-empty-cell">{text}</td>
              </tr>
            );
            const overflowRow = (visible: number, total: number) => (
              <tr className="group-overflow-row">
                <td colSpan={totalCols} className="group-overflow-cell">
                  {`현재 ${visible}개 표시 중 · ${total - visible}개 숨김 (헤더의 + 버튼으로 더 보기, 최대 ${GROUP_VISIBLE_MAX})`}
                </td>
              </tr>
            );

            return (
              <>
                <tbody className="group-section group-section-todo">
                  {renderGroupHeader("todo", "할 일", todoRows.length, todoCollapsed, todoVisible, todoOverflow)}
                  {!todoCollapsed && (
                    todoRows.length === 0
                      ? emptyRow("할 일이 없습니다.")
                      : (
                        <>
                          {visibleTodoRows.map(renderTaskRow)}
                          {todoOverflow > 0 && overflowRow(visibleTodoRows.length, todoRows.length)}
                        </>
                      )
                  )}
                </tbody>
                {showDoneGroup && (
                  <>
                    <tbody className="group-spacer-tbody" aria-hidden="true">
                      <tr className="group-spacer-row">
                        <td colSpan={totalCols} />
                      </tr>
                    </tbody>
                    <tbody className="group-section group-section-done">
                      {renderGroupHeader("done", "완료됨", doneRows.length, doneCollapsed, doneVisible, doneOverflow)}
                      {!doneCollapsed && (
                        doneRows.length === 0
                          ? emptyRow("완료된 항목이 없습니다.")
                          : (
                            <>
                              {visibleDoneRows.map(renderTaskRow)}
                              {doneOverflow > 0 && overflowRow(visibleDoneRows.length, doneRows.length)}
                            </>
                          )
                      )}
                    </tbody>
                  </>
                )}
              </>
            );
          })()}
          <tfoot>
            <tr>
              <td colSpan={columns.length + 2} className="add-row-footer-cell">
                <button type="button" className="add-row-footer" onClick={addRow}>
                  + 새 행 추가
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </main>

      {isSettingsOpen && (
        <section className="settings-panel" ref={settingsPanelRef}>
          <div className="settings-header">
            <h2>설정</h2>
            <button
              type="button"
              className="settings-close-btn"
              onClick={() => setIsSettingsOpen(false)}
              aria-label="설정 닫기"
            >
              ×
            </button>
          </div>
          <nav className="settings-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={settingsTab === "sheet"}
              className={`settings-tab ${settingsTab === "sheet" ? "active" : ""}`}
              onClick={() => setSettingsTab("sheet")}
            >
              시트 설정
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={settingsTab === "connection"}
              className={`settings-tab ${settingsTab === "connection" ? "active" : ""}`}
              onClick={() => setSettingsTab("connection")}
            >
              구글 시트 연결
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={settingsTab === "ai"}
              className={`settings-tab ${settingsTab === "ai" ? "active" : ""}`}
              onClick={() => setSettingsTab("ai")}
            >
              AI 연결
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={settingsTab === "etc"}
              className={`settings-tab ${settingsTab === "etc" ? "active" : ""}`}
              onClick={() => setSettingsTab("etc")}
            >
              기타 설정
            </button>
          </nav>

          <div className="settings-tabpanel">
            {settingsTab === "sheet" && (
              <>
                <div className="connection-help-banner">
                  <div className="connection-help-text">
                    <strong>스케줄러 앱 사용 방법</strong>
                    <p>시트 컬럼 기능, 행/열 다루기, 그리고 시트설정과 시트의 연계 (예: 영상편집자는 아래 [편집자/썸네일러 등록]에 추가해야 시트의 담당자 셀에서 선택할 수 있어요) 등을 자세히 안내합니다.</p>
                  </div>
                  <button type="button" className="connection-help-btn" onClick={openAppGuideHelp}>
                    사용 방법 자세히 보기 ↗
                  </button>
                </div>
                <label>
                  치지직 방송 링크
                  <input
                    type="text"
                    value={chzzkLink}
                    onChange={(e) => setChzzkLink(e.target.value)}
                    placeholder="https://chzzk.naver.com/..."
                  />
                </label>
                <div className="status-config">
                  <p>작업상태 옵션 (status 타입)</p>
                  <div className="status-add-row">
                    <input
                      type="text"
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value)}
                      placeholder="상태 추가"
                    />
                    <button type="button" onClick={addStatusOption}>
                      추가
                    </button>
                  </div>
                  <div className="status-list">
                    {statusOptions.map((status) => (
                      <span key={status} className="status-chip">
                        {status}
                        <button type="button" onClick={() => removeStatusOption(status)}>
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="staff-config">
                  <p>편집자 / 썸네일러 등록</p>
                  <div className="staff-add-row">
                    <select
                      className="staff-role-select"
                      value={newStaffRole}
                      onChange={(e) => setNewStaffRole(e.target.value as EditorRole)}
                    >
                      <option value="thumbnailer">썸네일러</option>
                      <option value="editor">영상편집자</option>
                    </select>
                    <input
                      className="staff-name-input"
                      type="text"
                      value={newStaffName}
                      onChange={(e) => setNewStaffName(e.target.value)}
                      placeholder="이름"
                      onKeyDown={(e) => { if (e.key === "Enter") addStaff(); }}
                    />
                    <button type="button" className="staff-add-btn" onClick={addStaff} title="추가">
                      추가
                    </button>
                  </div>
                  <div className="staff-list">
                    {staffList.length === 0
                      ? <p className="staff-empty">등록된 인원이 없습니다.</p>
                      : staffList.map((staff) => (
                          <span key={staff.id} className={`staff-chip role-${staff.role}`}>
                            <span className="staff-role-tag">{ROLE_LABEL[staff.role]}</span>
                            <span className="staff-name">{staff.name}</span>
                            <button type="button" onClick={() => removeStaff(staff.id)}>x</button>
                          </span>
                        ))
                    }
                  </div>
                  <p className="staff-hint">
                    ※ 시트의 <strong>담당자</strong> 셀 클릭 시 등록된 인원 중에서 선택할 수 있습니다.
                  </p>
                </div>

                <div className="detect-category-test">
                  <p>방송 감지 설정</p>
                  <label className="polling-label">
                    감지 주기 (ms)
                    <select
                      value={pollingInterval}
                      onChange={(e) => setPollingInterval(Number(e.target.value))}
                      disabled={isDetecting}
                    >
                      <option value={500}>0.5초</option>
                      <option value={1000}>1초</option>
                      <option value={2000}>2초</option>
                      <option value={3000}>3초 (기본)</option>
                      <option value={5000}>5초</option>
                      <option value={10000}>10초</option>
                      <option value={30000}>30초</option>
                    </select>
                  </label>
                  {chzzkLive && isDetecting && (
                    <div className="live-info-box">
                      <p><strong>방송 상태:</strong> <span className="live-badge active">LIVE</span></p>
                      <p><strong>제목:</strong> {chzzkTitle}</p>
                      <p><strong>카테고리:</strong> {chzzkCategory}</p>
                      <p><strong>감지 경과:</strong> {chzzkUptime}</p>
                    </div>
                  )}
                  <div className="timeline-log-box">
                    <p>카테고리 타임라인</p>
                    <ul>
                      {timelineLog.length === 0
                        ? <li>기록 없음</li>
                        : timelineLog.map((entry, i) => <li key={i}>{entry}</li>)
                      }
                    </ul>
                  </div>
                  <p style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>
                    ※ 감지 중 카테고리가 변경되면 다시보기 마지막 행에 자동 추가됩니다.
                  </p>
                </div>

                <div className="undo-config">
                  <p>되살리기 / 다시실행 설정</p>
                  <label className="undo-size-row">
                    <span>스택 크기 ({maxUndoSize}단계)</span>
                    <input
                      type="range"
                      min={5}
                      max={50}
                      step={1}
                      value={maxUndoSize}
                      onChange={(e) => setMaxUndoSize(Number(e.target.value))}
                    />
                  </label>
                  <p className="undo-hint">
                    Ctrl+Z 되살리기 / Ctrl+Shift+Z (또는 Ctrl+Y) 다시실행. 같은 셀의 연속 입력은 한 단계로 묶입니다.
                  </p>
                </div>
                <div className="history-box">
                  <p>변경 히스토리</p>
                  <ul>
                    {historyLogs.length === 0 ? <li>기록 없음</li> : historyLogs.map((log) => <li key={log}>{log}</li>)}
                  </ul>
                </div>
              </>
            )}

            {settingsTab === "connection" && (
              <>
                <div className="connection-help-banner">
                  <div className="connection-help-text">
                    <strong>설정 방법은 별도 가이드 페이지에서 확인하세요.</strong>
                    <span>스크린샷 GIF가 큰 화면에서 잘 재생됩니다.</span>
                  </div>
                  <button
                    type="button"
                    className="connection-help-btn"
                    onClick={openSheetsSetupHelp}
                  >
                    설정 방법 자세히 보기 ↗
                  </button>
                </div>

                <label>
                  Google Sheets 링크
                  <input
                    type="text"
                    value={sheetLink}
                    onChange={(e) => setSheetLink(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/..."
                  />
                </label>

                <div className="service-account-row">
                  <label>
                    Service Account JSON
                    <div className="sa-file-row">
                      <input
                        type="text"
                        value={serviceAccountPath}
                        readOnly
                        placeholder="파일을 선택하세요"
                      />
                      <button type="button" onClick={pickServiceAccount}>파일 선택</button>
                    </div>
                  </label>
                  <div
                    className={`sa-dropzone ${isDraggingJson ? "dragging" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingJson(true); }}
                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingJson(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingJson(false); }}
                    onDrop={handleJsonDrop}
                  >
                    <p className="sa-dropzone-text">
                      {isDraggingJson ? "여기에 놓으세요" : "JSON 파일을 여기에 드래그&드롭"}
                    </p>
                  </div>
                  {clientEmail && (
                    <div className="sa-email-row">
                      <span className="sa-email-label">서비스 계정 이메일</span>
                      <code className="sa-email-value" title={clientEmail}>{clientEmail}</code>
                      <button type="button" className="sa-email-copy" onClick={copyClientEmail}>이메일 복사</button>
                    </div>
                  )}
                  <div className="sa-action-row">
                    <button type="button" className="sa-test-btn" onClick={testConnection}>
                      연결 테스트
                    </button>
                  </div>
                  {sheetsStatus && <p className="sheets-status">{sheetsStatus}</p>}
                  <p className="sa-hint">
                    시트 이름 규칙: 숏폼_{new Date().getFullYear()} / 롱폼_{new Date().getFullYear()} / 다시보기_{new Date().getFullYear()}
                  </p>
                </div>
              </>
            )}
            {settingsTab === "ai" && (
              <>
                <div className="connection-help-banner">
                  <div className="connection-help-text">
                    <strong>AI 보조 CSV 변환</strong>
                    <p>외부 협업 툴(Monday 등)의 CSV를 우리 시트 형식으로 자동 매핑합니다. provider/모델/API 키는 본인 것을 등록하세요 (BYOK). API 발급 방법은 가이드를 참고.</p>
                  </div>
                  <button type="button" className="connection-help-btn" onClick={openAiSetupHelp}>
                    AI 가이드 보기 ↗
                  </button>
                </div>

                <label className="ai-provider-label">
                  AI
                  <select
                    value={aiProvider}
                    onChange={(e) => {
                      const v = e.target.value as AiProvider;
                      setAiProvider(v);
                      setAiAvailableModels([]);
                      setAiModel("");
                      persistAiState(v, aiApiKey, "", []);
                    }}
                  >
                    <option value="google">Google (Gemini)</option>
                    <option value="openai">OpenAI (GPT)</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                  </select>
                </label>

                <label>
                  API Key
                  <div className="ai-key-row">
                    <input
                      type={aiKeyVisible ? "text" : "password"}
                      value={aiApiKey}
                      onChange={(e) => { setAiApiKey(e.target.value); persistAiState(aiProvider, e.target.value, aiModel); }}
                      placeholder={aiProvider === "openai" ? "sk-..." : aiProvider === "anthropic" ? "sk-ant-..." : "AIza..."}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="button" className="ai-key-toggle" onClick={() => setAiKeyVisible((v) => !v)} title={aiKeyVisible ? "숨기기" : "보기"}>
                      {aiKeyVisible ? "숨김" : "보기"}
                    </button>
                  </div>
                </label>

                <div className="ai-model-row">
                  <label style={{ flex: 1 }}>
                    AI 모델 (최신 5개)
                    <select
                      value={aiModel}
                      onChange={(e) => { setAiModel(e.target.value); persistAiState(aiProvider, aiApiKey, e.target.value); }}
                      disabled={aiAvailableModels.length === 0}
                    >
                      {aiAvailableModels.length === 0 ? (
                        <option value="">[모델 갱신] 버튼을 눌러주세요</option>
                      ) : (
                        aiAvailableModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.label}{m.id !== m.label ? ` (${m.id})` : ""}</option>
                        ))
                      )}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="ai-model-refresh"
                    onClick={refreshAiModels}
                    disabled={aiModelLoading || !aiApiKey}
                    title="provider의 최신 모델 5개를 가져옵니다"
                  >
                    {aiModelLoading ? "갱신 중…" : "모델 갱신"}
                  </button>
                </div>
                {aiModelError && <p className="ai-error">{aiModelError}</p>}

                <p className="sa-hint">
                  키는 로컬에만 저장됩니다 (외부 서버 경유 X). AI 호출 시 헤더+샘플 5~10행만 전송됩니다.
                </p>
              </>
            )}
            {settingsTab === "etc" && (
              <>
                <div className="etc-card">
                  <div className="etc-card-head">
                    <strong>윈도우 시작 시 자동 실행</strong>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={autoStartEnabled}
                        disabled={autoStartLoading}
                        onChange={(e) => toggleAutoStart(e.target.checked)}
                      />
                      <span className="slider" />
                    </label>
                  </div>
                  <p className="etc-card-desc">
                    켜면 PC 부팅 시 Inel Work Scheduler 가 자동으로 실행됩니다.
                    설치 빌드(.exe)에서만 정상 동작하며, 개발(<code>npm run dev</code>) 환경에서는 효과가 없습니다.
                  </p>
                  {autoStartMessage && <p className="etc-card-msg">{autoStartMessage}</p>}
                </div>

                <div className="etc-card">
                  <div className="etc-card-head">
                    <strong>설정 데이터 폴더</strong>
                    <button
                      type="button"
                      className="etc-installer-btn"
                      style={{ background: "#ec4899", color: "#fff", borderColor: "#ec4899", cursor: "pointer" }}
                      onClick={async () => {
                        const api = (window as any).electronAPI;
                        if (!api?.openUserDataDir) {
                          dlog("[etc] openUserDataDir 사용 불가 (Electron 환경 아님)");
                          return;
                        }
                        const res = await api.openUserDataDir();
                        if (res?.ok) dlog(`[etc] 데이터 폴더 열림: ${res.path}`);
                        else dlog(`[etc] 데이터 폴더 열기 실패: ${res?.error}`);
                      }}
                    >
                      폴더 열기
                    </button>
                  </div>
                  <p className="etc-card-desc">
                    AI API 키, 시트 링크, 그룹 표시 상태 등 앱 설정과 사용자 카테고리는
                    Windows 표준 위치인 <code>%APPDATA%\Inel Work Scheduler\</code> 에 저장됩니다.
                    설치 폴더(내문서)와는 다른 위치이므로, 백업하거나 다른 PC 로 옮길 때
                    이 폴더를 함께 복사하세요.
                  </p>
                </div>

                <div className="etc-card">
                  <div className="etc-card-head">
                    <strong>편집자/썸네일러 전용 설치 파일 만들기</strong>
                    <span className="etc-badge">2차 배포 예정</span>
                  </div>
                  <p className="etc-card-desc">
                    각 담당자 이름으로 토큰을 발급해 시트의 <code>_tokens</code> 시트에 등록하고,
                    해당 토큰이 내장된 .exe 인스톨러를 자동 빌드하는 기능입니다.
                    아래는 미리 보여주는 UI 만 있고 실제 빌드는 비활성화 상태입니다.
                  </p>
                  <div className="staff-installer-list">
                    {staffList.length === 0 ? (
                      <p className="etc-card-empty">
                        먼저 [시트 설정] 탭에서 편집자/썸네일러를 등록하세요.
                      </p>
                    ) : (
                      staffList.map((s) => (
                        <div key={s.id} className="staff-installer-row">
                          <span className={`staff-chip role-${s.role}`}>
                            {ROLE_LABEL[s.role]} · {s.name}
                          </span>
                          <button
                            type="button"
                            className="etc-installer-btn"
                            disabled
                            title="2차 배포에서 활성화됩니다."
                          >
                            인스톨러 빌드
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="etc-card etc-card-info">
                  <strong>토큰(_tokens) 시트 안내</strong>
                  <p className="etc-card-desc">
                    편집자별 인스톨러는 빌드 시 <code>_tokens</code> 시트에 토큰을 자동 등록합니다.
                    관리자가 해당 시트를 수동으로 만들 필요는 없으며, 처음 빌드 버튼을 누를 때
                    앱이 시트가 없으면 자동으로 생성합니다. 권한이 회수된 편집자는 토큰 행을 삭제하면
                    다음 실행에서 앱이 잠깁니다.
                  </p>
                  <p className="etc-card-desc">
                    위 동작은 현재 설계 문서(§10-3)에 정의되어 있고, 2차 배포에서 활성화될 예정입니다.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="settings-actions">
            <button type="button" onClick={saveSettings}>저장</button>
            <button type="button" onClick={() => setIsSettingsOpen(false)}>
              닫기
            </button>
          </div>
        </section>
      )}
      {showDebugPanel && (
        <aside className="debug-panel">
          <div className="debug-header">
            <span>Debug Log <span className="debug-count">({debugLogs.length})</span></span>
            <div className="debug-header-actions">
              <button type="button" onClick={copyDebugLogs} title="모든 로그를 클립보드에 복사 (개발자 전달용)">전체 복사</button>
              <button type="button" onClick={clearDebugLogs}>Clear</button>
              <button type="button" onClick={() => setShowDebugPanel(false)} title="닫기">×</button>
            </div>
          </div>
          <div className="debug-body" ref={debugPanelRef}>
            {debugLogs.length === 0
              ? <p className="debug-empty">로그 없음</p>
              : debugLogs.map((log, i) => <p key={i} className="debug-line">{log}</p>)
            }
          </div>
        </aside>
      )}

      {csvModalOpen && (
        <div className="csv-modal-overlay" onClick={() => { if (csvPhase !== "analyzing" && csvPhase !== "uploading") { setCsvModalOpen(false); resetCsvModal(); } }}>
          <section className="csv-modal" onClick={(e) => e.stopPropagation()}>
            <header className="csv-modal-header">
              <h3>CSV 가져오기 (AI 변환)</h3>
              <button type="button" className="csv-modal-close" onClick={() => { setCsvModalOpen(false); resetCsvModal(); }} title="닫기">×</button>
            </header>

            <div className="csv-modal-body">
              <div className="csv-target-row">
                <label>
                  대상 탭
                  <select
                    value={csvTargetTab}
                    onChange={(e) => setCsvTargetTab(e.target.value as TabKey)}
                    disabled={csvPhase === "analyzing" || csvPhase === "uploading"}
                  >
                    <option value="shorts">숏폼</option>
                    <option value="longform">롱폼</option>
                    <option value="fullReplay">다시보기</option>
                  </select>
                </label>
                <div className="csv-ai-info">
                  AI: <strong>{aiProvider}</strong> / <strong>{aiModel || "(모델 미선택)"}</strong>
                </div>
              </div>

              <div
                className={`csv-dropzone ${csvIsDragging ? "dragging" : ""} ${csvFileName ? "has-file" : ""}`}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setCsvIsDragging(true); }}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setCsvIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setCsvIsDragging(false); }}
                onDrop={handleCsvDrop}
              >
                <p className="csv-dropzone-text">
                  {csvIsDragging
                    ? "여기에 놓으세요"
                    : csvFileName
                    ? `${csvFileName} (${csvHeader.length}컬럼 × ${csvRows.length}행)`
                    : "CSV 파일을 여기에 드래그&드롭"}
                </p>
                {!csvFileName && (
                  <label className="csv-pick-btn">
                    파일 선택
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleCsvFileLoaded(f);
                      }}
                    />
                  </label>
                )}
              </div>

              {csvHeader.length > 0 && (
                <div className="csv-preview">
                  <p className="csv-preview-title">CSV 미리보기 (첫 5행)</p>
                  <div className="csv-preview-table-wrap">
                    <table className="csv-preview-table">
                      <thead>
                        <tr>{csvHeader.map((h, i) => <th key={i}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {csvRows.slice(0, 5).map((row, ri) => (
                          <tr key={ri}>
                            {csvHeader.map((_, ci) => <td key={ci}>{row[ci] ?? ""}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {csvPhase === "analyzed" && csvMapping && (
                <div className="csv-mapping">
                  <p className="csv-mapping-title">AI 분석 결과 (변환 후 {csvConvertedRows.length}행)</p>
                  <div className="csv-mapping-grid">
                    {Object.entries(csvMapping.headerMap).map(([k, v]) => (
                      <div key={k} className={`csv-mapping-row ${!v ? "ignored" : ""}`}>
                        <span className="csv-mapping-from">{k}</span>
                        <span className="csv-mapping-arrow">→</span>
                        <span className="csv-mapping-to">{v || "(무시)"}</span>
                      </div>
                    ))}
                  </div>
                  {csvMapping.notes && <p className="csv-mapping-notes">메모: {csvMapping.notes}</p>}
                </div>
              )}

              {csvPhase === "failed" && csvErrorMsg && (
                <div className="csv-error-box">
                  <strong>AI 분석 실패</strong>
                  <p>{csvErrorMsg}</p>
                  <p className="csv-error-hint">우측 디버그 패널의 [전체 복사]로 로그를 복사해 개발자에게 전달하세요.</p>
                </div>
              )}

              {csvPhase === "uploaded" && (
                <div className="csv-success-box">
                  <strong>완료</strong>
                  <p>{csvConvertedRows.length}행이 {csvTargetTab === "shorts" ? "숏폼" : csvTargetTab === "longform" ? "롱폼" : "다시보기"} 탭에 추가되고 시트에 업로드되었습니다.</p>
                </div>
              )}
            </div>

            <footer className="csv-modal-footer">
              <button
                type="button"
                onClick={() => { setCsvModalOpen(false); resetCsvModal(); }}
                disabled={csvPhase === "analyzing" || csvPhase === "uploading"}
              >
                {csvPhase === "uploaded" ? "닫기" : "취소"}
              </button>
              <button
                type="button"
                className="csv-analyze-btn"
                onClick={runCsvAnalyze}
                disabled={csvPhase !== "parsed" && csvPhase !== "failed" || csvHeader.length === 0 || csvPhase === "analyzing"}
              >
                {csvPhase === "analyzing" ? "AI 분석 중…" : "AI로 분석"}
              </button>
              <button
                type="button"
                className="csv-upload-btn"
                onClick={runCsvUpload}
                disabled={csvPhase !== "analyzed" || csvConvertedRows.length === 0}
              >
                {csvPhase === "uploading" ? "업로드 중…" : "시트에 업로드"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
