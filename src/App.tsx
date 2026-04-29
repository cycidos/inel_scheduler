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
      sheetsTestConnection: (sheetUrl: string) =>
        Promise<{ ok: boolean; title?: string; sheets?: string[]; clientEmail?: string; error?: string }>;
      categoriesLoadUser: () =>
        Promise<{ ok: boolean; categories?: Array<{ categoryId: string; categoryValue: string; categoryType: string; addedAt?: string }>; path?: string }>;
      categoriesAddUser: (categoryId: string, categoryValue: string, categoryType?: string) =>
        Promise<{ ok: boolean; added?: boolean; categories?: Array<{ categoryId: string; categoryValue: string; categoryType: string; addedAt?: string }>; error?: string }>;
      categoriesSearchOnline: (keyword: string, limit?: number) =>
        Promise<{ ok: boolean; categories?: Array<{ categoryId: string; categoryValue: string; categoryType: string }>; keyword?: string; error?: string }>;
    };
  }
}

type ChzzkStatus = {
  live: boolean;
  category?: string;
  title?: string;
  openDate?: string;
  uptime?: string;
  status?: string;
};

type ChzzkCategoryChange = {
  prev: string;
  next: string;
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

const tableSchema: Record<TabKey, ColumnDef[]> = {
  shorts: [
    { key: "upload", label: "업로드", type: "status", width: 90, shared: true },
    { key: "broadcastDate", label: "방송날짜", type: "date", width: 160, shared: true },
    { key: "videoTitle", label: "영상제목", type: "text", width: 240, shared: true },
    { key: "videoCategory", label: "영상 카테고리", type: "select", width: 220, shared: true },
    { key: "assignee", label: "담당자", type: "text", width: 160 },
    { key: "editStartDate", label: "작업시작일", type: "date", width: 160 },
    { key: "deliveryDate", label: "납품일", type: "date", width: 150 },
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
    { key: "sourceShare", label: "원본 공유", type: "url", width: 200 },
    { key: "deliveryShare", label: "납품 공유", type: "url", width: 200 }
  ],
  longform: [
    { key: "upload", label: "업로드", type: "status", width: 90, shared: true },
    { key: "broadcastDate", label: "방송날짜", type: "date", width: 160, shared: true },
    { key: "videoTitle", label: "영상제목", type: "text", width: 240, shared: true },
    { key: "videoCategory", label: "영상 카테고리", type: "select", width: 220, shared: true },
    { key: "assignee", label: "담당자", type: "text", width: 160 },
    { key: "editStartDate", label: "작업시작일", type: "date", width: 160 },
    { key: "deliveryDate", label: "납품일", type: "date", width: 150 },
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
    { key: "sourceShare", label: "원본 공유", type: "url", width: 200 },
    { key: "deliveryShare", label: "납품 공유", type: "url", width: 200 }
  ],
  fullReplay: [
    { key: "upload", label: "업로드", type: "status", width: 90, shared: true },
    { key: "broadcastDate", label: "방송날짜", type: "date", width: 160, shared: true },
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
        deliveryDate: "2026-04-15",
        editType: "-",
        subtitle: "-",
        sourceShare: "https://drive.example/source-1",
        deliveryShare: ""
      },
      editor: {
        assignee: "",
        editStartDate: "",
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
        deliveryDate: "",
        editType: "-",
        subtitle: "-",
        sourceShare: "",
        deliveryShare: ""
      },
      editor: {
        assignee: "",
        editStartDate: "",
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

function buildDefaultMonthMap(rowsByTab: Record<TabKey, RowItem[]>): Record<TabKey, string> {
  const result: Record<TabKey, string> = {
    shorts: currentMonthKey(),
    longform: currentMonthKey(),
    fullReplay: currentMonthKey()
  };

  (Object.keys(rowsByTab) as TabKey[]).forEach((tab) => {
    const keys = rowsByTab[tab]
      .map((row) => parseMonthKey(row.values.broadcastDate || ""))
      .filter((key): key is string => Boolean(key))
      .sort();
    if (keys.length > 0) {
      result[tab] = keys[keys.length - 1];
    }
  });

  return result;
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
  const [showHelpCard, setShowHelpCard] = useState(false);
  const [helpCardPos, setHelpCardPos] = useState({ top: 0, left: 0 });
  const [helpStep, setHelpStep] = useState(1);
  const helpIconRef = useRef<HTMLSpanElement>(null);
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
  const [showDebugPanel, setShowDebugPanel] = useState(true);

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
    buildDefaultMonthMap(initialRows)
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
    if (availableMonthKeys.length === 0) return data;
    return data.filter((row) => parseMonthKey(row.values.broadcastDate || "") === selectedMonth);
  }, [availableMonthKeys.length, data, selectedMonth]);
  const monthIndex = availableMonthKeys.findIndex((key) => key === selectedMonth);
  const hasPrevMonth = monthIndex > 0;
  const hasNextMonth = monthIndex >= 0 && monthIndex < availableMonthKeys.length - 1;

  const pushHistory = (reason: string) => {
    const now = new Date().toLocaleString("ko-KR");
    setUndoStack((prev) => [...prev, { state: cloneState(appData), reason, at: now }]);
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

  const undoLast = () => {
    if (undoStack.length === 0) return;
    const snapshot = undoStack[undoStack.length - 1];
    setAppData(snapshot.state);
    setUndoStack((prev) => prev.slice(0, -1));
    const now = new Date().toLocaleString("ko-KR");
    setHistoryLogs((prev) => [`${now} - 되살리기: ${snapshot.reason}`, ...prev].slice(0, 20));
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

  const createDetectRow = useCallback((title: string) => {
    const rowId = `fr_${Date.now()}`;
    detectRowId.current = rowId;
    firstCategoryRecorded.current = false;
    const today = new Date().toISOString().slice(0, 10);
    dlog(`createDetectRow: id=${rowId}, title="${title}", date=${today}`);
    setAppData((prev) => {
      const tab: TabKey = "fullReplay";
      const newRow: RowItem = {
        id: rowId,
        values: {
          upload: "",
          broadcastDate: today,
          videoTitle: title || "",
          categoryTimeline: ""
        }
      };
      return {
        ...prev,
        rowsByTab: {
          ...prev.rowsByTab,
          [tab]: [...prev.rowsByTab[tab], newRow]
        }
      };
    });
    return rowId;
  }, []);

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
  }, []);


  const saveSettings = () => {
    try {
      const data = {
        sheetLink,
        serviceAccountPath,
        chzzkLink,
        pollingInterval,
        statusOptions,
        showDebugPanel,
        staffList
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
    } catch {
      // ignore
    }
  }, []);

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
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      dlog(`드롭한 파일이 JSON이 아님: ${file.name}`);
      setSheetsStatus("JSON 파일만 등록 가능합니다.");
      return;
    }
    const filePath = (file as unknown as { path?: string }).path;
    if (!filePath) {
      dlog("Electron 환경이 아니거나 path를 얻을 수 없음");
      setSheetsStatus("Electron 앱에서 시도하세요.");
      return;
    }
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

  const HELP_STEPS: Array<{ id: number; title: string; desc: React.ReactNode; gif: string }> = [
    {
      id: 1,
      title: "프로젝트 생성",
      desc: <><a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>에 접속하여 로그인 후, 상단 메뉴에서 <strong>새 프로젝트</strong>를 만듭니다.</>,
      gif: "/help/01-create-project.gif"
    },
    {
      id: 2,
      title: "Google Sheets API 사용 설정",
      desc: <>좌측 메뉴 → <strong>API 및 서비스</strong> → <strong>라이브러리</strong>에서 <code>Google Sheets API</code>를 검색해 <strong>사용</strong>을 누릅니다.</>,
      gif: "/help/02-enable-sheets-api.gif"
    },
    {
      id: 3,
      title: "서비스 계정 만들기",
      desc: <><strong>사용자 인증 정보</strong> → <strong>+ 사용자 인증 정보 만들기</strong> → <strong>서비스 계정</strong>을 선택합니다. 이름을 입력하고 역할은 건너뛴 뒤 <strong>완료</strong>.</>,
      gif: "/help/03-create-service-account.gif"
    },
    {
      id: 4,
      title: "JSON 키 다운로드",
      desc: <>생성된 서비스 계정을 클릭 → <strong>키</strong> 탭 → <strong>키 추가</strong> → <strong>새 키 만들기</strong> → <strong>JSON</strong>을 선택해 다운로드합니다.</>,
      gif: "/help/04-download-json-key.gif"
    },
    {
      id: 5,
      title: "JSON 파일 앱에 등록",
      desc: <>다운로드 받은 <code>.json</code> 파일을 아래 <strong>드래그&드롭 영역</strong>에 끌어놓거나, <strong>파일 선택</strong>을 누릅니다.</>,
      gif: "/help/05-register-json.gif"
    },
    {
      id: 6,
      title: "서비스 계정 이메일 복사",
      desc: <>등록 완료 후 표시되는 <strong>이메일 복사</strong> 버튼을 클릭하면 클립보드에 복사됩니다.</>,
      gif: "/help/06-copy-email.gif"
    },
    {
      id: 7,
      title: "Google Sheets에 권한 부여",
      desc: <>대상 Google Sheets 문서를 열고 우측 상단 <strong>공유</strong>에 복사한 이메일을 붙여넣어 <strong>편집자</strong> 권한으로 추가합니다.</>,
      gif: "/help/07-share-sheet.gif"
    },
    {
      id: 8,
      title: "연결 테스트",
      desc: <><strong>연결 테스트</strong> 버튼을 눌러 시트가 정상적으로 보이는지 확인합니다. 성공하면 시트 이름과 탭 개수가 표시됩니다.</>,
      gif: "/help/08-connection-test.gif"
    }
  ];

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
      const headers = appData.schemaByTab[tabKey].map((col) => ({ key: col.key, label: col.label }));

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
      const headers = appData.schemaByTab[tabKey].map((col) => ({ key: col.key, label: col.label }));
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
      detectRowId.current = null;
      firstCategoryRecorded.current = false;
      dlog("방송감지 OFF");
    } else {
      if (!chzzkLink) {
        dlog("치지직 방송 링크가 설정되지 않았습니다.");
        return;
      }
      const result = await api.startChzzkPolling(chzzkLink, pollingInterval);
      if (result.ok) {
        setIsDetecting(true);
        firstCategoryRecorded.current = false;
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

        if (!detectRowId.current) {
          createDetectRow(status.title || "");
        }

        if (!firstCategoryRecorded.current && status.category) {
          firstCategoryRecorded.current = true;
          appendTimeline(status.uptime || "00:00:00", status.category);
          setTimelineLog((prev) => [...prev, `${status.uptime || "00:00:00"} - ${status.category}`]);
        }
      }
    });

    const unsub2 = api.onChzzkCategoryChange((change) => {
      const entry = `${change.uptime} - ${change.next}`;
      dlog(`카테고리 변경: ${change.prev} → ${change.next}`);
      setTimelineLog((prev) => [...prev, entry]);
      appendTimeline(change.uptime, change.next);
    });

    const unsub3 = api.onChzzkTitleChange((change) => {
      dlog(`제목 변경: "${change.prev}" → "${change.next}"`);
    });

    const unsub4 = api.onChzzkError((err) => {
      dlog(`치지직 에러: ${err.message}`);
    });

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [createDetectRow, appendTimeline]);

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

  useEffect(() => {
    if (availableMonthKeys.length === 0) return;
    if (!availableMonthKeys.includes(selectedMonth)) {
      setSelectedMonthByTab((prev) => ({
        ...prev,
        [activeTab]: availableMonthKeys[availableMonthKeys.length - 1]
      }));
    }
  }, [activeTab, availableMonthKeys, selectedMonth]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (isSettingsOpen) {
        const inPanel = settingsPanelRef.current?.contains(target);
        const onButton = settingsButtonRef.current?.contains(target);
        const inHelpCard = (target as HTMLElement)?.closest?.(".help-card");
        const onHelpIcon = helpIconRef.current?.contains(target);
        if (!inPanel && !onButton && !inHelpCard && !onHelpIcon) {
          setIsSettingsOpen(false);
          setShowHelpCard(false);
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
    if (monthIndex < 0) return;
    const nextIndex = direction === "prev" ? monthIndex - 1 : monthIndex + 1;
    if (nextIndex < 0 || nextIndex >= availableMonthKeys.length) return;
    setSelectedMonthByTab((prev) => ({
      ...prev,
      [activeTab]: availableMonthKeys[nextIndex]
    }));
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
            <button type="button" onClick={handleImport}>가져오기</button>
            <button type="button" onClick={handleExport}>내보내기</button>
            <button type="button" onClick={addColumn}>열 추가</button>
            <button type="button" onClick={undoLast} disabled={undoStack.length === 0}>
              되살리기
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
        <span>치지직 타임라인 수집: {isDetecting ? "On" : "Idle"}</span>
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
            </tr>
          </thead>
          {(() => {
            const renderTaskRow = (row: RowItem) => {
              const isDropRow = dropTargetRowId === row.id && dragRowId && dragRowId !== row.id;
              const isDragRow = dragRowId === row.id;
              const isSelected = selectedRowByTab[activeTab] === row.id;
              const hasTwoRows = activeTab !== "fullReplay" && row.thumbnailer !== undefined && row.editor !== undefined;
              const subRoles: Array<EditorRole | null> = hasTwoRows ? ["thumbnailer", "editor"] : [null];

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
                  hasTwoRows ? (isFirstSub ? "task-row task-row-first" : "task-row task-row-second") : ""
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
                      const cellClassName = [
                        isShared ? "shared-cell" : "role-cell",
                        role ? `role-${role}` : ""
                      ].filter(Boolean).join(" ") || undefined;
                      return (
                        <td key={column.key} className={cellClassName} {...tdProps}>
                          {renderCellEditor(row, column, role)}
                        </td>
                      );
                    })}
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
            const totalCols = columns.length + 1;
            const renderGroupHeader = (variant: "todo" | "done", label: string, count: number) => (
              <tr className={`group-header group-header-${variant}`}>
                <td colSpan={totalCols}>
                  <span className="group-dot" />
                  <span className="group-label">{label}</span>
                  <span className="group-count">{count}</span>
                </td>
              </tr>
            );
            const emptyRow = (text: string) => (
              <tr className="group-empty-row">
                <td colSpan={totalCols} className="group-empty-cell">{text}</td>
              </tr>
            );

            return (
              <>
                <tbody className="group-section group-section-todo">
                  {renderGroupHeader("todo", "할 일", todoRows.length)}
                  {todoRows.length === 0 ? emptyRow("할 일이 없습니다.") : todoRows.map(renderTaskRow)}
                </tbody>
                <tbody className="group-section group-section-done">
                  {renderGroupHeader("done", "완료됨", doneRows.length)}
                  {doneRows.length === 0 ? emptyRow("완료된 항목이 없습니다.") : doneRows.map(renderTaskRow)}
                </tbody>
              </>
            );
          })()}
          <tfoot>
            <tr>
              <td colSpan={columns.length + 1} className="add-row-footer-cell">
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
          <h2>설정</h2>
          <label>
            <span className="label-with-help">
              Google Sheets 링크
              <span className="help-icon-wrap">
                <span
                  className="help-icon"
                  ref={helpIconRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (showHelpCard) {
                      setShowHelpCard(false);
                    } else {
                      const rect = helpIconRef.current?.getBoundingClientRect();
                      if (rect) {
                        const cardWidth = 420;
                        const left = Math.max(10, Math.min(window.innerWidth - cardWidth - 10, rect.left - cardWidth + 30));
                        setHelpCardPos({ top: rect.bottom + 6, left });
                      }
                      setShowHelpCard(true);
                    }
                  }}
                >?</span>
              </span>
            </span>
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
            <p>status 타입 값 설정</p>
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
              ※ 감지 중 카테고리가 변경되면 Full Replay 마지막 행에 자동 추가됩니다.
            </p>
          </div>
          <div className="history-box">
            <p>행/열 변경 히스토리</p>
            <ul>
              {historyLogs.length === 0 ? <li>기록 없음</li> : historyLogs.map((log) => <li key={log}>{log}</li>)}
            </ul>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={saveSettings}>저장</button>
            <button type="button" onClick={() => setIsSettingsOpen(false)}>
              닫기
            </button>
          </div>
        </section>
      )}
      {showHelpCard && (() => {
        const step = HELP_STEPS.find((s) => s.id === helpStep) ?? HELP_STEPS[0];
        return (
          <>
            <div className="help-card-overlay" onClick={() => setShowHelpCard(false)} />
            <div className="help-card help-card-step" style={{ top: helpCardPos.top, left: helpCardPos.left }}>
              <div className="help-card-header">
                <h4>Google Service Account 설정 가이드</h4>
                <button type="button" className="help-card-close" onClick={() => setShowHelpCard(false)} title="닫기">×</button>
              </div>
              <div className="help-step-tabs">
                {HELP_STEPS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`help-step-tab ${helpStep === s.id ? "active" : ""}`}
                    onClick={() => setHelpStep(s.id)}
                  >
                    {s.id}
                  </button>
                ))}
              </div>
              <div className="help-step-body">
                <p className="help-step-title">Step {step.id}. {step.title}</p>
                <p className="help-step-desc">{step.desc}</p>
                <div className="help-step-gif">
                  <img
                    src={step.gif}
                    alt={`Step ${step.id} GIF`}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                      const next = e.currentTarget.nextElementSibling as HTMLElement | null;
                      if (next) next.style.display = "flex";
                    }}
                  />
                  <div className="help-step-gif-fallback" style={{ display: "none" }}>
                    GIF 준비 중<br /><code>{step.gif}</code>
                  </div>
                </div>
              </div>
              <div className="help-step-nav">
                <button type="button" disabled={helpStep === 1} onClick={() => setHelpStep((p) => Math.max(1, p - 1))}>← 이전</button>
                <span className="help-step-indicator">{helpStep} / {HELP_STEPS.length}</span>
                <button type="button" disabled={helpStep === HELP_STEPS.length} onClick={() => setHelpStep((p) => Math.min(HELP_STEPS.length, p + 1))}>다음 →</button>
              </div>
            </div>
          </>
        );
      })()}
      {showDebugPanel && (
        <aside className="debug-panel">
          <div className="debug-header">
            <span>Debug Log</span>
            <div className="debug-header-actions">
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
    </div>
  );
}

export default App;
