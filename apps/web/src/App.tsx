import { MaterialIcon, IconPicker, itemIconFor } from "./Icons.js";
import i18n, {
  displayUnit,
  localeForDates,
  setLocale,
  type Locale,
} from "./i18n/index.js";
import { apiFetch } from "./i18n/apiFetch.js";
const t = i18n.t.bind(i18n);
import { BatchFields } from "./BatchFields.js";
import { Batches, BatchSelect } from "./Batches.js";
import { BarcodeScanner } from "./BarcodeScanner.js";
import { ItemCombobox } from "./ItemCombobox.js";
import { ItemDetail } from "./ItemDetail.js";
import { BudgetCategoryPicker, BudgetCategoryLabel, BudgetExecution } from "./BudgetCategories.js";
import type { CategorySpending } from "./budgetTree.js";
import {
  type CSSProperties,
  FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Coins,
  Package,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  TriangleAlert,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

const pagePaths = {
  home: "/",
  count: "/count",
  shopping: "/shopping",
  finance: "/finance",
  locations: "/locations",
  categories: "/categories",
  profile: "/profile",
} as const;
type Page = keyof typeof pagePaths;
function pageFromUrl(): Page {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return (
    (Object.keys(pagePaths) as Page[]).find(
      (page) => pagePaths[page] === path,
    ) ?? "home"
  );
}
function itemDetailIdFromUrl() {
  const match=window.location.pathname.match(/^\/items\/([0-9a-f-]{36})\/?$/i);
  return match?.[1]??null;
}

type Item = {
  icon?: string | null;
  id: string;
  homeId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  category: string;
  baseUnit: string;
  reorderPoint: number;
  reorderQuantity: number;
  active: boolean;
  locationName?: string | null;
  locationId?: string | null;
  manufacturedDate?: string | null;
  expiryDate?: string | null;
  lastUnitPrice?:number|null;
  currency?:string|null;
};
type LocationScopedItem=Item&{treeQuantity?:number};
type Stock = { itemId: string; locationId: string; quantity: number };
type Location = {
  id: string;
  homeId: string;
  parentId: string | null;
  name: string;
  active: boolean;
};
type Category = {
  id: string;
  parentId: string | null;
  name: string;
  isSystem: boolean;
  active: boolean;
};
type Transaction = {
  id: string;
  itemName: string;
  locationName: string;
  type: "receipt" | "issue" | "delete" | "reclassify" | "move" | "update";
  quantity: number | null;
  reason?: string | null;
  occurredAt: string;
  batchId?: string | null;
};
type TransactionPage = {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  snapshotAt: string;
};
function TransactionRow({ transaction }: { transaction: Transaction }) {
  const labels = {
    receipt: t("入库"),
    issue: t("领用"),
    delete: t("删除"),
    reclassify: t("分类变更"),
    move: t("位置变更"),
    update: t("批次变更"),
  };
  const stockChange =
    transaction.type === "receipt" || transaction.type === "issue";
  return (
    <div className="log-row">
      <span
        className={`log-badge ${transaction.type}`}
        title={labels[transaction.type]}
      >
        {transaction.type === "delete" ? (
          <Trash2 size={14} />
        ) : stockChange ? (
          transaction.type === "receipt" ? (
            "+"
          ) : (
            "−"
          )
        ) : (
          <ArrowRight size={14} />
        )}
      </span>
      <div>
        <strong>{transaction.itemName}</strong>
        <small>
          {[
            transaction.locationName,
            transaction.reason || labels[transaction.type],
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </div>
      <b className={transaction.type}>
        {stockChange
          ? `${transaction.type === "receipt" ? "+" : "−"}${transaction.quantity}`
          : labels[transaction.type]}
      </b>
      <time>
        {new Date(transaction.occurredAt).toLocaleString(localeForDates(), {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
    </div>
  );
}
type ShoppingItem = {
  id: string;
  itemId?: string | null;
  name: string;
  quantity: number;
  unit?: string | null;
  category?: string | null;
  locationId?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  plannedDate?: string | null;
  estimatedTotal?: number | null;
  source: "manual" | "automatic";
  completed: number;
};
type ShoppingChannel = {
  id: string;
  name: string;
  isSystem: boolean;
  sortOrder: number;
};
type FinancialSummary={month:string;currency:string;budgetTotal:number|null;budgetSourceMonth:string|null;budgetMode:"none"|"explicit"|"inherited";spendingTotal:number;estimatedTotal:number;forecastTotal:number;remainingBudget:number|null;variance:number;inventoryValue:number;pricedBatchCount:number;unknownBatchCount:number;categoryBudgets:{category:string;amount:number}[];categorySpending:CategorySpending[];byCategory:{category:string;actual:number;planned:number;budget:number|null}[];byChannel:{channelId:string|null;channelName:string;total:number}[];purchases:{batchId:string;itemId:string;itemName:string;category:string;purchaseDate:string;quantity:number;unitPrice:number|null;totalPrice:number;channelName:string;estimatedTotal:number|null;variance:number|null}[];trend:{month:string;actual:number;planned:number;budget:number|null}[];valuation:{byItem:{itemId:string;itemName:string;category:string;quantity:number;unit:string;locationCount:number;value:number}[];byCategory:{category:string;value:number}[];byLocation:{locationId:string|null;locationName:string;value:number}[]}};
type ApiToken = {
  id: string;
  name: string;
  homeId?: string | null;
  homeName?: string | null;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
};

function flattenHierarchy<
  T extends { id: string; name: string; parentId: string | null },
>(
  nodes: T[],
  parentId: string | null = null,
  depth = 0,
): (T & { depth: number })[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .flatMap((node) => [
      { ...node, depth },
      ...flattenHierarchy(nodes, node.id, depth + 1),
    ]);
}

function summarizeHierarchy<
  T extends { id: string; name: string; parentId: string | null },
>(nodes: T[], items: Item[], matches: (item: Item, node: T) => boolean) {
  return flattenHierarchy(nodes)
    .map((node) => {
      const branchIds = new Set([node.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of nodes) {
          if (
            candidate.parentId &&
            branchIds.has(candidate.parentId) &&
            !branchIds.has(candidate.id)
          ) {
            branchIds.add(candidate.id);
            changed = true;
          }
        }
      }
      const branchNodes = nodes.filter((candidate) =>
        branchIds.has(candidate.id),
      );
      return {
        ...node,
        count: items.filter((item) =>
          branchNodes.some((candidate) => matches(item, candidate)),
        ).length,
      };
    })
    .filter((node) => node.count > 0);
}

const fallbackHomeId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const getHomeId = () =>
  localStorage.getItem("al1s-wms-home-id") ?? fallbackHomeId;
const itemCategories = [
  "食品",
  "饮品",
  "日用品",
  "药品与健康",
  "衣物",
  "工具",
  "电器",
  "文具",
  "宠物用品",
  "其他",
];
const newIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const formatMoney=(value:number,currency="CNY")=>new Intl.NumberFormat(localeForDates(),{style:"currency",currency,minimumFractionDigits:2}).format(value);
function BrandWordmark() {
  return (
    <strong className="brand-wordmark">
      <b>AL</b>
      <i>1</i>
      <b>S</b>
      <small>WMS</small>
    </strong>
  );
}
async function getItems() {
  const response = await apiFetch(`/api/v1/homes/${getHomeId()}/items`);
  if (!response.ok) throw new Error(t("无法加载物资"));
  return response.json() as Promise<Item[]>;
}
async function getStock() {
  const response = await apiFetch(`/api/v1/homes/${getHomeId()}/stock`);
  if (!response.ok) throw new Error(t("无法加载库存"));
  return response.json() as Promise<Stock[]>;
}
async function getLocations() {
  const response = await apiFetch(`/api/v1/homes/${getHomeId()}/locations`);
  if (!response.ok) throw new Error(t("无法加载地点"));
  return response.json() as Promise<Location[]>;
}
async function getTransactions(page = 1, snapshotAt = "") {
  const response = await apiFetch(
    `/api/v1/homes/${getHomeId()}/transactions?limit=10&offset=${(page - 1) * 10}${snapshotAt ? `&snapshotAt=${encodeURIComponent(snapshotAt)}` : ""}`,
  );
  if (!response.ok) throw new Error(t("无法加载变动记录"));
  return response.json() as Promise<TransactionPage>;
}
async function getShoppingList() {
  const response = await apiFetch(`/api/v1/homes/${getHomeId()}/shopping-list`);
  if (!response.ok) throw new Error(t("无法加载采购清单"));
  return response.json() as Promise<ShoppingItem[]>;
}
async function getShoppingChannels() {
  const response = await apiFetch(
    `/api/v1/homes/${getHomeId()}/shopping-channels`,
  );
  if (!response.ok) throw new Error(t("无法加载购买渠道"));
  return response.json() as Promise<ShoppingChannel[]>;
}
async function getShoppingCalendar(month: string, includeCompleted = false) {
  const response = await apiFetch(
    `/api/v1/homes/${getHomeId()}/shopping-calendar?month=${month}&includeCompleted=${includeCompleted}`,
  );
  if (!response.ok) throw new Error(t("无法加载采购日历"));
  return response.json() as Promise<ShoppingItem[]>;
}
async function getFinancialSummary(month:string) {
  const response=await apiFetch(`/api/v1/homes/${getHomeId()}/financial-dashboard?month=${month}`);
  if(!response.ok)throw new Error(t("无法加载价格统计"));
  return response.json() as Promise<FinancialSummary>;
}
async function getCategories() {
  const response = await apiFetch(`/api/v1/homes/${getHomeId()}/categories`);
  if (!response.ok) throw new Error(t("无法加载物资类型"));
  return response.json() as Promise<Category[]>;
}

function Setup({
  onComplete,
}: {
  onComplete: (home: { id: string; name: string; icon: string }) => void;
}) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [homeName, setHomeName] = useState("");
  const [homeEmoji, setHomeEmoji] = useState("house");
  const [currency, setCurrency] = useState("CNY");
  const [locations, setLocations] = useState(["储物间", "厨房"]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const canNext =
    step === 1
      ? username.trim().length >= 2 && password.length >= 8
      : step === 2
        ? homeName.trim().length > 0
        : locations.some((name) => name.trim());
  const submit = async () => {
    if (!canNext) return;
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    setError("");
    const response = await apiFetch("/api/v1/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        homeName,
        homeIcon: homeEmoji,
        currency,
        locations,
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.message ?? t("初始化失败，请检查输入"));
      return;
    }
    localStorage.setItem("al1s-wms-home-id", data.home.id);
    localStorage.setItem("al1s-wms-home-emoji", homeEmoji);
    onComplete(data.home);
  };
  return (
    <div className="setup-shell">
      <div className="setup-card">
        <div className="setup-brand">
          <img className="setup-mascot" src="/alice.gif" alt="Alice" />
          <div>
            <BrandWordmark />
            <span>{t("首次启动设置")}</span>
          </div>
        </div>
        <div className="setup-progress">
          <span className={step >= 1 ? "active" : ""}>{t("1 账号")}</span>
          <i />
          <span className={step >= 2 ? "active" : ""}>{t("2 家庭")}</span>
          <i />
          <span className={step >= 3 ? "active" : ""}>{t("3 地点")}</span>
        </div>
        {step === 1 && (
          <div className="setup-step">
            <p className="eyebrow">{t("建立本地管理员")}</p>
            <h1>{t("先创建你的账号")}</h1>
            <p className="muted">
              {t("账号只保存在这台 AL1S WMS 中，用于管理成员和敏感操作。")}
            </p>
            <label>
              {t("用户名")}
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoFocus
              />
            </label>
            <label>
              {t("密码")}
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
              />
            </label>
          </div>
        )}
        {step === 2 && (
          <div className="setup-step">
            <p className="eyebrow">{t("建立你的 Home")}</p>
            <h1>{t("这个家庭怎么称呼？")}</h1>
            <p className="muted">
              {t("Home 是物资、成员、地点和预算的共同边界。")}
            </p>
            <label>
              {t("家庭名称")}
              <input
                value={homeName}
                onChange={(event) => setHomeName(event.target.value)}
                placeholder={t("例如：我们家")}
                autoFocus
              />
            </label>
            <IconPicker home initial={homeEmoji} onChange={setHomeEmoji} />
            <label>
              {t("默认货币")}
              <select
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                <option value="CNY">{t("人民币（CNY）")}</option>
                <option value="USD">{t("美元（USD）")}</option>
              </select>
            </label>
          </div>
        )}
        {step === 3 && (
          <div className="setup-step">
            <p className="eyebrow">{t("整理空间")}</p>
            <h1>{t("先添加几个存放地点")}</h1>
            <p className="muted">
              {t("之后可以继续增加。地点帮助你知道物资放在哪里。")}
            </p>
            <div className="location-inputs">
              {locations.map((name, index) => (
                <div className="location-input" key={index}>
                  <input
                    value={name}
                    onChange={(event) =>
                      setLocations(
                        locations.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      )
                    }
                    placeholder={t("例如：储物间")}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setLocations(locations.filter((_, i) => i !== index))
                    }
                    aria-label={t("删除地点")}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              className="add-location"
              type="button"
              onClick={() => setLocations([...locations, ""])}
            >
              {t("＋ 添加另一个地点")}
            </button>
          </div>
        )}
        {error && <div className="setup-error">{error}</div>}
        <div className="setup-footer">
          {step > 1 ? (
            <button className="secondary" onClick={() => setStep(step - 1)}>
              {t("上一步")}
            </button>
          ) : (
            <span />
          )}
          <button
            className="primary"
            disabled={!canNext || busy}
            onClick={submit}
          >
            {busy
              ? t("创建中…")
              : step === 3
                ? t("完成设置，进入 Dashboard")
                : t("继续")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await apiFetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.message ?? t("登录失败"));
      return;
    }
    onLogin();
  };
  return (
    <div className="setup-shell">
      <form className="setup-card login-card" onSubmit={submit}>
        <div className="setup-brand">
          <img className="setup-mascot" src="/alice.gif" alt="Alice" />
          <div>
            <BrandWordmark />
          </div>
        </div>
        <div className="setup-step">
          <p className="eyebrow">{t("欢迎回来")}</p>
          <h1>{t("登录")}</h1>
          <p className="muted">{t("使用初始化时创建的管理员账号继续。")}</p>
          <label>
            {t("用户名")}
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            {t("密码")}
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
            />
          </label>
        </div>
        {error && <div className="setup-error">{error}</div>}
        <button className="primary full" disabled={busy}>
          {busy ? t("登录中…") : t("登录")}
        </button>
      </form>
    </div>
  );
}

export function App() {
  const { i18n: activeI18n } = useTranslation();
  const [setup, setSetup] = useState<{
    complete: boolean;
    home?: { id: string; name: string; icon?: string;defaultCurrency?:string };
  } | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [homes, setHomes] = useState<
    { id: string; name: string; icon?: string;defaultCurrency?:string }[]
  >([]);
  const [homeNotice, setHomeNotice] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [editingHome, setEditingHome] = useState<{
    id: string;
    name: string;
    icon?: string;
    defaultCurrency?:string;
  } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "item" | "category" | "location";
    id: string;
    name: string;
    message: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stockAction, setStockAction] = useState<{
    type: "receipt" | "issue";
    item: Item;
  } | null>(null);
  const [stockLocationId, setStockLocationId] = useState("");
  const [stockOperationKey, setStockOperationKey] = useState("");
  const [page, setPage] = useState(1);
  const [locationFilter, setLocationFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockStatusFilter, setStockStatusFilter] = useState("");
  const [expiryFilter, setExpiryFilter] = useState("");
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  const [prefillLocationId, setPrefillLocationId] = useState("");
  const [prefillCategory, setPrefillCategory] = useState("");
  const [prefillName, setPrefillName] = useState("");
  const [prefillUnit, setPrefillUnit] = useState("个");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [barcodeNotice, setBarcodeNotice] = useState("");
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [itemFormRevision, setItemFormRevision] = useState(0);
  const [categoryName, setCategoryName] = useState("");
  const [categoryParent, setCategoryParent] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationParent, setLocationParent] = useState("");
  const [editTreeNode, setEditTreeNode] = useState<{
    kind: "location" | "category";
    id: string;
    name: string;
    parentId: string | null;
  } | null>(null);
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [transactionSnapshot, setTransactionSnapshot] = useState("");
  const [batchItem, setBatchItem] = useState<Item | null>(null);
  const [activePage, setActivePage] = useState<Page>(()=>itemDetailIdFromUrl()?"count":pageFromUrl());
  const [itemDetailId,setItemDetailId]=useState<string|null>(itemDetailIdFromUrl);
  const countView = activePage === "locations" || activePage === "categories";
  const treeMode = activePage === "categories" ? "category" : "location";
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [newApiToken, setNewApiToken] = useState("");
  const [expandedLocations, setExpandedLocations] = useState<
    Record<string, boolean>
  >({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);
  const [mobileAction,setMobileAction]=useState<{kind:"shopping";item:ShoppingItem}|{kind:"inventory";item:LocationScopedItem}|null>(null);
  const [shoppingChannels, setShoppingChannels] = useState<ShoppingChannel[]>(
    [],
  );
  const [shoppingMonth, setShoppingMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [calendarItems, setCalendarItems] = useState<ShoppingItem[]>([]);
  const [calendarIncludeCompleted, setCalendarIncludeCompleted] =
    useState(false);
  const [selectedShoppingDate, setSelectedShoppingDate] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [financialSummary,setFinancialSummary]=useState<FinancialSummary|null>(null);
  const [calendarFinancial,setCalendarFinancial]=useState<FinancialSummary|null>(null);
  const [financeMonth,setFinanceMonth]=useState(() => new Date().toISOString().slice(0,7));
  const [financeDashboard,setFinanceDashboard]=useState<FinancialSummary|null>(null);
  const [financeValuationView,setFinanceValuationView]=useState<"item"|"category"|"location">("item");
  const [financeSaving,setFinanceSaving]=useState(false);
  const [financeBudgetTotal,setFinanceBudgetTotal]=useState("");
  const [financeBudgetEntries,setFinanceBudgetEntries]=useState<{category:string;amount:string}[]>([]);
  const [financeCategorySelection,setFinanceCategorySelection]=useState("");
  const [financeCategoryAmount,setFinanceCategoryAmount]=useState("");
  const financeFlowRef=useRef<HTMLDivElement>(null);
  const financeBudgetOriginRef=useRef<HTMLDivElement>(null);
  const financeBudgetListRef=useRef<HTMLDivElement>(null);
  const financeBudgetEntryRefs=useRef<Record<string,HTMLDivElement|null>>({});
  const [financeBudgetLinks,setFinanceBudgetLinks]=useState<{fromX:number;fromY:number;toX:number;toY:number}[]>([]);
  const [financeFlowSize,setFinanceFlowSize]=useState({width:0,height:0});
  const [showShoppingForm, setShowShoppingForm] = useState(false);
  const [shoppingItemId, setShoppingItemId] = useState("");
  const [editShoppingItemId, setEditShoppingItemId] = useState("");
  const [editShoppingItem, setEditShoppingItem] = useState<ShoppingItem | null>(
    null,
  );
  const [receiveShoppingItem, setReceiveShoppingItem] =
    useState<ShoppingItem | null>(null);
  const [receiveOperationKey, setReceiveOperationKey] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const itemCategories = categories.length
    ? categories.map((category) => category.name)
    : [
        "食品",
        "饮品",
        "日用品",
        "药品与健康",
        "衣物",
        "工具",
        "电器",
        "文具",
        "宠物用品",
        "其他",
      ];
  const [logView, setLogView] = useState(false);
  useEffect(() => {
    const onPopState = () => {const itemId=itemDetailIdFromUrl();setActivePage(itemId?"count":pageFromUrl());setItemDetailId(itemId);};
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    setLogView(false);
    setShowForm(false);
    setStockAction(null);
    setDetailItem(null);
    setEditTreeNode(null);
    setShowShoppingForm(false);
    setEditShoppingItem(null);
    setReceiveShoppingItem(null);
    setEditingHome(null);
    if (authenticated && activePage === "profile") loadApiTokens();
  }, [activePage, authenticated]);
  const linkedShoppingItem = items.find((item) => item.id === shoppingItemId);
  const linkedEditShoppingItem = items.find(
    (item) => item.id === editShoppingItemId,
  );
  const shoppingChannelName = (item: ShoppingItem) =>
    shoppingChannels.find((channel) => channel.id === item.channelId)?.name ||
    t("未指定");
  const transactionPageCount = Math.max(1, Math.ceil(transactionTotal / 10));
  const pagedTransactions = transactions;
  useEffect(() => {
    if (transactionPage > transactionPageCount)
      setTransactionPage(transactionPageCount);
  }, [transactionPage, transactionPageCount]);
  useEffect(() => {
    if (!authenticated) return;
    getTransactions(
      transactionPage,
      transactionPage === 1 ? "" : transactionSnapshot,
    )
      .then((next) => {
        setTransactions(next.items);
        setTransactionTotal(next.total);
        if (transactionPage === 1) setTransactionSnapshot(next.snapshotAt);
      })
      .catch((error) => setNotice(error.message));
  }, [transactionPage]);

  const load = () =>
    Promise.all([
      getItems(),
      getStock(),
      getLocations(),
      getTransactions(
        transactionPage,
        transactionPage === 1 ? "" : transactionSnapshot,
      ),
      getShoppingList(),
      getCategories(),
      getShoppingChannels(),
      getFinancialSummary(new Date().toISOString().slice(0,7)),
    ])
      .then(
        ([
          nextItems,
          nextStock,
          nextLocations,
          nextTransactions,
          nextShoppingList,
          nextCategories,
          nextShoppingChannels,
          nextFinancialSummary,
        ]) => {
          setItems(nextItems);
          setStock(nextStock);
          setLocations(nextLocations);
          setTransactions(nextTransactions.items);
          setTransactionTotal(nextTransactions.total);
          if (transactionPage === 1)
            setTransactionSnapshot(nextTransactions.snapshotAt);
          setShoppingList(nextShoppingList);
          setCategories(nextCategories);
          setShoppingChannels(nextShoppingChannels);
          setFinancialSummary(nextFinancialSummary);
        },
      )
      .catch((error) => setNotice(error.message));
  useEffect(() => {
    if (!authenticated) return;
    getShoppingCalendar(shoppingMonth, calendarIncludeCompleted)
      .then(setCalendarItems)
      .catch((error) => setNotice(error.message));
    getFinancialSummary(shoppingMonth).then(setCalendarFinancial).catch(error=>setNotice(error.message));
  }, [authenticated, shoppingMonth, calendarIncludeCompleted, shoppingList]);
  useEffect(() => {
    if (!authenticated || activePage !== "finance") return;
    getFinancialSummary(financeMonth).then(data=>{
      setFinanceDashboard(data);
      setFinanceBudgetTotal(data.budgetTotal?.toString()??"");
      setFinanceBudgetEntries(data.categoryBudgets.map(budget=>({category:budget.category,amount:budget.amount.toFixed(2)})));
      setFinanceCategorySelection("");
      setFinanceCategoryAmount("");
    }).catch(error=>setNotice(error.message));
  }, [authenticated, activePage, financeMonth]);
  useLayoutEffect(() => {
    if (activePage !== "finance" || !financeDashboard) return;
    const updateLinks=()=>{
      const flow=financeFlowRef.current,origin=financeBudgetOriginRef.current;
      if(!flow||!origin)return;
      const flowRect=flow.getBoundingClientRect(),originRect=origin.getBoundingClientRect();
      const links=financeBudgetEntries.flatMap(entry=>{
        const target=financeBudgetEntryRefs.current[entry.category];
        if(!target)return [];
        const targetRect=target.getBoundingClientRect();
        return [{fromX:originRect.right-flowRect.left,fromY:originRect.top+originRect.height/2-flowRect.top,toX:targetRect.left-flowRect.left,toY:targetRect.top+targetRect.height/2-flowRect.top}];
      });
      setFinanceFlowSize({width:flowRect.width,height:flowRect.height});
      setFinanceBudgetLinks(links);
    };
    const frame=requestAnimationFrame(updateLinks);
    const observer=new ResizeObserver(updateLinks);
    for(const element of [financeFlowRef.current,financeBudgetOriginRef.current,financeBudgetListRef.current])if(element)observer.observe(element);
    window.addEventListener("resize",updateLinks);
    financeBudgetListRef.current?.addEventListener("scroll",updateLinks);
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener("resize",updateLinks);financeBudgetListRef.current?.removeEventListener("scroll",updateLinks);};
  },[activePage,financeDashboard,financeBudgetEntries]);
  useEffect(() => {
    apiFetch("/api/v1/setup/status")
      .then((response) => response.json())
      .then((data) => {
        setSetup(data);
        if (data.complete)
          apiFetch("/api/v1/auth/me").then((response) =>
            setAuthenticated(response.ok),
          );
      })
      .catch(() => setSetup({ complete: false }));
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    apiFetch("/api/v1/homes")
      .then(async (response) => {
        if (!response.ok) throw new Error(t("无法加载家庭列表"));
        const available = (await response.json()) as typeof homes;
        const current =
          available.find((home) => home.id === getHomeId()) ?? available[0];
        setHomes(available);
        if (current) {
          localStorage.setItem("al1s-wms-home-id", current.id);
          setSetup({ complete: true, home: current });
          await load();
        }
      })
      .catch((error) => setNotice(error.message));
  }, [authenticated]);
  const balanceFor = (itemId: string) =>
    stock
      .filter((row) => row.itemId === itemId)
      .reduce((total, row) => total + row.quantity, 0);
  const locationScopedItems=useMemo(()=>items.flatMap(item=>{
    const balances=stock.filter(row=>row.itemId===item.id&&row.quantity>1e-9);
    if(balances.length)return balances.map(row=>({
      ...item,locationId:row.locationId,
      locationName:locations.find(location=>location.id===row.locationId)?.name??"未指定",
      treeQuantity:row.quantity,
    }));
    return [{...item,treeQuantity:0}];
  }),[items,stock,locations]);
  const replenishmentFor = (item: Item) =>
    Math.max(item.reorderPoint - balanceFor(item.id), 0);
  const stockStatusFor = (item: Item) => {
    const quantity = balanceFor(item.id);
    const difference = quantity - item.reorderPoint;
    if (difference < 0)
      return {
        level: "low",
        label: t("不足"),
        priority: 0,
      };
    if (quantity === 0)
      return { level: "empty", label: t("缺货"), priority: 2 };
    if (difference === 0)
      return { level: "warning", label: t("临界"), priority: 1 };
    return { level: "normal", label: t("正常"), priority: 3 };
  };
  const expiryStatusFor = (item: Item) => {
    if (!item.expiryDate) return { level: "none", label: t("未设") };
    const today = new Date().toISOString().slice(0, 10);
    const threshold = new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    if (item.expiryDate < today) return { level: "expired", label: t("过期") };
    if (item.expiryDate <= threshold)
      return { level: "expiring", label: t("临期") };
    return { level: "valid", label: t("有效") };
  };
  const displayStatusFor = (item: Item) => {
    const expiry = expiryStatusFor(item);
    if (expiry.level === "expired") return { ...expiry, priority: -2 };
    if (expiry.level === "expiring") return { ...expiry, priority: -1 };
    return stockStatusFor(item);
  };
  const locationScopeIds = useMemo(() => {
    if (!locationFilter) return null;
    const ids = new Set<string>([locationFilter]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const location of locations) {
        if (
          location.parentId &&
          ids.has(location.parentId) &&
          !ids.has(location.id)
        ) {
          ids.add(location.id);
          changed = true;
        }
      }
    }
    return ids;
  }, [locations, locationFilter]);
  const categoryScopeNames = useMemo(() => {
    if (!categoryFilter) return null;
    const ids = new Set(
      categories
        .filter((category) => category.name === categoryFilter)
        .map((category) => category.id),
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of categories) {
        if (
          category.parentId &&
          ids.has(category.parentId) &&
          !ids.has(category.id)
        ) {
          ids.add(category.id);
          changed = true;
        }
      }
    }
    return new Set(
      categories
        .filter((category) => ids.has(category.id))
        .map((category) => category.name),
    );
  }, [categories, categoryFilter]);
  const filtered = useMemo(
    () =>
      locationScopedItems
        .filter((item) => {
          if (
            !`${item.name} ${item.sku}`
              .toLowerCase()
              .includes(query.toLowerCase())
          )
            return false;
          if (
            locationScopeIds &&
            (!item.locationId || !locationScopeIds.has(item.locationId))
          )
            return false;
          if (categoryScopeNames && !categoryScopeNames.has(item.category))
            return false;
          if (
            stockStatusFilter === "replenishment" &&
            replenishmentFor(item) <= 0
          )
            return false;
          if (
            stockStatusFilter &&
            stockStatusFilter !== "replenishment" &&
            stockStatusFor(item).level !== stockStatusFilter
          )
            return false;
          if (expiryFilter && expiryStatusFor(item).level !== expiryFilter)
            return false;
          return true;
        })
        .sort(
          (left, right) =>
            displayStatusFor(left).priority -
              displayStatusFor(right).priority ||
            replenishmentFor(right) - replenishmentFor(left) ||
            left.name.localeCompare(right.name, localeForDates()),
        ),
    [
      locationScopedItems,
      query,
      locationScopeIds,
      categoryScopeNames,
      stockStatusFilter,
      expiryFilter,
      stock,
      activeI18n.resolvedLanguage,
    ],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const pagedItems = filtered.slice((page - 1) * 10, page * 10);
  const pageStart = filtered.length ? (page - 1) * 10 + 1 : 0;
  const pageEnd = Math.min(page * 10, filtered.length);
  useEffect(() => {
    setPage(1);
  }, [query, locationFilter, categoryFilter, stockStatusFilter, expiryFilter]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const lowStockItems = items.filter((item) => replenishmentFor(item) > 0);
  const lowStock = lowStockItems.length;
  const expiringItems = items.filter(
    (item) => expiryStatusFor(item).level === "expiring",
  );
  const emptyStockCount = items.filter(
    (item) => stockStatusFor(item).level === "empty",
  ).length;
  const belowStockCount = items.filter(
    (item) => replenishmentFor(item) > 0,
  ).length;
  const criticalStockCount = items.filter(
    (item) => stockStatusFor(item).level === "warning",
  ).length;
  const shoppingItems = shoppingList
    .filter((item) => !item.completed)
    .slice(0, 6);
  const pendingShoppingCount = shoppingList.filter(
    (item) => !item.completed,
  ).length;
  const dashboardItems = [...items]
    .sort(
      (left, right) =>
        displayStatusFor(left).priority - displayStatusFor(right).priority ||
        replenishmentFor(right) - replenishmentFor(left) ||
        left.name.localeCompare(right.name, localeForDates()),
    )
    .slice(0, 8);
  const categorySummary = summarizeHierarchy(
    categories,
    items,
    (item, category) => item.category === category.name,
  );
  const locationSummary = summarizeHierarchy(
    locations,
    items,
    (item, location) => item.locationId === location.id,
  );
  const currentDateLabel = new Intl.DateTimeFormat(localeForDates(), {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
  const [calendarYear, calendarMonthNumber] = shoppingMonth
    .split("-")
    .map(Number);
  const calendarOffset =
    (new Date(calendarYear, calendarMonthNumber - 1, 1).getDay() + 6) % 7;
  const calendarDayCount = new Date(
    calendarYear,
    calendarMonthNumber,
    0,
  ).getDate();
  const calendarCells: (string | null)[] = [
    ...Array.from({ length: calendarOffset }, () => null),
    ...Array.from(
      { length: calendarDayCount },
      (_, index) => `${shoppingMonth}-${String(index + 1).padStart(2, "0")}`,
    ),
  ];
  while (calendarCells.length % 7) calendarCells.push(null);
  const visibleShoppingItems = shoppingList.filter(
    (item) =>
      !item.completed &&
      (!selectedShoppingDate || item.plannedDate === selectedShoppingDate),
  );
  if (!setup)
    return <div className="loading-screen">{t("正在检查家庭设置…")}</div>;
  if (!setup.complete)
    return (
      <Setup
        onComplete={(home) => {
          setAuthenticated(true);
          setSetup({ complete: true, home });
        }}
      />
    );
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await apiFetch(`/api/v1/homes/${getHomeId()}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        barcode: data.get("barcode") || undefined,
        icon: data.get("icon") || null,
        category: data.get("category"),
        baseUnit: data.get("baseUnit"),
        locationId: data.get("locationId") || undefined,
        reorderPoint: Number(data.get("reorderPoint") || 0),
        reorderQuantity: 0,
        initialStock: Number(data.get("initialStock") || 0),
        manufacturedDate: data.get("manufacturedDate") || undefined,
        expiryDate: data.get("expiryDate") || undefined,
        totalPrice:data.get("totalPrice")===""?undefined:Number(data.get("totalPrice")),
        purchaseDate:data.get("purchaseDate")||null,
        channelId:data.get("channelId")||null,
      }),
    });
    setBusy(false);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setNotice(result.message || t("保存失败，请检查填写内容"));
      return;
    }
    form.reset();
    closeItemForm();
    load();
  }

  async function recordStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stockAction || busy) return;
    const data = new FormData(event.currentTarget);
    const quantity = Number(data.get("quantity"));
    const selectedLocation = String(
      data.get("locationId") || locations[0]?.id || locationId,
    );
    if (!quantity || quantity <= 0) return;
    setBusy(true);
    const response = await apiFetch(
      `/api/v1/homes/${getHomeId()}/stock/${stockAction.type}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: stockAction.item.id,
          locationId: selectedLocation,
          quantity,
          idempotencyKey: stockOperationKey,
          reason: data.get("reason") || undefined,
          ...(stockAction.type === "receipt"
            ? {
                manufacturedDate: data.get("manufacturedDate") || null,
                expiryDate: data.get("expiryDate") || null,
                totalPrice:data.get("totalPrice")===""?undefined:Number(data.get("totalPrice")),
                purchaseDate:data.get("purchaseDate")||null,
                channelId:data.get("channelId")||null,
              }
            : { batchId: data.get("batchId") || undefined }),
        }),
      },
    );
    setBusy(false);
    if (response.ok) {
      setStockAction(null);
      load();
    } else setNotice(t("操作失败，可能是库存不足"));
  }

  async function updateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detailItem) return;
    const data = new FormData(event.currentTarget);
    const response = await apiFetch(
      `/api/v1/homes/${getHomeId()}/items/${detailItem.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          icon: data.get("icon") || null,
          barcode: data.get("barcode") || null,
          category: data.get("category"),
          baseUnit: data.get("baseUnit"),
          reorderPoint: Number(data.get("reorderPoint") || 0),
          locationId: data.get("locationId") || null,
        }),
      },
    );
    if (!response.ok) {
      setNotice(t("保存失败，请检查填写内容"));
      return;
    }
    setDetailItem(null);
    load();
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    const response = await apiFetch(`/api/v1/homes/${getHomeId()}/categories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: categoryName.trim(),
        parentId: categoryParent || undefined,
      }),
    });
    if (!response.ok) {
      setNotice(t("分类添加失败"));
      return;
    }
    setCategoryName("");
    setCategoryParent("");
    load();
  }
  async function addLocation(event: FormEvent) {
    event.preventDefault();
    const response = await apiFetch(`/api/v1/homes/${getHomeId()}/locations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: locationName.trim(),
        parentId: locationParent || undefined,
      }),
    });
    if (!response.ok) {
      setNotice(t("地点添加失败"));
      return;
    }
    setLocationName("");
    setLocationParent("");
    load();
  }
  async function addShoppingItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await apiFetch(
      `/api/v1/homes/${getHomeId()}/shopping-list`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quantity: Number(data.get("quantity") || 1),
          itemId: data.get("itemId") || undefined,
          channelId: data.get("channelId") || null,
          plannedDate: data.get("plannedDate") || null,
          estimatedTotal:data.get("estimatedTotal")===""?null:Number(data.get("estimatedTotal")),
          ...(!linkedShoppingItem
            ? {
                name: data.get("name"),
                unit: data.get("unit") || undefined,
                category: data.get("category") || undefined,
                locationId: data.get("locationId") || undefined,
              }
            : {}),
        }),
      },
    );
    if (!response.ok) {
      setNotice(t("采购项添加失败"));
      return;
    }
    setShowShoppingForm(false);
    setShoppingItemId("");
    setSelectedShoppingDate("");
    await load();
  }
  async function receiveShopping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receiveShoppingItem || busy) return;
    const data = new FormData(event.currentTarget);
    const quantity = Number(data.get("quantity"));
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    setBusy(true);
    const response = await apiFetch(
      `/api/v1/homes/${getHomeId()}/shopping-list/${encodeURIComponent(receiveShoppingItem.id)}/receive`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actualQuantity: quantity,
          idempotencyKey: receiveOperationKey,
          locationId: data.get("locationId") || undefined,
          manufacturedDate: data.get("manufacturedDate") || null,
          expiryDate: data.get("expiryDate") || null,
          totalPrice:data.get("totalPrice")===""?undefined:Number(data.get("totalPrice")),
          purchaseDate:data.get("purchaseDate")||null,
        }),
      },
    );
    setBusy(false);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setNotice(
        result.message ||
          t("采购项处理失败（{{status}}）", { status: response.status }),
      );
      return;
    }
    setReceiveShoppingItem(null);
    load();
  }
  function openStockAction(type: "receipt" | "issue", item: Item) {
    setStockLocationId(item.locationId || locations[0]?.id || "");
    setStockOperationKey(newIdempotencyKey());
    setStockAction({ type, item });
  }
  function openShoppingReceipt(item: ShoppingItem) {
    setReceiveOperationKey(newIdempotencyKey());
    setReceiveShoppingItem(item);
  }
  async function updateShoppingItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editShoppingItem) return;
    const data = new FormData(event.currentTarget);
    const response = await apiFetch(
      `/api/v1/homes/${getHomeId()}/shopping-list/${editShoppingItem.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quantity: Number(data.get("quantity") || 1),
          itemId: data.get("itemId") || null,
          channelId: data.get("channelId") || null,
          plannedDate: data.get("plannedDate") || null,
          estimatedTotal:data.get("estimatedTotal")===""?null:Number(data.get("estimatedTotal")),
          ...(!linkedEditShoppingItem
            ? {
                name: data.get("name"),
                unit: data.get("unit"),
                category: data.get("category"),
                locationId: data.get("locationId") || null,
              }
            : {}),
        }),
      },
    );
    if (!response.ok) {
      setNotice(t("采购项保存失败"));
      return;
    }
    setEditShoppingItem(null);
    setEditShoppingItemId("");
    load();
  }
  async function addShoppingChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newChannelName.trim()) return;
    const response = await apiFetch(
      `/api/v1/homes/${getHomeId()}/shopping-channels`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newChannelName.trim() }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      setNotice(result.message || t("购买渠道添加失败"));
      return;
    }
    setNewChannelName("");
    load();
  }
  async function deleteShoppingChannel(channel: ShoppingChannel) {
    if (!window.confirm(t("删除购买渠道“{{name}}”？", { name: channel.name })))
      return;
    const response = await apiFetch(
      `/api/v1/homes/${getHomeId()}/shopping-channels/${channel.id}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setNotice(result.message || t("购买渠道删除失败"));
      return;
    }
    load();
  }
  function moveShoppingMonth(offset: number) {
    const [year, month] = shoppingMonth.split("-").map(Number),
      date = new Date(year, month - 1 + offset, 1);
    setShoppingMonth(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    );
    setSelectedShoppingDate("");
  }
  async function updateTreeNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTreeNode) return;
    const data = new FormData(event.currentTarget);
    const response = await apiFetch(
      `/api/v1/homes/${getHomeId()}/${editTreeNode.kind === "location" ? "locations" : "categories"}/${editTreeNode.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          parentId: data.get("parentId") || null,
        }),
      },
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const messages: Record<string, string> = {
        CATEGORY_CYCLE: t("不能移动到自己的子级下面"),
        LOCATION_CYCLE: t("不能移动到自己的子级下面"),
        CATEGORY_EXISTS: t("同级分类名称已存在"),
        LOCATION_EXISTS: t("同级地点名称已存在"),
        PARENT_CATEGORY_NOT_FOUND: t("父级分类不存在"),
        PARENT_LOCATION_NOT_FOUND: t("父级地点不存在"),
      };
      setNotice(
        messages[result.code] ||
          result.message ||
          t("保存失败（{{status}}）", { status: response.status }),
      );
      return;
    }
    setEditTreeNode(null);
    load();
  }
  function confirmDelete(
    kind: "item" | "category" | "location",
    node: { id: string; name: string; parentId?: string | null },
  ) {
    const parent = (kind === "category" ? categories : locations).find(
      (candidate) => candidate.id === node.parentId,
    );
    const fallback =
      kind === "category"
        ? node.name === "未分类"
          ? "其他"
          : "未分类"
        : node.name === "未指定"
          ? "待整理"
          : "未指定";
    setDeleteError("");
    setDeleteTarget({
      kind,
      id: node.id,
      name: node.name,
      message:
        kind === "item"
          ? t(
              "物资将从清单移除，剩余库存清零并记录删除流水。历史记录保留，关联采购项转为独立采购项。",
            )
          : t(
              "直属物资将归入“{{parent}}”，子节点{{action}}。物资不会被删除，仅记录实际的物资归属变更。",
              {
                parent: parent?.name || fallback,
                action: parent ? t("移到上一级") : t("提升为一级节点"),
              },
            ),
    });
  }
  async function deleteSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const resource = {
        item: "items",
        category: "categories",
        location: "locations",
      }[deleteTarget.kind];
      const response = await apiFetch(
        `/api/v1/homes/${getHomeId()}/${resource}/${deleteTarget.id}`,
        { method: "DELETE" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || t("删除失败，请重试"));
      setDeleteTarget(null);
      setTransactionPage(1);
      await load();
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : t("删除失败，请重试"),
      );
    } finally {
      setDeleting(false);
    }
  }
  async function loadApiTokens() {
    const response = await apiFetch("/api/v1/auth/tokens");
    if (response.ok) setApiTokens(await response.json());
    else setNotice(t("无法加载 MCP 令牌"));
  }
  async function updateHomeCurrency(home:{id:string;name:string;icon?:string;defaultCurrency?:string},defaultCurrency:string) {
    if(busy||defaultCurrency===home.defaultCurrency)return;
    setBusy(true);setHomeNotice("");
    try {
      const response=await apiFetch(`/api/v1/homes/${home.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:home.name,icon:home.icon||"house",defaultCurrency})});
      const updated=await response.json();
      if(!response.ok)throw new Error(updated.message||t("保存失败"));
      setHomes(previous=>previous.map(value=>value.id===updated.id?updated:value));
      if(updated.id===setup?.home?.id)setSetup({complete:true,home:updated});
      setHomeNotice(t("默认币种已更新"));
    } catch(error) {setHomeNotice(error instanceof Error?error.message:t("保存失败"));}
    finally {setBusy(false);}
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") || "");
    const newPassword = String(data.get("newPassword") || "");
    const confirmation = String(data.get("confirmation") || "");
    if (newPassword !== confirmation) {
      setPasswordNotice(t("两次输入的新密码不一致"));
      return;
    }
    setBusy(true);
    setPasswordNotice("");
    try {
      const response = await apiFetch("/api/v1/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || t("密码修改失败"));
      form.reset();
      setPasswordNotice(t("密码已修改"));
    } catch (error) {
      setPasswordNotice(
        error instanceof Error ? error.message : t("密码修改失败"),
      );
    } finally {
      setBusy(false);
    }
  }
  async function createApiToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const scope = String(data.get("homeId") || "");
    const response = await apiFetch("/api/v1/auth/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, homeId: scope === "all" ? null : scope }),
    });
    if (!response.ok) {
      setNotice(t("创建令牌失败"));
      return;
    }
    const result = await response.json();
    setNewApiToken(result.token);
    form.reset();
    loadApiTokens();
  }
  async function revokeApiToken(tokenId: string) {
    const response = await apiFetch(`/api/v1/auth/tokens/${tokenId}`, {
      method: "DELETE",
    });
    if (response.ok) loadApiTokens();
    else setNotice(t("撤销令牌失败"));
  }
  function openItemForm(preset?: {
    locationId?: string;
    category?: string;
    name?: string;
    baseUnit?: string;
    barcode?: string;
  }) {
    setPrefillLocationId(preset?.locationId || "");
    setPrefillCategory(preset?.category || "");
    setPrefillName(preset?.name || "");
    setPrefillUnit(preset?.baseUnit || "个");
    setBarcodeInput(preset?.barcode || "");
    setBarcodeNotice("");
    setItemFormRevision((value) => value + 1);
    setShowForm(true);
  }
  function closeItemForm() {
    setShowForm(false);
    setShowBarcodeScanner(false);
    setPrefillLocationId("");
    setPrefillCategory("");
    setPrefillName("");
    setPrefillUnit("个");
    setBarcodeInput("");
    setBarcodeNotice("");
  }
  async function lookupItemBarcode(raw = barcodeInput) {
    const barcode = raw.replace(/[\s-]/g, "");
    if (!barcode) return;
    setBarcodeBusy(true);
    setBarcodeNotice("");
    try {
      const response = await apiFetch(
        `/api/v1/homes/${getHomeId()}/barcodes/${encodeURIComponent(barcode)}`,
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || t("条码查询失败"));
      setBarcodeInput(result.barcode);
      if (result.item) {
        closeItemForm();
        setDetailItem(result.item);
        setNotice(t("条码已关联物资“{{name}}”", { name: result.item.name }));
        return;
      }
      if (result.found && result.product) {
        setPrefillName(result.product.name || "");
        setPrefillCategory(result.product.category || "其他");
        setPrefillUnit(result.product.baseUnit || "个");
        setItemFormRevision((value) => value + 1);
        setBarcodeNotice(
          result.source === "online"
            ? t("已从在线条码库补全商品信息")
            : t("已从本地条码缓存补全商品信息"),
        );
      } else setBarcodeNotice(t("在线条码库暂无该商品，请手动填写信息"));
    } catch (error) {
      setBarcodeNotice(
        error instanceof Error ? error.message : t("条码查询失败"),
      );
    } finally {
      setBarcodeBusy(false);
    }
  }
  async function saveFinanceBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (financeSaving) return;
    const totalValue=financeBudgetTotal.trim();
    const categoryBudgets=financeBudgetEntries.flatMap(entry=>entry.amount.trim()===""?[]:[{category:entry.category,amount:Number(entry.amount)}]);
    setFinanceSaving(true);
    try {
      const response=await apiFetch(`/api/v1/homes/${getHomeId()}/financial-budget`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({month:financeMonth,total:totalValue===""?null:Number(totalValue),categoryBudgets})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.message||t("保存失败"));
      setFinanceDashboard(result);
      setFinanceBudgetTotal(result.budgetTotal?.toString()??"");
      setFinanceBudgetEntries(result.categoryBudgets.map((budget:{category:string;amount:number})=>({category:budget.category,amount:budget.amount.toFixed(2)})));
      setNotice(t("预算已保存"));
    } catch(error) {setNotice(error instanceof Error?error.message:t("保存失败"));}
    finally {setFinanceSaving(false);}
  }
  function addFinanceCategoryBudget() {
    if(financeBudgetEntries.some(entry=>categoryPath(financeCategorySelection).has(entry.category)||categoryPath(entry.category).has(financeCategorySelection)))return;
    if(!financeCategorySelection||financeCategoryAmount.trim()===""||Number(financeCategoryAmount)<0)return;
    setFinanceBudgetEntries(entries=>[...entries,{category:financeCategorySelection,amount:Number(financeCategoryAmount).toFixed(2)}]);
    setFinanceCategorySelection("");
    setFinanceCategoryAmount("");
  }
  function addFinanceCategoryBudgetOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if(event.key!=="Enter")return;
    event.preventDefault();
    addFinanceCategoryBudget();
  }
  function navigate(page: Page) {
    if (window.location.pathname !== pagePaths[page])
      window.history.pushState(null, "", pagePaths[page]);
    setActivePage(page);
    setItemDetailId(null);
  }
  function openItemDetail(itemId:string) {
    window.history.pushState(null,"",`/items/${itemId}`);
    setItemDetailId(itemId);
  }
  function closeItemDetail() {
    window.history.pushState(null,"",pagePaths.count);
    setActivePage("count");
    setItemDetailId(null);
  }
  async function logout() {
    setBusy(true);
    try {
      const response = await apiFetch("/api/v1/auth/logout", {
        method: "POST",
      });
      if (!response.ok && response.status !== 401)
        throw new Error(t("退出失败，请重试"));
      window.location.reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("退出失败"));
      setBusy(false);
    }
  }

  type TreeNode = {
    id: string;
    name: string;
    parentId: string | null;
    items: LocationScopedItem[];
  };
  const treeNodes: TreeNode[] =
    treeMode === "location"
      ? locations.map((location) => ({
          id: location.id,
          name: location.name,
          parentId: location.parentId,
          items: locationScopedItems.filter(
            (item) => item.locationId === location.id,
          ),
        }))
      : categories.map((category) => ({
          id: category.id,
          name: category.name,
          parentId: category.parentId,
          items: locationScopedItems.filter(
            (item) => item.category === category.name,
          ),
        }));
  const categoryOptions = flattenHierarchy(categories);
  const locationOptions = flattenHierarchy(locations);
  const selectCategoryOptions = categories.length
    ? categoryOptions
    : itemCategories.map((name) => ({
        id: name,
        name,
        parentId: null,
        depth: 0,
      }));
  const categoryPath=(name:string)=>{
    const path=new Set([name]),seen=new Set<string>();
    let category=categories.find(row=>row.name===name);
    while(category&&!seen.has(category.id)) {
      seen.add(category.id);
      category=categories.find(row=>row.id===category?.parentId);
      if(category)path.add(category.name);
    }
    return path;
  };
  const financeAllocatedBudget=financeBudgetEntries.reduce((total,entry)=>total+(Number(entry.amount)||0),0);
  const renderTreeNode = (node: TreeNode, depth = 0) => {
    const open = expandedLocations[node.id] ?? true;
    const children = treeNodes.filter((child) => child.parentId === node.id);
    const expandable = children.length > 0 || node.items.length > 0;
    return (
      <div className="tree-node" key={node.id}>
        <div
          className="tree-node-head"
          style={{ paddingLeft: 16 + depth * 22 }}
        >
          <button
            type="button"
            className="tree-expander"
            disabled={!expandable}
            aria-label={open ? t("收起") : t("展开")}
            onClick={() =>
              setExpandedLocations({ ...expandedLocations, [node.id]: !open })
            }
          >
            {expandable &&
              (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>
          <button
            type="button"
            className="tree-node-label"
            disabled={!expandable}
            onClick={() =>
              setExpandedLocations({ ...expandedLocations, [node.id]: !open })
            }
          >
            {node.name}
          </button>
          <div className="tree-node-actions">
            <button
              type="button"
              className="tree-icon-button"
              title={t("增加物资")}
              aria-label={t("在{{name}}增加物资", { name: node.name })}
              onClick={() =>
                openItemForm(
                  treeMode === "location"
                    ? { locationId: node.id }
                    : { category: node.name },
                )
              }
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              className="tree-icon-button"
              title={t("编辑{{type}}", {
                type: treeMode === "location" ? t("地点") : t("分类"),
              })}
              aria-label={t("编辑{{name}}", { name: node.name })}
              onClick={() =>
                setEditTreeNode({
                  kind: treeMode,
                  id: node.id,
                  name: node.name,
                  parentId: node.parentId,
                })
              }
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="tree-icon-button danger-action"
              title={t("删除{{type}}", {
                type: treeMode === "location" ? t("地点") : t("分类"),
              })}
              aria-label={t("删除{{name}}", { name: node.name })}
              onClick={() => confirmDelete(treeMode, node)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        {open && (
          <>
            {node.items.map((item) => {
              const status = displayStatusFor(item);
              return (
                <div
                  className="tree-item-row"
                  key={`${item.id}:${item.locationId??"none"}`}
                  style={{ "--tree-depth": depth } as CSSProperties}
                >
                  <strong className="tree-item-name">
                    <MaterialIcon value={itemIconFor(item)} />
                    {item.name}
                  </strong>
                  <span className="tree-item-stock">
                    {item.treeQuantity ?? balanceFor(item.id)}{" "}
                    {displayUnit(item.baseUnit)}
                  </span>
                  <span className={`stock-status ${status.level}`}>
                    {status.label}
                  </span>
                  <span className="tree-item-meta">
                    {treeMode === "location"
                      ? item.category || t("未分类")
                      : item.locationName || t("未指定地点")}
                    {item.expiryDate
                      ? t(" · 到期 {{date}}", { date: item.expiryDate })
                      : ""}
                  </span>
                  <button
                    className="text-button"
                    onClick={() =>
                      setDetailItem(
                        items.find((current) => current.id === item.id) ?? item,
                      )
                    }
                  >
                    {t("编辑")}
                  </button>
                </div>
              );
            })}
            {children.map((child) => renderTreeNode(child, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="shell" data-page={activePage}>
      <header className="topbar">
        <div className="brand">
          <img className="brand-mascot" src="/alice.gif" alt="Alice" />
          <div>
            <BrandWordmark />
          </div>
        </div>
        <nav className="main-nav" aria-label={t("主导航")}>
          <button
            className={activePage === "home" ? "active" : ""}
            onClick={() => navigate("home")}
          >
            {t("首页")}
          </button>
          <button
            className={activePage === "count" ? "active" : ""}
            onClick={() => navigate("count")}
          >
            {t("盘点")}
          </button>
          <button
            className={activePage === "shopping" ? "active" : ""}
            onClick={() => navigate("shopping")}
          >
            {t("采购")}
          </button>
          <button
            className={activePage === "finance" ? "active" : ""}
            onClick={() => navigate("finance")}
          >
            {t("财务")}
          </button>
          <button
            className={activePage === "locations" ? "active" : ""}
            onClick={() => navigate("locations")}
          >
            {t("地点")}
          </button>
          <button
            className={activePage === "categories" ? "active" : ""}
            onClick={() => navigate("categories")}
          >
            {t("分类")}
          </button>
        </nav>
        <div className="top-actions">
          <div className="home-switch">
            <MaterialIcon value={setup.home?.icon} home size={18} />
            <select
              aria-label={t("切换家庭")}
              value={setup.home?.id ?? ""}
              onChange={(event) => {
                localStorage.setItem("al1s-wms-home-id", event.target.value);
                window.location.reload();
              }}
            >
              {homes.map((home) => (
                <option key={home.id} value={home.id}>
                  {home.name}
                </option>
              ))}
            </select>
          </div>
          <button
            className={`avatar ${activePage === "profile" ? "active" : ""}`}
            onClick={() => navigate("profile")}
            aria-label={t("账号与 MCP 令牌")}
          >
            {t("我")}
          </button>
        </div>
      </header>
      <main>
        {itemDetailId&&<ItemDetail homeId={getHomeId()} item={items.find(item=>item.id===itemDetailId)??{id:itemDetailId,name:t("物资"),sku:"",category:t("未分类"),baseUnit:t("个"),reorderPoint:0,reorderQuantity:0}} currency={financialSummary?.currency??"CNY"} onBack={closeItemDetail} onEdit={()=>{const item=items.find(current=>current.id===itemDetailId);if(item)setDetailItem(item);}}/>}
        <div hidden={Boolean(itemDetailId)}>
        <section className="welcome">
          <div>
            <p className="eyebrow">{currentDateLabel}</p>
            <h1>
              {activePage === "home"
                ? t("总览")
                : activePage === "count"
                  ? t("物资盘点")
                  : activePage === "locations"
                    ? t("地点")
                    : activePage === "categories"
                      ? t("分类")
                      : activePage === "shopping"
                        ? t("采购清单")
                        : activePage === "finance"
                          ? t("财务")
                        : t("我的设置")}
            </h1>
            <p className="muted">
              {activePage === "home"
                ? t("掌握家里有什么，及时补充需要的东西。")
                : activePage === "count"
                  ? t("添加物资、调整库存并查看变动记录。")
                  : activePage === "locations"
                    ? t("按存放空间查看家里的物资。")
                    : activePage === "categories"
                      ? t("维护物资分类和分类树。")
                      : activePage === "shopping"
                        ? t("管理自动建议和手动采购项。")
                        : activePage === "finance"
                          ? t("查看预算、采购支出和库存价值。")
                        : t("管理家庭、Agent 访问令牌与登录会话。")}
            </p>
          </div>
          {activePage === "profile" && (
            <button
              className="secondary profile-logout"
              disabled={busy}
              onClick={logout}
            >
              {t("退出登录")}
            </button>
          )}
          {activePage === "home" && (
            <div className="dashboard-actions" aria-label={t("快捷操作")}>
              <button type="button" onClick={() => openItemForm()}>
                <Plus size={16} />
                {t("添加物资")}
              </button>
              <button type="button" onClick={() => navigate("count")}>
                <Check size={16} />
                {t("开始盘点")}
              </button>
              <button type="button" onClick={() => navigate("shopping")}>
                <ClipboardList size={16} />
                {t("采购清单")}
              </button>
            </div>
          )}
          {activePage === "shopping" && (
            <button
              className="primary"
              onClick={() => setShowShoppingForm(true)}
            >
              {t("＋ 添加采购项")}
            </button>
          )}
          {activePage === "count" && (
            <div className="welcome-actions count-actions">
              <button className="primary" onClick={() => openItemForm()}>
                {t("＋ 添加物资")}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  openItemForm();
                  setShowBarcodeScanner(true);
                }}
              >
                {t("扫描条码")}
              </button>
            </div>
          )}
        </section>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button onClick={() => setNotice("")} aria-label={t("关闭")}>
              ×
            </button>
          </div>
        )}
        {activePage === "finance" && financeDashboard && (
          <div className="finance-page">
            <section className="finance-toolbar">
              <label>{t("统计月份")}<input type="month" value={financeMonth} onChange={event=>setFinanceMonth(event.target.value)} /></label>
              <span>{t("采购日期决定实际支出归属月份")}</span>
            </section>
            <section className="finance-kpis">
              {[
                [t("月度预算"),financeDashboard.budgetTotal],
                [t("实际支出"),financeDashboard.spendingTotal],
                [t("待采购预计"),financeDashboard.estimatedTotal],
                [t("预测支出"),financeDashboard.forecastTotal],
                [t("剩余预算"),financeDashboard.remainingBudget],
              ].map(([label,value])=><div className={`finance-kpi ${label===t("剩余预算")&&typeof value==="number"&&value<0?"over": ""}`} key={String(label)}><small>{label}</small><strong>{value===null?t("未设置"):formatMoney(Number(value),financeDashboard.currency)}</strong></div>)}
            </section>
            <section className="finance-layout">
              <section className="panel finance-trend">
                <div className="panel-head"><div><h2>{t("支出趋势")}</h2><p className="muted">{t("实际支出、待采购预计与月度预算")}</p></div></div>
                <div className="trend-chart" aria-label={t("过去 12 个月支出趋势")}>
                  {financeDashboard.trend.map(point=>{const max=Math.max(1,...financeDashboard.trend.flatMap(row=>[row.actual+row.planned,row.budget??0]));return <div className="trend-column" key={point.month} title={`${point.month}: ${formatMoney(point.actual,financeDashboard.currency)}`}><div className="trend-stack"><i style={{height:`${point.actual/max*100}%`}} /><em style={{height:`${point.planned/max*100}%`}} />{point.budget!==null&&<b style={{bottom:`${point.budget/max*100}%`}} />}</div><small>{point.month.slice(5)}</small></div>;})}
                </div>
                <div className="chart-legend"><span><i className="actual" />{t("实际支出")}</span><span><i className="planned" />{t("待采购预计")}</span><span><i className="budget" />{t("月度预算")}</span></div>
              </section>
              <form className="panel finance-budget" onSubmit={saveFinanceBudget}>
                <div className="panel-head"><div><h2>{t("预算设置")}</h2>{financeDashboard.budgetMode==="inherited"&&<p className="muted">{t("沿用预算")} · {financeDashboard.budgetSourceMonth}</p>}</div><span className={`budget-mode ${financeDashboard.budgetMode}`}>{financeDashboard.budgetMode==="inherited"?t("沿用预算"):financeDashboard.budgetMode==="explicit"?t("本月预算"):t("未设置")}</span></div>
                <div className="finance-budget-body"><div className="finance-budget-flow" ref={financeFlowRef}>{financeFlowSize.width>0&&<svg className="budget-flow-lines" viewBox={`0 0 ${financeFlowSize.width} ${financeFlowSize.height}`} aria-hidden="true">{financeBudgetLinks.map((link,index)=>{const span=Math.max(60,link.toX-link.fromX);return <path key={index} d={`M ${link.fromX} ${link.fromY} C ${link.fromX+span*.46} ${link.fromY}, ${link.toX-span*.4} ${link.toY}, ${link.toX} ${link.toY}`}/>;})}</svg>}<div className="finance-budget-overview"><div className="finance-budget-source" ref={financeBudgetOriginRef}><label>{t("月度总预算")}<input value={financeBudgetTotal} onChange={event=>setFinanceBudgetTotal(event.target.value)} type="number" min="0" step="0.01" placeholder="0.00" /></label><div className="budget-allocation"><span>{t("已分配")}</span><strong>{formatMoney(financeAllocatedBudget,financeDashboard.currency)}</strong><small>{t("可分配")} {financeBudgetTotal.trim()===""?t("未设置"):formatMoney(Number(financeBudgetTotal)-financeAllocatedBudget,financeDashboard.currency)}</small></div></div><div className="budget-add"><div><strong>{t("添加分类预算")}</strong></div><div className="budget-category-picker"><BudgetCategoryPicker categories={categories} entries={financeBudgetEntries} value={financeCategorySelection} onChange={setFinanceCategorySelection}/><input value={financeCategoryAmount} onChange={event=>setFinanceCategoryAmount(event.target.value)} onKeyDown={addFinanceCategoryBudgetOnEnter} type="number" min="0" step="0.01" placeholder={t("预算金额")} /><button type="button" className="secondary" disabled={!financeCategorySelection||financeCategoryAmount.trim()===""} onClick={addFinanceCategoryBudget}>{t("添加")}</button></div></div></div><div className="finance-budget-editor"><div className="budget-editor-head"><div><strong>{t("分类预算")}</strong></div><b>{formatMoney(financeAllocatedBudget,financeDashboard.currency)}</b></div><div className="category-budget-list" ref={financeBudgetListRef}>{financeBudgetEntries.length?financeBudgetEntries.map((entry,index)=><div className="category-budget-entry" ref={node=>{financeBudgetEntryRefs.current[entry.category]=node;}} key={entry.category}><BudgetCategoryLabel name={entry.category} categories={categories}/><input value={entry.amount} onChange={event=>setFinanceBudgetEntries(entries=>entries.map((value,current)=>current===index?{...value,amount:event.target.value}:value))} type="number" min="0" step="0.01" /><button type="button" aria-label={t("移除{{name}}",{name:entry.category})} onClick={()=>setFinanceBudgetEntries(entries=>entries.filter((_,current)=>current!==index))}><X size={14}/></button></div>):<p className="muted">{t("尚未添加分类预算")}</p>}</div></div></div><div className="finance-budget-actions">{financeBudgetTotal.trim()!==""&&financeAllocatedBudget>Number(financeBudgetTotal)&&<small role="alert">{t("分类预算合计不得超过总预算")}</small>}<button className="primary" disabled={financeSaving}>{financeSaving?t("保存中…"):t("保存预算")}</button></div></div>
              </form>
              <BudgetExecution key={`${getHomeId()}:${financeMonth}`} categories={categories} spending={financeDashboard.categorySpending??[]} budgets={financeDashboard.categoryBudgets} currency={financeDashboard.currency}/>
              <section className="panel finance-bars"><div className="panel-head"><div><h2>{t("渠道支出")}</h2><p className="muted">{t("已完成采购")}</p></div></div><div className="bar-list">{financeDashboard.byChannel.length?financeDashboard.byChannel.map(row=>{const max=Math.max(1,...financeDashboard.byChannel.map(item=>item.total));return <div className="bar-row" key={row.channelId??"none"}><span>{row.channelName}</span><div><i style={{width:`${row.total/max*100}%`}} /></div><b>{formatMoney(row.total,financeDashboard.currency)}</b></div>}):<p className="empty">{t("本月暂无渠道支出")}</p>}</div></section>
            </section>
              <section className="panel finance-purchases"><div className="panel-head"><div><h2>{t("采购流水")}</h2><p className="muted">{t("已录入成本的入库批次")}</p></div></div><div className="table-wrap"><table><thead><tr><th>{t("日期")}</th><th>{t("物资")}</th><th>{t("分类")}</th><th>{t("渠道")}</th><th>{t("数量")}</th><th>{t("单价")}</th><th>{t("实付总价")}</th><th>{t("预计差异")}</th></tr></thead><tbody>{financeDashboard.purchases.length?financeDashboard.purchases.map(row=><tr key={row.batchId}><td>{row.purchaseDate}</td><td><button type="button" className="item-link" onClick={()=>openItemDetail(row.itemId)}>{row.itemName}</button></td><td>{row.category}</td><td>{row.channelName}</td><td>{row.quantity}</td><td>{row.unitPrice===null?t("未知"):formatMoney(row.unitPrice,financeDashboard.currency)}</td><td>{formatMoney(row.totalPrice,financeDashboard.currency)}</td><td className={row.variance!==null&&row.variance>0?"negative":""}>{row.variance===null?"-":formatMoney(row.variance,financeDashboard.currency)}</td></tr>):<tr><td colSpan={8} className="empty">{t("本月暂无采购流水")}</td></tr>}</tbody></table></div></section>
            <section className="panel finance-valuation"><div className="panel-head"><div><h2>{t("库存价值")}</h2><p className="muted">{t("按剩余数量和批次单位成本估值")}</p></div><strong>{formatMoney(financeDashboard.inventoryValue,financeDashboard.currency)}</strong></div><div className="valuation-meta"><span>{t("已计价批次")} {financeDashboard.pricedBatchCount}</span><span>{t("未知成本批次")} {financeDashboard.unknownBatchCount}</span><div className="valuation-switch" role="tablist" aria-label={t("库存价值")}><button type="button" role="tab" aria-selected={financeValuationView==="item"} className={financeValuationView==="item"?"active":""} onClick={()=>setFinanceValuationView("item")}>{t("按物资")}</button><button type="button" role="tab" aria-selected={financeValuationView==="category"} className={financeValuationView==="category"?"active":""} onClick={()=>setFinanceValuationView("category")}>{t("按分类")}</button><button type="button" role="tab" aria-selected={financeValuationView==="location"} className={financeValuationView==="location"?"active":""} onClick={()=>setFinanceValuationView("location")}>{t("按地点")}</button></div></div><div className="valuation-list">{financeValuationView==="item"?financeDashboard.valuation.byItem.map(row=><div className="valuation-row" key={row.itemId}><div><button type="button" className="item-link" onClick={()=>openItemDetail(row.itemId)}>{row.itemName}</button><small>{row.category} · {row.quantity} {displayUnit(row.unit)} · {t("{{count}} 个地点",{count:row.locationCount})}</small></div><b>{formatMoney(row.value,financeDashboard.currency)}</b></div>):(financeValuationView==="category"?financeDashboard.valuation.byCategory.map(row=><div className="valuation-row" key={row.category}><strong>{row.category}</strong><b>{formatMoney(row.value,financeDashboard.currency)}</b></div>):financeDashboard.valuation.byLocation.map(row=><div className="valuation-row" key={row.locationId??"none"}><strong>{row.locationName}</strong><b>{formatMoney(row.value,financeDashboard.currency)}</b></div>))}</div></section>
          </div>
        )}
        {activePage === "profile" && (
          <section className="panel language-panel">
            <div className="panel-head">
              <div>
                <h2>{t("语言")}</h2>
                <p className="muted">{t("选择界面显示语言")}</p>
              </div>
            </div>
            <div className="language-control">
              <label htmlFor="interface-language">
                <span>{t("界面语言")}</span>
                <span className="language-select-wrap">
                  <select
                    id="interface-language"
                    value={activeI18n.resolvedLanguage ?? activeI18n.language}
                    onChange={(event) =>
                      void setLocale(event.target.value as Locale)
                    }
                  >
                    <option value="zh-CN">{t("简体中文")}</option>
                    <option value="en-US">{t("English")}</option>
                  </select>
                  <ChevronDown size={16} aria-hidden="true" />
                </span>
              </label>
            </div>
          </section>
        )}
        {activePage === "profile" && (
          <section className="panel password-panel">
            <div className="panel-head">
              <div>
                <h2>{t("修改密码")}</h2>
                <p className="muted">{t("验证当前密码后设置新密码")}</p>
              </div>
            </div>
            <form className="password-form" onSubmit={changePassword}>
              <label>
                {t("当前密码")}
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                {t("新密码")}
                <input
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <label>
                {t("确认新密码")}
                <input
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? t("修改中…") : t("修改密码")}
              </button>
            </form>
            {passwordNotice && (
              <p className="password-feedback" role="status">
                {passwordNotice}
              </p>
            )}
          </section>
        )}
        {activePage === "profile" && (
          <section className="panel home-settings">
            <div className="panel-head">
              <div>
                <h2>{t("家庭管理")}</h2>
                <p className="muted">
                  {t("共")}
                  {homes.length} {t("个家庭 · 各家庭物资独立管理")}
                </p>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setEditingHome({ id: "", name: "", icon: "house",defaultCurrency:"CNY" });
                  setHomeNotice("");
                }}
              >
                {t("新增家庭")}
              </button>
            </div>
            <div className="home-list">
              {homes.map((home) => (
                <div
                  className={`home-card ${home.id === setup.home?.id ? "current" : ""}`}
                  key={home.id}
                >
                  <span className="home-card-icon">
                    <MaterialIcon value={home.icon} home size={24} />
                  </span>
                  <div className="home-card-name">
                    <strong>{home.name}</strong>
                    <small>
                      {home.id === setup.home?.id ? t("当前使用") : t("可切换")}
                    </small>
                  </div>
                  <label className="home-card-currency">{t("默认币种")}<select value={home.defaultCurrency||"CNY"} disabled={busy} onChange={event=>void updateHomeCurrency(home,event.target.value)}>{["CNY","USD","EUR","JPY","GBP","HKD"].map(currency=><option key={currency} value={currency}>{currency}</option>)}</select></label>
                  <div className="home-card-actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setEditingHome(home);
                        setHomeNotice("");
                      }}
                    >
                      {t("编辑")}
                    </button>
                    {home.id !== setup.home?.id && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          localStorage.setItem("al1s-wms-home-id", home.id);
                          window.location.reload();
                        }}
                      >
                        {t("切换")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {editingHome && (
              <form
                className="home-editor"
                key={editingHome.id}
                onSubmit={async (event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  setBusy(true);
                  setHomeNotice("");
                  try {
                    const response = await apiFetch(
                      editingHome.id
                        ? `/api/v1/homes/${editingHome.id}`
                        : "/api/v1/homes",
                      {
                        method: editingHome.id ? "PATCH" : "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: data.get("name"),
                          icon: data.get("icon"),
                          defaultCurrency:data.get("defaultCurrency"),
                        }),
                      },
                    );
                    const home = await response.json();
                    if (!response.ok)
                      throw new Error(home.message || t("保存失败"));
                    setHomes((previous) =>
                      editingHome.id
                        ? previous.map((value) =>
                            value.id === home.id ? home : value,
                          )
                        : [...previous, home],
                    );
                    if (home.id === setup.home?.id) {
                      setSetup({ complete: true, home });
                      localStorage.setItem("al1s-wms-home-emoji", home.icon);
                    }
                    setEditingHome(null);
                    setHomeNotice(
                      editingHome.id
                        ? t("家庭已保存")
                        : t("家庭已创建，可切换后在地点页面添加房间"),
                    );
                  } catch (error) {
                    setHomeNotice(
                      error instanceof Error ? error.message : t("保存失败"),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h3>{editingHome.id ? t("编辑家庭") : t("新增家庭")}</h3>
                <label>
                  {t("家庭名称")}
                  <input
                    name="name"
                    required
                    maxLength={80}
                    defaultValue={editingHome.name}
                  />
                </label>
                <label>{t("默认币种")}<select name="defaultCurrency" defaultValue={editingHome.defaultCurrency||"CNY"}>{["CNY","USD","EUR","JPY","GBP","HKD"].map(currency=><option key={currency} value={currency}>{currency}</option>)}</select></label>
                <IconPicker home initial={editingHome.icon} />
                <div className="home-editor-actions">
                  <button className="primary" disabled={busy}>
                    {busy ? t("保存中…") : t("保存家庭")}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setEditingHome(null)}
                  >
                    {t("取消")}
                  </button>
                </div>
              </form>
            )}
            {homeNotice && (
              <p className="home-feedback" role="status">
                {homeNotice}
              </p>
            )}
          </section>
        )}
        {activePage === "profile" && (
          <section className="panel token-panel">
            <div className="panel-head">
              <div>
                <h2>{t("MCP 访问令牌")}</h2>
                <p className="muted">
                  {t(
                    "连接地址为当前站点的 /mcp，认证方式为 Bearer Token。默认仅管理所选家庭。",
                  )}
                </p>
              </div>
              {barcodeNotice && (
                <p className="barcode-feedback" role="status">
                  {barcodeNotice}
                </p>
              )}
            </div>
            <form className="token-create" onSubmit={createApiToken}>
              <input
                name="name"
                required
                maxLength={80}
                placeholder={t("令牌名称，例如：Claude Desktop")}
              />
              <select
                name="homeId"
                defaultValue={getHomeId()}
                aria-label={t("令牌家庭范围")}
              >
                {homes.map((home) => (
                  <option key={home.id} value={home.id}>
                    {home.name}
                  </option>
                ))}
                <option value="all">{t("全部家庭（高级）")}</option>
              </select>
              <button type="submit" className="primary">
                {t("创建令牌")}
              </button>
            </form>
            {newApiToken && (
              <div className="token-secret" role="status">
                <strong>{t("请立即复制，关闭后无法再次查看")}</strong>
                <code>{newApiToken}</code>
                <div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => navigator.clipboard.writeText(newApiToken)}
                  >
                    {t("复制")}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setNewApiToken("")}
                  >
                    {t("已保存")}
                  </button>
                </div>
              </div>
            )}
            <div className="token-list">
              {apiTokens.length === 0 ? (
                <p className="empty">{t("尚未创建 MCP 令牌")}</p>
              ) : (
                apiTokens.map((token) => (
                  <div className="token-row" key={token.id}>
                    <div>
                      <strong>{token.name}</strong>
                      <span>
                        {token.tokenPrefix} ·{" "}
                        {token.homeId
                          ? t("家庭：{{name}}", {
                              name: token.homeName || t("已删除"),
                            })
                          : t("全部家庭（高级）")}{" "}
                        {t("· 创建于")}
                        {new Date(token.createdAt).toLocaleString(
                          localeForDates(),
                        )}
                      </span>
                      <span>
                        {token.lastUsedAt
                          ? t("最近使用 {{date}}", {
                              date: new Date(token.lastUsedAt).toLocaleString(
                                localeForDates(),
                              ),
                            })
                          : t("尚未使用")}
                      </span>
                    </div>
                    {token.revokedAt ? (
                      <span className="revoked">{t("已撤销")}</span>
                    ) : (
                      <button
                        type="button"
                        className="danger-text"
                        onClick={() => revokeApiToken(token.id)}
                      >
                        {t("撤销")}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        )}
        {activePage === "locations" && (
          <section className="panel category-manager">
            <div className="panel-head">
              <div>
                <h2>{t("地点管理")}</h2>
                <p className="muted">{t("新增一级地点或子地点")}</p>
              </div>
            </div>
            <form className="category-form" onSubmit={addLocation}>
              <input
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                placeholder={t("地点名称")}
                required
              />
              <select
                value={locationParent}
                onChange={(event) => setLocationParent(event.target.value)}
              >
                <option value="">{t("一级地点")}</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {"　".repeat(location.depth)}
                    {location.name}
                  </option>
                ))}
              </select>
              <button className="primary">{t("添加地点")}</button>
            </form>
          </section>
        )}
        {activePage === "categories" && (
          <section className="panel category-manager">
            <div className="panel-head">
              <div>
                <h2>{t("分类管理")}</h2>
                <p className="muted">{t("新增一级分类或子分类")}</p>
              </div>
            </div>
            <form className="category-form" onSubmit={addCategory}>
              <input
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder={t("分类名称")}
                required
              />
              <select
                value={categoryParent}
                onChange={(event) => setCategoryParent(event.target.value)}
              >
                <option value="">{t("一级分类")}</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {"　".repeat(category.depth)}
                    {category.name}
                  </option>
                ))}
              </select>
              <button className="primary">{t("添加分类")}</button>
            </form>
          </section>
        )}
        {activePage === "shopping" && (
          <section className="shopping-workspace">
            <section className="panel shopping-list">
              <div className="panel-head">
                <div>
                  <h2>{t("采购清单")}</h2>
                  <p className="muted">
                    {selectedShoppingDate
                      ? t("{{date}} 的采购项 · 再次点击日期恢复全部", {
                          date: selectedShoppingDate,
                        })
                      : t("自动建议与手动采购项")}
                  </p>
                </div>
              </div>
              {visibleShoppingItems.length === 0 ? (
                <p className="empty">
                  {selectedShoppingDate
                    ? t("{{date}} 暂无采购项", {
                        date: selectedShoppingDate,
                      })
                    : t("暂无采购项")}
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("采购项")}</th>
                        <th>{t("数量")}</th>
                        <th>{t("采购计划")}</th>
                        <th>{t("预计总价")}</th>
                        <th>{t("操作")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleShoppingItems.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <div className="item-name">
                              <span className="item-icon">
                                <MaterialIcon
                                  value={itemIconFor(
                                    items.find(
                                      (existing) => existing.id === item.itemId,
                                    ) || item,
                                  )}
                                />
                              </span>
                              <span>
                                <strong>{item.name}</strong>
                                <small>
                                  {[
                                    item.category || t("未分类"),
                                    locations.find(
                                      (location) =>
                                        location.id === item.locationId,
                                    )?.name || t("未指定存放地点"),
                                    item.source === "automatic"
                                      ? t("低库存建议")
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </small>
                              </span>
                            </div>
                          </td>
                          <td>
                            {item.quantity}{" "}
                            {displayUnit(item.unit) || t("件")}
                          </td>
                          <td>
                            <span className="shopping-plan">
                              <b>{shoppingChannelName(item)}</b>
                              <small>
                                {item.plannedDate || t("未安排日期")}
                              </small>
                            </span>
                          </td>
                          <td>{item.estimatedTotal==null?"-":formatMoney(item.estimatedTotal,financialSummary?.currency)}</td>
                          <td>
                            <div className="row-actions desktop-row-actions">
                              {!item.completed && (
                                <button
                                  onClick={() => {
                                    setEditShoppingItem(item);
                                    setEditShoppingItemId(item.itemId || "");
                                  }}
                                >
                                  {item.source === "automatic"
                                    ? t("安排")
                                    : t("编辑")}
                                </button>
                              )}
                              {!item.completed && (
                                <button
                                  onClick={() => openShoppingReceipt(item)}
                                >
                                  {t("入库")}
                                </button>
                              )}
                              {item.source === "manual" && (
                                <button
                                  className="danger-action"
                                  onClick={() =>
                                    apiFetch(
                                      `/api/v1/homes/${getHomeId()}/shopping-list/${item.id}`,
                                      { method: "DELETE" },
                                    ).then(load)
                                  }
                                >
                                  {t("删除")}
                                </button>
                              )}
                            </div>
                            <button type="button" className="mobile-action-trigger" onClick={()=>setMobileAction({kind:"shopping",item})}>{t("操作")}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <details className="channel-manager">
                <summary>
                  {t("购买渠道管理")}
                  <span>
                    {shoppingChannels.length} {t("个渠道")}
                  </span>
                </summary>
                <form onSubmit={addShoppingChannel}>
                  <input
                    value={newChannelName}
                    onChange={(event) => setNewChannelName(event.target.value)}
                    maxLength={80}
                    placeholder={t("新增购买渠道")}
                    required
                  />
                  <button className="secondary">{t("添加")}</button>
                </form>
                <div>
                  {shoppingChannels.map((channel) => (
                    <span key={channel.id}>
                      <b>{channel.name}</b>
                      <button
                        type="button"
                        className="channel-remove"
                        title={t("删除渠道")}
                        aria-label={t("删除{{name}}", { name: channel.name })}
                        onClick={() => deleteShoppingChannel(channel)}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </details>
            </section>
            <section className="panel shopping-calendar">
              <div className="panel-head">
                <div>
                  <h2>{t("采购日历")}</h2>
                  <p className="muted">{t("按计划采购日查看物品和购买渠道")}</p>
                </div>
                <div className="calendar-controls">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => moveShoppingMonth(-1)}
                  >
                    <ArrowLeft size={15} />
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setShoppingMonth(new Date().toISOString().slice(0, 7));
                      setSelectedShoppingDate("");
                    }}
                  >
                    {t("今天")}
                  </button>
                  <strong>
                    {t("{{year}} 年 {{month}} 月", {
                      year: calendarYear,
                      month: calendarMonthNumber,
                    })}
                  </strong>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => moveShoppingMonth(1)}
                  >
                    <ArrowRight size={15} />
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={calendarIncludeCompleted}
                      onChange={(event) =>
                        setCalendarIncludeCompleted(event.target.checked)
                      }
                    />
                    {t("显示已完成")}
                  </label>
                </div>
              </div>
              <div className="finance-strip"><span><small>{t("预计支出")}</small><b>{formatMoney(calendarFinancial?.estimatedTotal??0,calendarFinancial?.currency)}</b></span><span><small>{t("实际支出")}</small><b>{formatMoney(calendarFinancial?.spendingTotal??0,calendarFinancial?.currency)}</b></span><span><small>{t("预算差额")}</small><b>{formatMoney(calendarFinancial?.variance??0,calendarFinancial?.currency)}</b></span></div>
              <div className="calendar-wrap">
                <div className="calendar-weekdays">
                  {[
                    t("一"),
                    t("二"),
                    t("三"),
                    t("四"),
                    t("五"),
                    t("六"),
                    t("日"),
                  ].map((day) => (
                    <span key={day}>
                      {t("周")}
                      {day}
                    </span>
                  ))}
                </div>
                <div className="calendar-grid">
                  {calendarCells.map((date, index) => {
                    if (!date)
                      return (
                        <span
                          className="calendar-day empty-day"
                          key={`empty-${index}`}
                        />
                      );
                    const entries = calendarItems.filter(
                        (item) => item.plannedDate === date,
                      ),
                      today = date === new Date().toISOString().slice(0, 10);
                    return (
                      <button
                        type="button"
                        className={`calendar-day ${today ? "today" : ""} ${selectedShoppingDate === date ? "selected" : ""}`}
                        key={date}
                        onClick={() =>
                          setSelectedShoppingDate((current) =>
                            current === date ? "" : date,
                          )
                        }
                      >
                        <time>{Number(date.slice(-2))}</time>
                        <span className="calendar-mobile-count">
                          {entries.length || ""}
                        </span>
                        <div>
                          {entries.slice(0, 2).map((item) => (
                            <span
                              className={item.completed ? "completed" : ""}
                              key={item.id}
                            >
                              <b>{item.name}</b>
                              <small>{shoppingChannelName(item)}</small>
                            </span>
                          ))}
                          {entries.length > 2 && <em>+{entries.length - 2}</em>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          </section>
        )}
        {activePage === "home" && (
          <section className="summary-grid">
            <div className="summary-card">
              <span className="summary-icon">
                <Package size={18} />
              </span>
              <div>
                <span className="summary-label">{t("物资种类")}</span>
                <strong>{items.length}</strong>
                <span className="summary-foot">{t("当前在管物资")}</span>
              </div>
            </div>
            <div className="summary-card warning">
              <span className="summary-icon">
                <TriangleAlert size={18} />
              </span>
              <div>
                <span className="summary-label">{t("需要补充")}</span>
                <strong>{lowStock}</strong>
                <span className="summary-foot">{t("低于最低库存")}</span>
              </div>
            </div>
            <div className="summary-card">
              <span className="summary-icon">
                <CalendarClock size={18} />
              </span>
              <div>
                <span className="summary-label">{t("即将到期")}</span>
                <strong>{expiringItems.length}</strong>
                <span className="summary-foot">{t("未来 30 天")}</span>
              </div>
            </div>
            <div className="summary-card shopping">
              <span className="summary-icon">
                <ShoppingCart size={18} />
              </span>
              <div>
                <span className="summary-label">{t("待采购")}</span>
                <strong>{pendingShoppingCount}</strong>
                <span className="summary-foot">{t("未完成采购项")}</span>
              </div>
            </div>
            <div className="summary-card">
              <span className="summary-icon"><Wallet size={18}/></span>
              <div><span className="summary-label">{t("本月支出")}</span><strong className="money-value">{formatMoney(financialSummary?.spendingTotal??0,financialSummary?.currency)}</strong><span className="summary-foot">{t("实际采购成本")}</span></div>
            </div>
            <div className="summary-card">
              <span className="summary-icon"><Coins size={18}/></span>
              <div><span className="summary-label">{t("库存价值")}</span><strong className="money-value">{formatMoney(financialSummary?.inventoryValue??0,financialSummary?.currency)}</strong><span className="summary-foot">{financialSummary?.unknownBatchCount?t("{{count}} 个批次成本未知",{count:financialSummary.unknownBatchCount}):t("已计价库存")}</span></div>
            </div>
          </section>
        )}
        {activePage === "home" && !logView && (
          <>
            <section className="dashboard-grid">
              <div className="dashboard-main">
                <div className="panel dashboard-inventory">
                  <div className="panel-head">
                    <div>
                      <h2>{t("库存概览")}</h2>
                      <p className="muted">{t("优先显示需要补充的物资")}</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("count")}
                    >
                      {t("查看全部")}
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t("物资")}</th>
                          <th>{t("库存")}</th>
                          <th className="dashboard-minimum">{t("最低库存")}</th>
                          <th>{t("状态")}</th>
                          <th className="dashboard-location">{t("位置")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardItems.map((item) => {
                          const status = displayStatusFor(item);
                          return (
                            <tr key={item.id}>
                              <td>
                                <div className="item-name">
                                  <span className="item-icon">
                                    <MaterialIcon value={itemIconFor(item)} />
                                  </span>
                                  <button type="button" className="item-link" onClick={()=>openItemDetail(item.id)}>{item.name}</button>
                                </div>
                              </td>
                              <td>
                                {balanceFor(item.id)} {displayUnit(item.baseUnit)}
                              </td>
                              <td className="dashboard-minimum">
                                {item.reorderPoint} {displayUnit(item.baseUnit)}
                              </td>
                              <td>
                                <span
                                  className={`stock-status ${status.level}`}
                                >
                                  {status.label}
                                </span>
                              </td>
                              <td className="dashboard-location">
                                {item.locationName || t("未指定")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {dashboardItems.length === 0 && (
                      <p className="empty">{t("暂无物资")}</p>
                    )}
                  </div>
                </div>
                <section className="panel recent-log dashboard-log">
                  <div className="panel-head">
                    <div>
                      <h2>{t("最近变动")}</h2>
                      <p className="muted">{t("按时间倒序的库存流水")}</p>
                    </div>
                  </div>
                  {pagedTransactions.length === 0 ? (
                    <p className="empty">{t("暂无库存变动")}</p>
                  ) : (
                    <div className="log-list">
                      {pagedTransactions.map((transaction) => (
                        <TransactionRow
                          key={transaction.id}
                          transaction={transaction}
                        />
                      ))}
                    </div>
                  )}
                  {transactionPageCount > 1 && (
                    <div className="pagination">
                      <span>
                        {(transactionPage - 1) * 10 + 1}–
                        {Math.min(transactionPage * 10, transactionTotal)}{" "}
                        {t("/ 共")} {transactionTotal} {t("条")}
                      </span>
                      <button
                        type="button"
                        aria-label={t("上一页")}
                        disabled={transactionPage === 1}
                        onClick={() => setTransactionPage(transactionPage - 1)}
                      >
                        <ArrowLeft size={15} />
                      </button>
                      <span>
                        {transactionPage} / {transactionPageCount}
                      </span>
                      <button
                        type="button"
                        aria-label={t("下一页")}
                        disabled={transactionPage === transactionPageCount}
                        onClick={() => setTransactionPage(transactionPage + 1)}
                      >
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </section>
              </div>
              <aside className="dashboard-side">
                <section className="panel dashboard-shopping">
                  <div className="panel-head">
                    <div>
                      <h2>{t("待采购")}</h2>
                      <p className="muted">{t("自动建议与手动采购项")}</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("shopping")}
                    >
                      {t("查看全部")}
                    </button>
                  </div>
                  <div className="dashboard-list">
                    {shoppingItems.length === 0 ? (
                      <p className="empty compact">{t("暂无待采购项")}</p>
                    ) : (
                      shoppingItems.map((item) => (
                        <button
                          type="button"
                          className="dashboard-list-row"
                          key={item.id}
                          onClick={() => navigate("shopping")}
                        >
                          <span>
                            <strong>{item.name}</strong>
                            <small>{item.category || t("未分类")}</small>
                          </span>
                          <b>
                            {item.quantity}{" "}
                            {displayUnit(item.unit) || t("件")}
                          </b>
                        </button>
                      ))
                    )}
                  </div>
                </section>
                <section className="panel dashboard-categories">
                  <div className="panel-head">
                    <div>
                      <h2>{t("分类结构")}</h2>
                      <p className="muted">{t("包含子分类的物资种类")}</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("categories")}
                    >
                      {t("管理")}
                    </button>
                  </div>
                  <div className="category-summary">
                    {categorySummary.map((category) => (
                      <div key={category.id}>
                        <span style={{ paddingLeft: category.depth * 14 }}>
                          {category.name}
                        </span>
                        <strong>{category.count}</strong>
                      </div>
                    ))}
                    {categorySummary.length === 0 && (
                      <p className="empty compact">{t("暂无分类数据")}</p>
                    )}
                  </div>
                </section>
                <section className="panel dashboard-locations">
                  <div className="panel-head">
                    <div>
                      <h2>{t("地点结构")}</h2>
                      <p className="muted">{t("包含子地点的物资种类")}</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("locations")}
                    >
                      {t("管理")}
                    </button>
                  </div>
                  <div className="location-summary">
                    {locationSummary.map((location) => (
                      <div key={location.id}>
                        <span style={{ paddingLeft: location.depth * 14 }}>
                          {location.name}
                        </span>
                        <strong>{location.count}</strong>
                      </div>
                    ))}
                    {locationSummary.length === 0 && (
                      <p className="empty compact">{t("暂无地点数据")}</p>
                    )}
                  </div>
                </section>
              </aside>
            </section>
          </>
        )}
        {!countView && !logView && activePage === "count" && (
          <section className="count-workspace">
            <div className="count-summary" aria-label={t("库存状态概览")}>
              <button
                className={!stockStatusFilter && !expiryFilter ? "active" : ""}
                onClick={() => {
                  setStockStatusFilter("");
                  setExpiryFilter("");
                }}
              >
                <span className="count-summary-copy">
                  <b>{t("全部物资")}</b>
                  <small>{t("当前在管物资")}</small>
                </span>
                <strong>{items.length}</strong>
              </button>
              <button
                className={stockStatusFilter === "empty" ? "active warning" : ""}
                onClick={() => {
                  setStockStatusFilter("empty");
                  setExpiryFilter("");
                }}
              >
                <span className="count-summary-copy">
                  <b>{t("缺货")}</b>
                  <small>{t("库存为 0，无补货要求")}</small>
                </span>
                <strong>{emptyStockCount}</strong>
              </button>
              <button
                className={
                  stockStatusFilter === "replenishment" ? "active danger" : ""
                }
                onClick={() => {
                  setStockStatusFilter("replenishment");
                  setExpiryFilter("");
                }}
              >
                <span className="count-summary-copy">
                  <b>{t("不足")}</b>
                  <small>{t("低于最低库存")}</small>
                </span>
                <strong>{belowStockCount}</strong>
              </button>
              <button
                className={
                  stockStatusFilter === "warning" ? "active warning" : ""
                }
                onClick={() => {
                  setStockStatusFilter("warning");
                  setExpiryFilter("");
                }}
              >
                <span className="count-summary-copy">
                  <b>{t("临界")}</b>
                  <small>{t("等于最低库存")}</small>
                </span>
                <strong>{criticalStockCount}</strong>
              </button>
              <button
                className={expiryFilter === "expiring" ? "active" : ""}
                onClick={() => {
                  setStockStatusFilter("");
                  setExpiryFilter("expiring");
                }}
              >
                <span className="count-summary-copy">
                  <b>{t("临期")}</b>
                  <small>{t("未来 30 天到期")}</small>
                </span>
                <strong>{expiringItems.length}</strong>
              </button>
            </div>
            <div className="panel inventory-panel count-inventory">
              <div className="panel-head">
                <div>
                  <h2>{t("库存明细")}</h2>
                  <p className="muted">
                    {t("按紧急程度排序，共")}
                    {filtered.length} {t("项")}
                  </p>
                </div>
                <label className="search count-search">
                  <Search size={16} strokeWidth={1.8} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("搜索物资")}
                  />
                </label>
              </div>
              <div className="count-filters">
                <SlidersHorizontal size={15} strokeWidth={1.8} />
                <label>
                  {t("分类")}
                  <select
                    value={categoryFilter}
                    onChange={(event) => setCategoryFilter(event.target.value)}
                  >
                    <option value="">{t("全部分类")}</option>
                    {categoryOptions.map((category) => (
                      <option key={category.id} value={category.name}>
                        {"　".repeat(category.depth)}
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("地点")}
                  <select
                    value={locationFilter}
                    onChange={(event) => setLocationFilter(event.target.value)}
                  >
                    <option value="">{t("全部地点")}</option>
                    {locationOptions.map((location) => (
                      <option key={location.id} value={location.id}>
                        {"　".repeat(location.depth)}
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("库存状态")}
                  <select
                    value={stockStatusFilter}
                    onChange={(event) =>
                      setStockStatusFilter(event.target.value)
                    }
                  >
                    <option value="">{t("全部状态")}</option>
                    <option value="empty">{t("缺货")}</option>
                    <option value="replenishment">{t("不足")}</option>
                    <option value="warning">{t("临界")}</option>
                    <option value="normal">{t("正常")}</option>
                  </select>
                </label>
                <label>
                  {t("到期状态")}
                  <select
                    value={expiryFilter}
                    onChange={(event) => setExpiryFilter(event.target.value)}
                  >
                    <option value="">{t("全部")}</option>
                    <option value="expired">{t("过期")}</option>
                    <option value="expiring">{t("临期")}</option>
                    <option value="valid">{t("有效")}</option>
                    <option value="none">{t("未设")}</option>
                  </select>
                </label>
                {(query ||
                  categoryFilter ||
                  locationFilter ||
                  stockStatusFilter ||
                  expiryFilter) && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setQuery("");
                      setCategoryFilter("");
                      setLocationFilter("");
                      setStockStatusFilter("");
                      setExpiryFilter("");
                    }}
                  >
                    {t("重置")}
                  </button>
                )}
              </div>
              <div className="table-wrap count-table-wrap">
                <table className="count-table">
                  <thead>
                    <tr>
                      <th>{t("物资")}</th>
                      <th>{t("当前库存")}</th>
                      <th>{t("最低库存")}</th>
                      <th>{t("补充建议")}</th>
                      <th>{t("状态")}</th>
                      <th>{t("存放地点")}</th>
                      <th>{t("日期")}</th>
                      <th>{t("最近单价")}</th>
                      <th>{t("操作")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="empty">
                          {t("没有符合当前条件的物资。")}
                        </td>
                      </tr>
                    ) : (
                      pagedItems.map((item) => {
                        const stockStatus = displayStatusFor(item);
                        const replenishment = replenishmentFor(item);
                        return (
                          <tr key={`${item.id}:${item.locationId??"none"}`}>
                            <td>
                              <div className="item-name">
                                <span className="item-icon">
                                  <MaterialIcon value={itemIconFor(item)} />
                                </span>
                                <div>
                                  <button type="button" className="item-link" onClick={()=>openItemDetail(item.id)}>{item.name}</button>
                                  <span>{item.category || t("未分类")}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <strong>
                                {item.treeQuantity ?? balanceFor(item.id)}{" "}
                                {displayUnit(item.baseUnit)}
                              </strong>
                            </td>
                            <td>
                              {item.reorderPoint} {displayUnit(item.baseUnit)}
                            </td>
                            <td
                              className={
                                replenishment > 0
                                  ? "replenishment"
                                  : "muted-cell"
                              }
                            >
                              {replenishment > 0
                                ? `${replenishment} ${displayUnit(item.baseUnit)}`
                                : "—"}
                            </td>
                            <td>
                              <span
                                className={`stock-status ${stockStatus.level}`}
                              >
                                {stockStatus.label}
                              </span>
                            </td>
                            <td>{item.locationName || t("未指定")}</td>
                            <td>
                              <div className="date-cell">
                                <span>
                                  {t("生产")}
                                  {item.manufacturedDate || "—"}
                                </span>
                                <span>
                                  {t("到期")}
                                  {item.expiryDate || "—"}
                                </span>
                              </div>
                            </td>
                            <td>{item.lastUnitPrice==null?"-":<div className="date-cell"><span>{formatMoney(item.lastUnitPrice,item.currency??financialSummary?.currency)}</span><span>{t("价值 {{amount}}",{amount:formatMoney((item.treeQuantity??balanceFor(item.id))*item.lastUnitPrice,item.currency??financialSummary?.currency)})}</span></div>}</td>
                            <td>
                              <div className="row-actions desktop-row-actions">
                                <button
                                  onClick={() =>
                                    openStockAction("receipt", item)
                                  }
                                >
                                  {t("入库")}
                                </button>
                                <button
                                  onClick={() => openStockAction("issue", item)}
                                >
                                  {t("领用")}
                                </button>
                                <button onClick={() => setBatchItem(item)}>
                                  {t("批次")}
                                </button>
                                <button
                                  onClick={() =>
                                    setDetailItem(
                                      items.find(
                                        (current) => current.id === item.id,
                                      ) ?? item,
                                    )
                                  }
                                >
                                  {t("编辑")}
                                </button>
                                <button
                                  className="danger-action"
                                  onClick={() => confirmDelete("item", item)}
                                >
                                  {t("删除")}
                                </button>
                              </div>
                              <button type="button" className="mobile-action-trigger" onClick={()=>setMobileAction({kind:"inventory",item})}>{t("操作")}</button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {filtered.length > 0 && (
                <div className="pagination">
                  <span>
                    {pageStart}–{pageEnd} {t("/ 共")}
                    {filtered.length} {t("项")}
                  </span>
                  <button
                    type="button"
                    aria-label={t("上一页")}
                    title={t("上一页")}
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ArrowLeft size={15} />
                  </button>
                  <span>
                    {page} / {pageCount}
                  </span>
                  <button
                    type="button"
                    aria-label={t("下一页")}
                    title={t("下一页")}
                    disabled={page === pageCount}
                    onClick={() => setPage(page + 1)}
                  >
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
        {activePage === "count" && !logView && (
          <section className="panel recent-log">
            <div className="panel-head">
              <div>
                <h2>{t("最近变动")}</h2>
                <p className="muted">{t("按时间倒序的库存流水")}</p>
              </div>
            </div>
            {pagedTransactions.length === 0 ? (
              <p className="empty">{t("暂无库存变动")}</p>
            ) : (
              <div className="log-list">
                {pagedTransactions.map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                  />
                ))}
              </div>
            )}
            {transactionPageCount > 1 && (
              <div className="pagination">
                <span>
                  {(transactionPage - 1) * 10 + 1}–
                  {Math.min(transactionPage * 10, transactionTotal)} {t("/ 共")}{" "}
                  {transactionTotal} {t("条")}
                </span>
                <button
                  type="button"
                  aria-label={t("上一页")}
                  disabled={transactionPage === 1}
                  onClick={() => setTransactionPage(transactionPage - 1)}
                >
                  <ArrowLeft size={15} />
                </button>
                <span>
                  {transactionPage} / {transactionPageCount}
                </span>
                <button
                  type="button"
                  aria-label={t("下一页")}
                  disabled={transactionPage === transactionPageCount}
                  onClick={() => setTransactionPage(transactionPage + 1)}
                >
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
          </section>
        )}
        {countView && (
          <section className="panel count-panel inventory-tree">
            <div className="panel-head">
              <div>
                <h2>{treeMode === "location" ? t("地点") : t("分类")}</h2>
                <p className="muted">{t("展开节点查看库存与状态")}</p>
              </div>
              <div className="panel-tools">
                <button
                  className="text-button"
                  onClick={() => navigate("count")}
                >
                  {t("返回盘点")}
                </button>
              </div>
            </div>
            {treeNodes
              .filter((node) => !node.parentId)
              .map((node) => renderTreeNode(node))}
            {treeNodes.length === 0 && <p className="empty">{t("暂无节点")}</p>}
          </section>
        )}
        {logView && (
          <section className="panel full-log">
            <div className="panel-head">
              <div>
                <h2>{t("完整变动日志")}</h2>
                <p className="muted">{t("按时间倒序记录库存变动")}</p>
              </div>
              <button className="text-button" onClick={() => setLogView(false)}>
                {t("返回总览")}
              </button>
            </div>
            <div className="log-list">
              {transactions.length === 0 ? (
                <p className="empty">{t("暂无库存变动")}</p>
              ) : (
                transactions.map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                  />
                ))
              )}
            </div>
          </section>
        )}
        </div>
      </main>
      {mobileAction&&<div className="modal-backdrop mobile-action-backdrop" onMouseDown={event=>event.target===event.currentTarget&&setMobileAction(null)}><section className="mobile-action-sheet" role="dialog" aria-modal="true"><div className="modal-head"><div><h2>{mobileAction.item.name}</h2><p className="muted">{t("选择操作")}</p></div><button type="button" className="close" aria-label={t("关闭")} onClick={()=>setMobileAction(null)}><X size={18}/></button></div><div className="mobile-action-list">{mobileAction.kind==="shopping"?<><button type="button" onClick={()=>{setEditShoppingItem(mobileAction.item);setEditShoppingItemId(mobileAction.item.itemId||"");setMobileAction(null);}}>{mobileAction.item.source==="automatic"?t("安排"):t("编辑")}</button><button type="button" onClick={()=>{openShoppingReceipt(mobileAction.item);setMobileAction(null);}}>{t("入库")}</button>{mobileAction.item.source==="manual"&&<button type="button" className="danger-action" onClick={()=>{const item=mobileAction.item;setMobileAction(null);void apiFetch(`/api/v1/homes/${getHomeId()}/shopping-list/${item.id}`,{method:"DELETE"}).then(load);}}>{t("删除")}</button>}</>:<><button type="button" onClick={()=>{openStockAction("receipt",mobileAction.item);setMobileAction(null);}}>{t("入库")}</button><button type="button" onClick={()=>{openStockAction("issue",mobileAction.item);setMobileAction(null);}}>{t("领用")}</button><button type="button" onClick={()=>{setBatchItem(mobileAction.item);setMobileAction(null);}}>{t("批次")}</button><button type="button" onClick={()=>{setDetailItem(items.find(item=>item.id===mobileAction.item.id)??mobileAction.item);setMobileAction(null);}}>{t("编辑")}</button><button type="button" className="danger-action" onClick={()=>{confirmDelete("item",mobileAction.item);setMobileAction(null);}}>{t("删除")}</button></>}</div></section></div>}
      {deleteTarget && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting)
              setDeleteTarget(null);
          }}
        >
          <form
            className="modal delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onSubmit={deleteSelected}
          >
            <div className="modal-head">
              <h2 id="delete-title">
                {deleteTarget.kind === "item"
                  ? t("删除物资")
                  : deleteTarget.kind === "category"
                    ? t("删除分类")
                    : t("删除地点")}
              </h2>
              <button
                type="button"
                className="close"
                disabled={deleting}
                aria-label={t("关闭")}
                onClick={() => setDeleteTarget(null)}
              >
                <X size={18} />
              </button>
            </div>
            <strong>{deleteTarget.name}</strong>
            <p>{deleteTarget.message}</p>
            {deleteError && (
              <p className="setup-error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="delete-dialog-actions">
              <button
                type="button"
                className="secondary"
                autoFocus
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                {t("取消")}
              </button>
              <button className="primary danger-button" disabled={deleting}>
                {deleting ? t("删除中…") : t("确认删除")}
              </button>
            </div>
          </form>
        </div>
      )}
      {detailItem && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setDetailItem(null)
          }
        >
          <form className="modal" onSubmit={updateItem}>
            <div className="modal-head">
              <div>
                <h2>{t("编辑物资")}</h2>
                <p className="muted">{detailItem.name}</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => setDetailItem(null)}
                aria-label={t("关闭")}
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>
            <label>
              {t("物资名称")}
              <input name="name" required defaultValue={detailItem.name} />
            </label>
            <label>
              {t("商品条码（可选）")}
              <input
                name="barcode"
                inputMode="numeric"
                pattern="[0-9]{8,14}"
                defaultValue={detailItem.barcode || ""}
              />
            </label>
            <label>
              {t("类型")}
              <select name="category" defaultValue={detailItem.category}>
                {selectCategoryOptions.map((category) => (
                  <option key={category.id} value={category.name}>
                    {"　".repeat(category.depth)}
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                {t("当前库存（只读）")}
                <input value={balanceFor(detailItem.id)} readOnly />
                <small className="form-hint">
                  {t("请通过入库、领用或盘点调整库存")}
                </small>
              </label>
              <label>
                {t("单位")}
                <select
                  name="baseUnit"
                  required
                  defaultValue={detailItem.baseUnit}
                >
                  <option value="个">{t("个")}</option>
                  <option value="瓶">{t("瓶")}</option>
                  <option value="盒">{t("盒")}</option>
                  <option value="包">{t("包")}</option>
                  <option value="箱">{t("箱")}</option>
                  <option value="袋">{t("袋")}</option>
                  <option value="克">{t("克")}</option>
                  <option value="市斤">{t("市斤")}</option>
                  <option value="千克">{t("千克")}</option>
                  <option value="升">{t("升")}</option>
                  <option value="米">{t("米")}</option>
                  <option value="其他">{t("其他")}</option>
                </select>
                <small className="form-hint">
                  {t("已有库存流水后不可更改单位")}
                </small>
              </label>
              <label>
                {t("最低库存")}
                <input
                  name="reorderPoint"
                  type="number"
                  min="0"
                  step="any"
                  defaultValue={detailItem.reorderPoint}
                />
              </label>
            </div>
            <label>
              {t("存放地点")}
              <select
                name="locationId"
                defaultValue={detailItem.locationId || ""}
              >
                <option value="">{t("暂不指定")}</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {"　".repeat(location.depth)}
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <IconPicker initial={detailItem.icon} />
            <div className="edit-item-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setBatchItem(detailItem);
                  setDetailItem(null);
                }}
              >
                {t("管理库存批次")}
              </button>
              <button className="primary">{t("保存修改")}</button>
            </div>
          </form>
        </div>
      )}
      {editTreeNode && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setEditTreeNode(null)
          }
        >
          <form className="modal" onSubmit={updateTreeNode}>
            <div className="modal-head">
              <div>
                <h2>
                  {t("编辑")}
                  {editTreeNode.kind === "location" ? t("地点") : t("分类")}
                </h2>
                <p className="muted">{t("调整名称或父级")}</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => setEditTreeNode(null)}
                aria-label={t("关闭")}
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>
            <label>
              {t("名称")}
              <input name="name" required defaultValue={editTreeNode.name} />
            </label>
            <label>
              {t("父级")}
              <select
                name="parentId"
                defaultValue={editTreeNode.parentId || ""}
              >
                <option value="">
                  {t("一级")}
                  {editTreeNode.kind === "location" ? t("地点") : t("分类")}
                </option>
                {(editTreeNode.kind === "location"
                  ? locationOptions
                  : categoryOptions
                )
                  .filter((node) => node.id !== editTreeNode.id)
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {"　".repeat(node.depth)}
                      {node.name}
                    </option>
                  ))}
              </select>
            </label>
            <button className="primary full">{t("保存修改")}</button>
          </form>
        </div>
      )}
      {batchItem && (
        <Batches
          homeId={getHomeId()}
          item={batchItem}
          onClose={() => setBatchItem(null)}
          onChange={load}
        />
      )}
      {stockAction && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setStockAction(null)
          }
        >
          <form className="modal" onSubmit={recordStock}>
            <div className="modal-head">
              <div>
                <h2>
                  {stockAction.type === "receipt"
                    ? t("入库物资")
                    : t("领用物资")}
                </h2>
                <p className="muted">{stockAction.item.name}</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => setStockAction(null)}
                aria-label={t("关闭")}
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>
            <label>
              {t("存放地点")}
              <select
                name="locationId"
                value={stockLocationId}
                onChange={(event) => setStockLocationId(event.target.value)}
              >
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {"　".repeat(location.depth)}
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            {stockAction.type === "receipt" ? (
              <BatchFields title={t("新入库批次（可选）")} />
            ) : stockLocationId ? (
              <BatchSelect
                homeId={getHomeId()}
                itemId={stockAction.item.id}
                locationId={stockLocationId}
              />
            ) : null}
            {stockAction.type==="receipt"&&<fieldset className="purchase-cost"><legend>{t("采购成本（可选）")}</legend><div className="form-row"><label>{t("实付总价")}<input name="totalPrice" type="number" min="0" step="0.01" placeholder="0.00"/></label><label>{t("采购日期")}<input name="purchaseDate" type="date" defaultValue={new Date().toISOString().slice(0,10)}/></label><label>{t("购买渠道")}<select name="channelId" defaultValue=""><option value="">{t("未指定")}</option>{shoppingChannels.map(channel=><option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label></div></fieldset>}
            <label>
              {t("数量")}
              <input
                name="quantity"
                type="number"
                min="0"
                step="any"
                defaultValue="1"
                autoFocus
                required
              />
            </label>
            <label>
              {t("备注（可选）")}
              <input name="reason" placeholder={t("例如：本周采购")} />
            </label>
            <button className="primary full" disabled={busy}>
              {busy
                ? t("处理中…")
                : t("确认{{action}}", {
                    action:
                      stockAction.type === "receipt" ? t("入库") : t("领用"),
                  })}
            </button>
          </form>
        </div>
      )}
      {showShoppingForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget &&
            (setShowShoppingForm(false), setShoppingItemId(""))
          }
        >
          <form className="modal" onSubmit={addShoppingItem}>
            <div className="modal-head">
              <div>
                <h2>{t("添加采购项")}</h2>
                <p className="muted">{t("手动加入采购清单")}</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => {
                  setShowShoppingForm(false);
                  setShoppingItemId("");
                }}
                aria-label={t("关闭")}
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>
            <label>
              {t("名称")}
              <input
                key={`shopping-name-${shoppingItemId}`}
                name="name"
                required
                defaultValue={linkedShoppingItem?.name || ""}
                placeholder={t("例如：纸巾")}
                disabled={Boolean(linkedShoppingItem)}
              />
            </label>
            <ItemCombobox
              items={items}
              value={shoppingItemId}
              onChange={setShoppingItemId}
            />
            <div className="form-row">
              <label>
                {t("数量")}
                <input
                  name="quantity"
                  type="number"
                  min="0"
                  step="any"
                  defaultValue="1"
                />
              </label>
              <label>
                {t("单位")}
                <select
                  key={`shopping-unit-${shoppingItemId}`}
                  name="unit"
                  defaultValue={linkedShoppingItem?.baseUnit || "个"}
                  disabled={Boolean(linkedShoppingItem)}
                >
                  <option value="个">{t("个")}</option>
                  <option value="瓶">{t("瓶")}</option>
                  <option value="盒">{t("盒")}</option>
                  <option value="包">{t("包")}</option>
                  <option value="箱">{t("箱")}</option>
                  <option value="袋">{t("袋")}</option>
                  <option value="克">{t("克")}</option>
                  <option value="市斤">{t("市斤")}</option>
                  <option value="千克">{t("千克")}</option>
                  <option value="升">{t("升")}</option>
                  <option value="米">{t("米")}</option>
                  <option value="其他">{t("其他")}</option>
                </select>
              </label>
            </div>
            <label>
              {t("种类")}
              <select
                key={`shopping-category-${shoppingItemId}`}
                name="category"
                defaultValue={linkedShoppingItem?.category || "其他"}
                disabled={Boolean(linkedShoppingItem)}
              >
                {selectCategoryOptions.map((category) => (
                  <option key={category.id} value={category.name}>
                    {"　".repeat(category.depth)}
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("存放地点")}
              <select
                key={`shopping-location-${shoppingItemId}-${locationOptions[0]?.id ?? ""}`}
                name="locationId"
                defaultValue={
                  linkedShoppingItem?.locationId || locationOptions[0]?.id || ""
                }
                disabled={Boolean(linkedShoppingItem)}
              >
                <option value="">{t("暂不指定")}</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {"　".repeat(location.depth)}
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                {t("购买渠道")}
                <select name="channelId" defaultValue="">
                  <option value="">{t("未安排")}</option>
                  {shoppingChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("计划采购日")}
                <input name="plannedDate" type="date" />
              </label>
              <label>{t("预计总价")}<input name="estimatedTotal" type="number" min="0" step="0.01" placeholder="0.00"/></label>
            </div>
            <button className="primary full">{t("加入采购清单")}</button>
          </form>
        </div>
      )}
      {editShoppingItem && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget &&
            (setEditShoppingItem(null), setEditShoppingItemId(""))
          }
        >
          <form className="modal" onSubmit={updateShoppingItem}>
            <div className="modal-head">
              <div>
                <h2>{t("编辑采购项")}</h2>
                <p className="muted">{t("修改采购数量和入库信息")}</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => {
                  setEditShoppingItem(null);
                  setEditShoppingItemId("");
                }}
                aria-label={t("关闭")}
              >
                <X size={18} />
              </button>
            </div>
            <label>
              {t("名称")}
              <input
                key={`edit-shopping-name-${editShoppingItemId}`}
                name="name"
                required
                defaultValue={
                  linkedEditShoppingItem?.name || editShoppingItem.name
                }
                disabled={Boolean(linkedEditShoppingItem)}
              />
            </label>
            <ItemCombobox
              items={items}
              value={editShoppingItemId}
              onChange={setEditShoppingItemId}
            />
            <div className="form-row">
              <label>
                {t("数量")}
                <input
                  name="quantity"
                  type="number"
                  min="0"
                  step="any"
                  defaultValue={editShoppingItem.quantity}
                />
              </label>
              <label>
                {t("单位")}
                <select
                  key={`edit-shopping-unit-${editShoppingItemId}`}
                  name="unit"
                  defaultValue={
                    linkedEditShoppingItem?.baseUnit ||
                    editShoppingItem.unit ||
                    "个"
                  }
                  disabled={Boolean(linkedEditShoppingItem)}
                >
                  <option value="个">{t("个")}</option>
                  <option value="瓶">{t("瓶")}</option>
                  <option value="盒">{t("盒")}</option>
                  <option value="包">{t("包")}</option>
                  <option value="箱">{t("箱")}</option>
                  <option value="袋">{t("袋")}</option>
                  <option value="克">{t("克")}</option>
                  <option value="市斤">{t("市斤")}</option>
                  <option value="千克">{t("千克")}</option>
                  <option value="升">{t("升")}</option>
                  <option value="米">{t("米")}</option>
                  <option value="其他">{t("其他")}</option>
                </select>
              </label>
            </div>
            <label>
              {t("种类")}
              <select
                key={`edit-shopping-category-${editShoppingItemId}`}
                name="category"
                defaultValue={
                  linkedEditShoppingItem?.category ||
                  editShoppingItem.category ||
                  "其他"
                }
                disabled={Boolean(linkedEditShoppingItem)}
              >
                {selectCategoryOptions.map((category) => (
                  <option key={category.id} value={category.name}>
                    {"　".repeat(category.depth)}
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("存放地点")}
              <select
                key={`edit-shopping-location-${editShoppingItemId}`}
                name="locationId"
                defaultValue={
                  linkedEditShoppingItem?.locationId ||
                  editShoppingItem.locationId ||
                  ""
                }
                disabled={Boolean(linkedEditShoppingItem)}
              >
                <option value="">{t("暂不指定")}</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {"　".repeat(location.depth)}
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                {t("购买渠道")}
                <select
                  name="channelId"
                  defaultValue={editShoppingItem.channelId || ""}
                >
                  <option value="">{t("未安排")}</option>
                  {shoppingChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("计划采购日")}
                <input
                  name="plannedDate"
                  type="date"
                  defaultValue={editShoppingItem.plannedDate || ""}
                />
              </label>
              <label>{t("预计总价")}<input name="estimatedTotal" type="number" min="0" step="0.01" defaultValue={editShoppingItem.estimatedTotal??""} placeholder="0.00"/></label>
            </div>
            <button className="primary full">{t("保存修改")}</button>
          </form>
        </div>
      )}
      {receiveShoppingItem && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setReceiveShoppingItem(null)
          }
        >
          <form className="modal" onSubmit={receiveShopping}>
            <div className="modal-head">
              <div>
                <h2>{t("采购入库")}</h2>
                <p className="muted">
                  {receiveShoppingItem.name} {t("· 建议")}{" "}
                  {receiveShoppingItem.quantity}{" "}
                  {displayUnit(receiveShoppingItem.unit) || t("件")}
                </p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => setReceiveShoppingItem(null)}
                aria-label={t("关闭")}
              >
                <X size={18} />
              </button>
            </div>
            <label>
              {t("实际入库数量")}
              <input
                name="quantity"
                type="number"
                min="0"
                step="any"
                defaultValue={receiveShoppingItem.quantity}
                autoFocus
                required
              />
            </label>
            <label>
              {t("入库地点")}
              <select
                name="locationId"
                defaultValue={
                  items.find((item) => item.id === receiveShoppingItem.itemId)
                    ?.locationId ||
                  receiveShoppingItem.locationId ||
                  locations[0]?.id ||
                  ""
                }
                required
              >
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {"　".repeat(location.depth)}
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row"><label>{t("实付总价")}<input name="totalPrice" type="number" min="0" step="0.01" defaultValue={receiveShoppingItem.estimatedTotal??""} placeholder="0.00"/></label><label>{t("采购日期")}<input name="purchaseDate" type="date" defaultValue={new Date().toISOString().slice(0,10)}/></label></div>
            <BatchFields title={t("采购入库批次（可选）")} />
            <button className="primary full" disabled={busy}>
              {busy ? t("入库中…") : t("确认入库")}
            </button>
          </form>
        </div>
      )}
      {showForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && closeItemForm()
          }
        >
          <form
            className="modal item-form-modal"
            key={itemFormRevision}
            onSubmit={addItem}
          >
            <div className="modal-head">
              <div>
                <h2>{t("添加物资")}</h2>
                <p className="muted">{t("登记名称、当前库存和补充规则")}</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={closeItemForm}
                aria-label={t("关闭")}
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>
            <div className="barcode-lookup">
              <label>
                {t("商品条码（可选）")}
                <input
                  name="barcode"
                  inputMode="numeric"
                  pattern="[0-9]{8,14}"
                  value={barcodeInput}
                  onChange={(event) => setBarcodeInput(event.target.value)}
                  placeholder={t("输入 EAN / UPC / GTIN")}
                />
              </label>
              <div>
                <button
                  type="button"
                  className="secondary"
                  disabled={barcodeBusy || !barcodeInput}
                  onClick={() => lookupItemBarcode()}
                >
                  {barcodeBusy ? t("查询中…") : t("查询")}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowBarcodeScanner(true)}
                >
                  {t("摄像头扫描")}
                </button>
              </div>
            </div>
            <label>
              {t("物资名称")}
              <input
                name="name"
                required
                defaultValue={prefillName}
                placeholder={t("例如：洗衣液")}
              />
            </label>
            <label>
              {t("类型")}
              <select
                name="category"
                defaultValue={prefillCategory || "其他"}
              >
                {selectCategoryOptions.map((category) => (
                  <option key={category.id} value={category.name}>
                    {"　".repeat(category.depth)}
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                {t("单位")}
                <select name="baseUnit" defaultValue={prefillUnit}>
                  <option value="个">{t("个")}</option>
                  <option value="瓶">{t("瓶")}</option>
                  <option value="盒">{t("盒")}</option>
                  <option value="包">{t("包")}</option>
                  <option value="箱">{t("箱")}</option>
                  <option value="袋">{t("袋")}</option>
                  <option value="克">{t("克")}</option>
                  <option value="市斤">{t("市斤")}</option>
                  <option value="千克">{t("千克")}</option>
                  <option value="升">{t("升")}</option>
                  <option value="米">{t("米")}</option>
                  <option value="其他">{t("其他")}</option>
                </select>
              </label>
              <label>
                {t("库存")}
                <input
                  name="initialStock"
                  type="number"
                  min="0"
                  step="any"
                  defaultValue="0"
                />
              </label>
            </div>
            <label>
              {t("最低库存")}
              <input
                name="reorderPoint"
                type="number"
                min="0"
                step="any"
                defaultValue="0"
              />
            </label>
            <BatchFields title={t("初始库存批次（可选）")} />
            <fieldset className="purchase-cost"><legend>{t("初始库存成本（可选）")}</legend><div className="form-row"><label>{t("实付总价")}<input name="totalPrice" type="number" min="0" step="0.01" placeholder="0.00"/></label><label>{t("采购日期")}<input name="purchaseDate" type="date" defaultValue={new Date().toISOString().slice(0,10)}/></label><label>{t("购买渠道")}<select name="channelId" defaultValue=""><option value="">{t("未指定")}</option>{shoppingChannels.map(channel=><option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label></div></fieldset>
            <label>
              {t("存放地点")}
              <select
                name="locationId"
                defaultValue={prefillLocationId || locations[0]?.id || ""}
              >
                <option value="">{t("暂不指定")}</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {"　".repeat(location.depth)}
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <IconPicker />
            <button className="primary full" disabled={busy}>
              {busy ? t("保存中…") : t("保存物资")}
            </button>
          </form>
        </div>
      )}
      {showBarcodeScanner && (
        <BarcodeScanner
          onClose={() => setShowBarcodeScanner(false)}
          onScan={(barcode) => {
            setShowBarcodeScanner(false);
            setBarcodeInput(barcode);
            void lookupItemBarcode(barcode);
          }}
        />
      )}
    </div>
  );
}
