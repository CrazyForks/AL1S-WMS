import { MaterialIcon, IconPicker, itemIconFor } from "./Icons.js";
import { BatchFields } from "./BatchFields.js";
import { Batches, BatchSelect } from "./Batches.js";
import { type CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Package,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  TriangleAlert,
  Trash2,
  X,
} from "lucide-react";

const pagePaths = { home: "/", count: "/count", shopping: "/shopping", locations: "/locations", categories: "/categories", profile: "/profile" } as const;
type Page = keyof typeof pagePaths;
function pageFromUrl(): Page {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return (Object.keys(pagePaths) as Page[]).find(page => pagePaths[page] === path) ?? "home";
}

type Item = {
  icon?: string | null;
  id: string;
  homeId: string;
  sku: string;
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
};
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
type TransactionPage = {items:Transaction[];total:number;limit:number;offset:number;hasMore:boolean;nextOffset:number|null;snapshotAt:string};
function TransactionRow({ transaction }: { transaction: Transaction }) {
  const labels = { receipt: "入库", issue: "领用", delete: "删除", reclassify: "分类变更", move: "位置变更", update: "批次变更" };
  const stockChange = transaction.type === "receipt" || transaction.type === "issue";
  return <div className="log-row">
    <span className={`log-badge ${transaction.type}`} title={labels[transaction.type]}>
      {transaction.type === "delete" ? <Trash2 size={14} /> : stockChange ? (transaction.type === "receipt" ? "+" : "−") : <ArrowRight size={14} />}
    </span>
    <div><strong>{transaction.itemName}</strong><small>{[transaction.locationName, transaction.reason || labels[transaction.type]].filter(Boolean).join(" · ")}</small></div>
    <b className={transaction.type}>{stockChange ? `${transaction.type === "receipt" ? "+" : "−"}${transaction.quantity}` : labels[transaction.type]}</b>
    <time>{new Date(transaction.occurredAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
  </div>;
}
type ShoppingItem = {
  id: string;
  itemId?: string | null;
  name: string;
  quantity: number;
  unit?: string | null;
  category?: string | null;
  locationId?: string | null;
  source: "manual" | "automatic";
  completed: number;
};
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
>(
  nodes: T[],
  items: Item[],
  matches: (item: Item, node: T) => boolean,
) {
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
  localStorage.getItem("family-erp-home-id") ?? fallbackHomeId;
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
async function getItems() {
  const response = await fetch(`/api/v1/homes/${getHomeId()}/items`);
  if (!response.ok) throw new Error("无法加载物资");
  return response.json() as Promise<Item[]>;
}
async function getStock() {
  const response = await fetch(`/api/v1/homes/${getHomeId()}/stock`);
  if (!response.ok) throw new Error("无法加载库存");
  return response.json() as Promise<Stock[]>;
}
async function getLocations() {
  const response = await fetch(`/api/v1/homes/${getHomeId()}/locations`);
  if (!response.ok) throw new Error("无法加载地点");
  return response.json() as Promise<Location[]>;
}
async function getTransactions(page = 1, snapshotAt = "") {
  const response = await fetch(`/api/v1/homes/${getHomeId()}/transactions?limit=10&offset=${(page-1)*10}${snapshotAt?`&snapshotAt=${encodeURIComponent(snapshotAt)}`:""}`);
  if (!response.ok) throw new Error("无法加载变动记录");
  return response.json() as Promise<TransactionPage>;
}
async function getShoppingList() {
  const response = await fetch(`/api/v1/homes/${getHomeId()}/shopping-list`);
  if (!response.ok) throw new Error("无法加载采购清单");
  return response.json() as Promise<ShoppingItem[]>;
}
async function getCategories() {
  const response = await fetch(`/api/v1/homes/${getHomeId()}/categories`);
  if (!response.ok) throw new Error("无法加载物资类型");
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
    const response = await fetch("/api/v1/setup", {
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
      setError(data.message ?? "初始化失败，请检查输入");
      return;
    }
    localStorage.setItem("family-erp-home-id", data.home.id);
    localStorage.setItem("family-erp-home-emoji", homeEmoji);
    onComplete(data.home);
  };
  return (
    <div className="setup-shell">
      <div className="setup-card">
        <div className="setup-brand">
          <span className="brand-mark" role="img" aria-label="家庭">
            <MaterialIcon value={homeEmoji} home size={24} />
          </span>
          <div>
            <strong>AL1S-ERP</strong>
            <span>首次启动设置</span>
          </div>
        </div>
        <div className="setup-progress">
          <span className={step >= 1 ? "active" : ""}>1 账号</span>
          <i />
          <span className={step >= 2 ? "active" : ""}>2 家庭</span>
          <i />
          <span className={step >= 3 ? "active" : ""}>3 地点</span>
        </div>
        {step === 1 && (
          <div className="setup-step">
            <p className="eyebrow">建立本地管理员</p>
            <h1>先创建你的账号</h1>
            <p className="muted">
              账号只保存在这台 AL1S-ERP 中，用于管理成员和敏感操作。
            </p>
            <label>
              用户名
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoFocus
              />
            </label>
            <label>
              密码
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
            <p className="eyebrow">建立你的 Home</p>
            <h1>这个家庭怎么称呼？</h1>
            <p className="muted">Home 是物资、成员、地点和预算的共同边界。</p>
            <label>
              家庭名称
              <input
                value={homeName}
                onChange={(event) => setHomeName(event.target.value)}
                placeholder="例如：我们家"
                autoFocus
              />
            </label>
            <IconPicker home initial={homeEmoji} onChange={setHomeEmoji} />
            <label>
              默认货币
              <select
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                <option value="CNY">人民币（CNY）</option>
                <option value="USD">美元（USD）</option>
              </select>
            </label>
          </div>
        )}
        {step === 3 && (
          <div className="setup-step">
            <p className="eyebrow">整理空间</p>
            <h1>先添加几个存放地点</h1>
            <p className="muted">
              之后可以继续增加。地点帮助你知道物资放在哪里。
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
                    placeholder="例如：储物间"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setLocations(locations.filter((_, i) => i !== index))
                    }
                    aria-label="删除地点"
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
              ＋ 添加另一个地点
            </button>
          </div>
        )}
        {error && <div className="setup-error">{error}</div>}
        <div className="setup-footer">
          {step > 1 ? (
            <button className="secondary" onClick={() => setStep(step - 1)}>
              上一步
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
              ? "创建中…"
              : step === 3
                ? "完成设置，进入 Dashboard"
                : "继续"}
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
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.message ?? "登录失败");
      return;
    }
    onLogin();
  };
  return (
    <div className="setup-shell">
      <form className="setup-card login-card" onSubmit={submit}>
        <div className="setup-brand">
          <span className="brand-mark"><MaterialIcon home size={24} /></span>
          <div>
            <strong>AL1S-ERP</strong>
            <span>登录你的家庭</span>
          </div>
        </div>
        <div className="setup-step">
          <p className="eyebrow">欢迎回来</p>
          <h1>登录</h1>
          <p className="muted">使用初始化时创建的管理员账号继续。</p>
          <label>
            用户名
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            密码
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
            />
          </label>
        </div>
        {error && <div className="setup-error">{error}</div>}
        <button className="primary full" disabled={busy}>
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}

export function App() {
  const [setup, setSetup] = useState<{
    complete: boolean;
    home?: { id: string; name: string; icon?: string };
  } | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [homes, setHomes] = useState<{ id: string; name: string; icon?: string }[]>([]);
  const [homeNotice, setHomeNotice] = useState("");
  const [editingHome, setEditingHome] = useState<{ id: string; name: string; icon?: string } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "item" | "category" | "location"; id: string; name: string; message: string } | null>(null);
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
  const [transactionTotal,setTransactionTotal]=useState(0);
  const [transactionSnapshot,setTransactionSnapshot]=useState("");
  const [batchItem,setBatchItem]=useState<Item|null>(null);
  const [activePage, setActivePage] = useState<Page>(pageFromUrl);
  const countView = activePage === "locations" || activePage === "categories";
  const treeMode = activePage === "categories" ? "category" : "location";
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [newApiToken, setNewApiToken] = useState("");
  const [expandedLocations, setExpandedLocations] = useState<
    Record<string, boolean>
  >({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);
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
    const onPopState = () => setActivePage(pageFromUrl());
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
  const transactionPageCount = Math.max(1, Math.ceil(transactionTotal / 10));
  const pagedTransactions = transactions;
  useEffect(() => {
    if (transactionPage > transactionPageCount)
      setTransactionPage(transactionPageCount);
  }, [transactionPage, transactionPageCount]);
  useEffect(() => {
    if (!authenticated) return;
    getTransactions(transactionPage,transactionPage===1?"":transactionSnapshot).then(next=>{
      setTransactions(next.items);setTransactionTotal(next.total);if(transactionPage===1)setTransactionSnapshot(next.snapshotAt);
    }).catch(error=>setNotice(error.message));
  },[transactionPage]);

  const load = () =>
    Promise.all([
      getItems(),
      getStock(),
      getLocations(),
      getTransactions(transactionPage,transactionPage===1?"":transactionSnapshot),
      getShoppingList(),
      getCategories(),
    ])
      .then(
        ([
          nextItems,
          nextStock,
          nextLocations,
          nextTransactions,
          nextShoppingList,
          nextCategories,
        ]) => {
          setItems(nextItems);
          setStock(nextStock);
          setLocations(nextLocations);
          setTransactions(nextTransactions.items);
          setTransactionTotal(nextTransactions.total);
          if(transactionPage===1)setTransactionSnapshot(nextTransactions.snapshotAt);
          setShoppingList(nextShoppingList);
          setCategories(nextCategories);
        },
      )
      .catch((error) => setNotice(error.message));
  useEffect(() => {
    fetch("/api/v1/setup/status")
      .then((response) => response.json())
      .then((data) => {
        setSetup(data);
        if (data.complete)
          fetch("/api/v1/auth/me").then((response) =>
            setAuthenticated(response.ok),
          );
      })
      .catch(() => setSetup({ complete: false }));
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    fetch("/api/v1/homes").then(async response => {
      if (!response.ok) throw new Error("无法加载家庭列表");
      const available = await response.json() as typeof homes;
      const current = available.find(home => home.id === getHomeId()) ?? available[0];
      setHomes(available);
      if (current) {
        localStorage.setItem("family-erp-home-id", current.id);
        setSetup({ complete: true, home: current });
        await load();
      }
    }).catch(error => setNotice(error.message));
  }, [authenticated]);
  const balanceFor = (itemId: string) =>
    stock
      .filter((row) => row.itemId === itemId)
      .reduce((total, row) => total + row.quantity, 0);
  const replenishmentFor = (item: Item) =>
    Math.max(item.reorderPoint - balanceFor(item.id), 0);
  const stockStatusFor = (item: Item) => {
    const quantity = balanceFor(item.id);
    const difference = quantity - item.reorderPoint;
    if (quantity === 0 && difference < 0)
      return { level: "empty", label: "缺货", priority: 0 };
    if (difference < 0)
      return {
        level: "low",
        label: "不足",
        priority: 1,
      };
    if (difference === 0)
      return { level: "warning", label: "临界", priority: 2 };
    return { level: "normal", label: "正常", priority: 3 };
  };
  const expiryStatusFor = (item: Item) => {
    if (!item.expiryDate) return { level: "none", label: "未设" };
    const today = new Date().toISOString().slice(0, 10);
    const threshold = new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    if (item.expiryDate < today) return { level: "expired", label: "过期" };
    if (item.expiryDate <= threshold)
      return { level: "expiring", label: "临期" };
    return { level: "valid", label: "有效" };
  };
  const displayStatusFor = (item: Item) => {
    const expiry = expiryStatusFor(item);
    if (expiry.level === "expired")
      return { ...expiry, priority: -2 };
    if (expiry.level === "expiring")
      return { ...expiry, priority: -1 };
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
      items.filter((item) => {
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
      }).sort(
        (left, right) =>
          displayStatusFor(left).priority - displayStatusFor(right).priority ||
          replenishmentFor(right) - replenishmentFor(left) ||
          left.name.localeCompare(right.name, "zh-CN"),
      ),
    [
      items,
      query,
      locationScopeIds,
      categoryScopeNames,
      stockStatusFilter,
      expiryFilter,
      stock,
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
        left.name.localeCompare(right.name, "zh-CN"),
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
  const currentDateLabel = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
  if (!setup) return <div className="loading-screen">正在检查家庭设置…</div>;
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
    const response = await fetch(`/api/v1/homes/${getHomeId()}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        icon: data.get("icon") || null,
        category: data.get("category"),
        baseUnit: data.get("baseUnit"),
        locationId: data.get("locationId") || undefined,
        reorderPoint: Number(data.get("reorderPoint") || 0),
        reorderQuantity: 0,
        initialStock: Number(data.get("initialStock") || 0),
        manufacturedDate: data.get("manufacturedDate") || undefined,
        expiryDate: data.get("expiryDate") || undefined,
      }),
    });
    setBusy(false);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setNotice(result.message || "保存失败，请检查填写内容");
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
    const response = await fetch(
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
              }
            : { batchId: data.get("batchId") || undefined }),
        }),
      },
    );
    setBusy(false);
    if (response.ok) {
      setStockAction(null);
      load();
    } else setNotice("操作失败，可能是库存不足");
  }

  async function updateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detailItem) return;
    const data = new FormData(event.currentTarget);
    const response = await fetch(
      `/api/v1/homes/${getHomeId()}/items/${detailItem.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          icon: data.get("icon") || null,
          category: data.get("category"),
          baseUnit: data.get("baseUnit"),
          reorderPoint: Number(data.get("reorderPoint") || 0),
          locationId: data.get("locationId") || null,
        }),
      },
    );
    if (!response.ok) {
      setNotice("保存失败，请检查填写内容");
      return;
    }
    setDetailItem(null);
    load();
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/v1/homes/${getHomeId()}/categories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: categoryName.trim(),
        parentId: categoryParent || undefined,
      }),
    });
    if (!response.ok) {
      setNotice("分类添加失败");
      return;
    }
    setCategoryName("");
    setCategoryParent("");
    load();
  }
  async function addLocation(event: FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/v1/homes/${getHomeId()}/locations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: locationName.trim(),
        parentId: locationParent || undefined,
      }),
    });
    if (!response.ok) {
      setNotice("地点添加失败");
      return;
    }
    setLocationName("");
    setLocationParent("");
    load();
  }
  async function addShoppingItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/v1/homes/${getHomeId()}/shopping-list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        quantity: Number(data.get("quantity") || 1),
        unit: data.get("unit") || undefined,
        category: data.get("category") || undefined,
        locationId: data.get("locationId") || undefined,
        itemId: data.get("itemId") || undefined,
      }),
    });
    if (!response.ok) {
      setNotice("采购项添加失败");
      return;
    }
    setShowShoppingForm(false);
    setShoppingItemId("");
    load();
  }
  async function receiveShopping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receiveShoppingItem || busy) return;
    const data = new FormData(event.currentTarget);
    const quantity = Number(data.get("quantity"));
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    setBusy(true);
    const response = await fetch(
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
        }),
      },
    );
    setBusy(false);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setNotice(result.message || `采购项处理失败（${response.status}）`);
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
    const response = await fetch(
      `/api/v1/homes/${getHomeId()}/shopping-list/${editShoppingItem.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          quantity: Number(data.get("quantity") || 1),
          unit: data.get("unit"),
          category: data.get("category"),
          locationId: data.get("locationId") || null,
          itemId: data.get("itemId") || null,
        }),
      },
    );
    if (!response.ok) {
      setNotice("采购项保存失败");
      return;
    }
    setEditShoppingItem(null);
    setEditShoppingItemId("");
    load();
  }
  async function updateTreeNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTreeNode) return;
    const data = new FormData(event.currentTarget);
    const response = await fetch(
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
        CATEGORY_CYCLE: "不能移动到自己的子级下面",
        LOCATION_CYCLE: "不能移动到自己的子级下面",
        CATEGORY_EXISTS: "同级分类名称已存在",
        LOCATION_EXISTS: "同级地点名称已存在",
        PARENT_CATEGORY_NOT_FOUND: "父级分类不存在",
        PARENT_LOCATION_NOT_FOUND: "父级地点不存在",
      };
      setNotice(
        messages[result.code] ||
          result.message ||
          `保存失败（${response.status}）`,
      );
      return;
    }
    setEditTreeNode(null);
    load();
  }
  function confirmDelete(kind: "item" | "category" | "location", node: { id: string; name: string; parentId?: string | null }) {
    const parent = (kind === "category" ? categories : locations).find(candidate => candidate.id === node.parentId);
    const fallback = kind === "category" ? (node.name === "未分类" ? "其他" : "未分类") : (node.name === "未指定" ? "待整理" : "未指定");
    setDeleteError("");
    setDeleteTarget({ kind, id: node.id, name: node.name, message: kind === "item"
      ? "物资将从清单移除，剩余库存清零并记录删除流水。历史记录保留，关联采购项转为独立采购项。"
      : `直属物资将归入“${parent?.name || fallback}”，子节点${parent ? "移到上一级" : "提升为一级节点"}。物资不会被删除，仅记录实际的物资归属变更。` });
  }
  async function deleteSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const resource = { item: "items", category: "categories", location: "locations" }[deleteTarget.kind];
      const response = await fetch(`/api/v1/homes/${getHomeId()}/${resource}/${deleteTarget.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "删除失败，请重试");
      setDeleteTarget(null);
      setTransactionPage(1);
      await load();
    } catch (error) { setDeleteError(error instanceof Error ? error.message : "删除失败，请重试"); }
    finally { setDeleting(false); }
  }
  async function loadApiTokens() {
    const response = await fetch("/api/v1/auth/tokens");
    if (response.ok) setApiTokens(await response.json());
    else setNotice("无法加载 MCP 令牌");
  }
  async function createApiToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const scope = String(data.get("homeId") || "");
    const response = await fetch("/api/v1/auth/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, homeId: scope === "all" ? null : scope }),
    });
    if (!response.ok) {
      setNotice("创建令牌失败");
      return;
    }
    const result = await response.json();
    setNewApiToken(result.token);
    form.reset();
    loadApiTokens();
  }
  async function revokeApiToken(tokenId: string) {
    const response = await fetch(`/api/v1/auth/tokens/${tokenId}`, {
      method: "DELETE",
    });
    if (response.ok) loadApiTokens();
    else setNotice("撤销令牌失败");
  }
  function openItemForm(preset?: {
    locationId?: string;
    category?: string;
  }) {
    setPrefillLocationId(preset?.locationId || "");
    setPrefillCategory(preset?.category || "");
    setShowForm(true);
  }
  function closeItemForm() {
    setShowForm(false);
    setPrefillLocationId("");
    setPrefillCategory("");
  }
  function navigate(page: Page) {
    if (window.location.pathname !== pagePaths[page])
      window.history.pushState(null, "", pagePaths[page]);
    setActivePage(page);
  }
  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/auth/logout", { method: "POST" });
      if (!response.ok && response.status !== 401) throw new Error("退出失败，请重试");
      window.location.reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "退出失败");
      setBusy(false);
    }
  }

  type TreeNode = {
    id: string;
    name: string;
    parentId: string | null;
    items: Item[];
  };
  const treeNodes: TreeNode[] =
    treeMode === "location"
      ? locations.map((location) => ({
          id: location.id,
          name: location.name,
          parentId: location.parentId,
          items: items.filter((item) => item.locationId === location.id),
        }))
      : categories.map((category) => ({
          id: category.id,
          name: category.name,
          parentId: category.parentId,
          items: items.filter((item) => item.category === category.name),
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
            aria-label={open ? "收起" : "展开"}
            onClick={() =>
              setExpandedLocations({ ...expandedLocations, [node.id]: !open })
            }
          >
            {expandable && (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>
          <button
            type="button"
            className="tree-node-label"
            disabled={!expandable}
            onClick={() =>
              setExpandedLocations({ ...expandedLocations, [node.id]: !open })
            }
          >{node.name}</button>
          <div className="tree-node-actions">
            <button
              type="button"
              className="tree-icon-button"
              title="增加物资"
              aria-label={`在${node.name}增加物资`}
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
              title={`编辑${treeMode === "location" ? "地点" : "分类"}`}
              aria-label={`编辑${node.name}`}
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
            <button type="button" className="tree-icon-button danger-action" title={`删除${treeMode === "location" ? "地点" : "分类"}`} aria-label={`删除${node.name}`} onClick={() => confirmDelete(treeMode, node)}><Trash2 size={14} /></button>
          </div>
        </div>
        {open && (
          <>
            {node.items.map((item) => {
              const status = displayStatusFor(item);
              return (
                <div
                  className="tree-item-row"
                  key={item.id}
                  style={{ "--tree-depth": depth } as CSSProperties}
                >
                  <strong className="tree-item-name"><MaterialIcon value={itemIconFor(item)} />{item.name}</strong>
                  <span className="tree-item-stock">
                    {balanceFor(item.id)} {item.baseUnit}
                  </span>
                  <span className={`stock-status ${status.level}`}>
                    {status.label}
                  </span>
                  <span className="tree-item-meta">
                    {treeMode === "location"
                      ? item.category || "未分类"
                      : item.locationName || "未指定地点"}
                    {item.expiryDate ? ` · 到期 ${item.expiryDate}` : ""}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setDetailItem(item)}
                  >
                    编辑
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
          <span className="brand-mark" role="img" aria-label="家庭">
            <MaterialIcon value={setup.home?.icon} home size={24} />
          </span>
          <div>
            <strong>AL1S-ERP</strong>
          </div>
        </div>
        <nav className="main-nav" aria-label="主导航">
          <button
            className={activePage === "home" ? "active" : ""}
            onClick={() => navigate("home")}
          >
            首页
          </button>
          <button
            className={activePage === "count" ? "active" : ""}
            onClick={() => navigate("count")}
          >
            盘点
          </button>
          <button
            className={activePage === "shopping" ? "active" : ""}
            onClick={() => navigate("shopping")}
          >
            采购
          </button>
          <button className={activePage === "locations" ? "active" : ""} onClick={() => navigate("locations")}>地点</button>
          <button className={activePage === "categories" ? "active" : ""} onClick={() => navigate("categories")}>分类</button>
        </nav>
        <div className="top-actions">
          <div className="home-switch">
            <MaterialIcon value={setup.home?.icon} home size={18} />
            <select aria-label="切换家庭" value={setup.home?.id ?? ""} onChange={event => {
              localStorage.setItem("family-erp-home-id", event.target.value);
              window.location.reload();
            }}>
              {homes.map(home => <option key={home.id} value={home.id}>{home.name}</option>)}
            </select>
          </div>
          <button
            className={`avatar ${activePage === "profile" ? "active" : ""}`}
            onClick={() => navigate("profile")}
            aria-label="账号与 MCP 令牌"
          >
            我
          </button>
        </div>
      </header>
      <main>
        <section className="welcome">
          <div>
            <p className="eyebrow">{currentDateLabel}</p>
            <h1>
              {activePage === "home"
                ? "总览"
                : activePage === "count"
                  ? "物资盘点"
                  : activePage === "locations"
                    ? "地点"
                    : activePage === "categories"
                      ? "分类"
                      : activePage === "shopping"
                        ? "采购清单"
                        : "我的设置"}
            </h1>
            <p className="muted">
              {activePage === "home"
                ? "掌握家里有什么，及时补充需要的东西。"
                : activePage === "count"
                  ? "添加物资、调整库存并查看变动记录。"
                  : activePage === "locations"
                    ? "按存放空间查看家里的物资。"
                    : activePage === "categories"
                      ? "维护物资分类和分类树。"
                      : activePage === "shopping"
                        ? "管理自动建议和手动采购项。"
                        : "管理家庭、Agent 访问令牌与登录会话。"}
            </p>
          </div>
          {activePage === "profile" && <button className="secondary profile-logout" disabled={busy} onClick={logout}>退出登录</button>}
          {activePage === "home" && (
            <div className="dashboard-actions" aria-label="快捷操作">
              <button type="button" onClick={() => openItemForm()}>
                <Plus size={16} />
                添加物资
              </button>
              <button type="button" onClick={() => navigate("count")}>
                <Check size={16} />
                开始盘点
              </button>
              <button type="button" onClick={() => navigate("shopping")}>
                <ClipboardList size={16} />
                采购清单
              </button>
            </div>
          )}
          {(activePage === "count" || activePage === "shopping") && (
            <button
              className="primary"
              onClick={() =>
                activePage === "count"
                  ? openItemForm()
                  : setShowShoppingForm(true)
              }
            >
              ＋ {activePage === "count" ? "添加物资" : "添加采购项"}
            </button>
          )}
        </section>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button onClick={() => setNotice("")} aria-label="关闭">
              ×
            </button>
          </div>
        )}
        {activePage === "profile" && (
          <section className="panel home-settings">
            <div className="panel-head"><div><h2>家庭管理</h2><p className="muted">共 {homes.length} 个家庭 · 各家庭物资独立管理</p></div><button className="primary" disabled={busy} onClick={() => { setEditingHome({ id: "", name: "", icon: "house" }); setHomeNotice(""); }}>新增家庭</button></div>
            <div className="home-list">{homes.map(home => <div className={`home-card ${home.id === setup.home?.id ? "current" : ""}`} key={home.id}>
              <span className="home-card-icon"><MaterialIcon value={home.icon} home size={24} /></span>
              <div className="home-card-name"><strong>{home.name}</strong><small>{home.id === setup.home?.id ? "当前使用" : "可切换"}</small></div>
              <div className="home-card-actions"><button className="secondary" disabled={busy} onClick={() => { setEditingHome(home); setHomeNotice(""); }}>编辑</button>{home.id !== setup.home?.id && <button className="text-button" disabled={busy} onClick={() => { localStorage.setItem("family-erp-home-id", home.id); window.location.reload(); }}>切换</button>}</div>
            </div>)}</div>
            {editingHome && <form className="home-editor" key={editingHome.id} onSubmit={async event => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setBusy(true); setHomeNotice("");
              try {
                const response = await fetch(editingHome.id ? `/api/v1/homes/${editingHome.id}` : "/api/v1/homes", { method: editingHome.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.get("name"), icon: data.get("icon") }) });
                const home = await response.json();
                if (!response.ok) throw new Error(home.message || "保存失败");
                setHomes(previous => editingHome.id ? previous.map(value => value.id === home.id ? home : value) : [...previous, home]);
                if (home.id === setup.home?.id) {
                  setSetup({ complete: true, home });
                  localStorage.setItem("family-erp-home-emoji", home.icon);
                }
                setEditingHome(null);
                setHomeNotice(editingHome.id ? "家庭已保存" : "家庭已创建，可切换后在地点页面添加房间");
              } catch (error) { setHomeNotice(error instanceof Error ? error.message : "保存失败"); }
              finally { setBusy(false); }
            }}>
              <h3>{editingHome.id ? "编辑家庭" : "新增家庭"}</h3>
              <label>家庭名称<input name="name" required maxLength={80} defaultValue={editingHome.name} /></label>
              <IconPicker home initial={editingHome.icon} />
              <div className="home-editor-actions"><button className="primary" disabled={busy}>{busy ? "保存中…" : "保存家庭"}</button><button type="button" className="secondary" disabled={busy} onClick={() => setEditingHome(null)}>取消</button></div>
            </form>}
            {homeNotice && <p className="home-feedback" role="status">{homeNotice}</p>}
          </section>
        )}
        {activePage === "profile" && (
          <section className="panel token-panel">
            <div className="panel-head">
              <div>
                <h2>MCP 访问令牌</h2>
                <p className="muted">
                  连接地址为当前站点的 /mcp，认证方式为 Bearer Token。默认仅管理所选家庭。
                </p>
              </div>
            </div>
            <form className="token-create" onSubmit={createApiToken}>
              <input
                name="name"
                required
                maxLength={80}
                placeholder="令牌名称，例如：Claude Desktop"
              />
              <select name="homeId" defaultValue={getHomeId()} aria-label="令牌家庭范围">
                {homes.map(home => <option key={home.id} value={home.id}>{home.name}</option>)}
                <option value="all">全部家庭（高级）</option>
              </select>
              <button type="submit" className="primary">创建令牌</button>
            </form>
            {newApiToken && (
              <div className="token-secret" role="status">
                <strong>请立即复制，关闭后无法再次查看</strong>
                <code>{newApiToken}</code>
                <div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => navigator.clipboard.writeText(newApiToken)}
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setNewApiToken("")}
                  >
                    已保存
                  </button>
                </div>
              </div>
            )}
            <div className="token-list">
              {apiTokens.length === 0 ? (
                <p className="empty">尚未创建 MCP 令牌</p>
              ) : (
                apiTokens.map((token) => (
                  <div className="token-row" key={token.id}>
                    <div>
                      <strong>{token.name}</strong>
                      <span>
                        {token.tokenPrefix} · {token.homeId ? `家庭：${token.homeName || "已删除"}` : "全部家庭（高级）"} · 创建于{" "}
                        {new Date(token.createdAt).toLocaleString()}
                      </span>
                      <span>
                        {token.lastUsedAt
                          ? `最近使用 ${new Date(token.lastUsedAt).toLocaleString()}`
                          : "尚未使用"}
                      </span>
                    </div>
                    {token.revokedAt ? (
                      <span className="revoked">已撤销</span>
                    ) : (
                      <button
                        type="button"
                        className="danger-text"
                        onClick={() => revokeApiToken(token.id)}
                      >
                        撤销
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
                <h2>地点管理</h2>
                <p className="muted">新增一级地点或子地点</p>
              </div>
            </div>
            <form className="category-form" onSubmit={addLocation}>
              <input
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                placeholder="地点名称"
                required
              />
              <select
                value={locationParent}
                onChange={(event) => setLocationParent(event.target.value)}
              >
                <option value="">一级地点</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {"　".repeat(location.depth)}
                    {location.name}
                  </option>
                ))}
              </select>
              <button className="primary">添加地点</button>
            </form>
          </section>
        )}
        {activePage === "categories" && (
          <section className="panel category-manager">
            <div className="panel-head">
              <div>
                <h2>分类管理</h2>
                <p className="muted">新增一级分类或子分类</p>
              </div>
            </div>
            <form className="category-form" onSubmit={addCategory}>
              <input
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="分类名称"
                required
              />
              <select
                value={categoryParent}
                onChange={(event) => setCategoryParent(event.target.value)}
              >
                <option value="">一级分类</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {"　".repeat(category.depth)}
                    {category.name}
                  </option>
                ))}
              </select>
              <button className="primary">添加分类</button>
            </form>
          </section>
        )}
        {activePage === "shopping" && (
          <section className="panel shopping-list">
            <div className="panel-head">
              <div>
                <h2>采购清单</h2>
                <p className="muted">自动建议与手动采购项</p>
              </div>
            </div>
            {shoppingList.length === 0 ? (
              <p className="empty">暂无采购项</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>采购项</th>
                      <th>数量</th>
                      <th>种类</th>
                      <th>存放地点</th>
                      <th>来源</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shoppingList.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <div className="item-name">
                            <span className="item-icon">
                              <MaterialIcon value={itemIconFor(items.find(existing => existing.id === item.itemId) || item)} />
                            </span>
                            <strong>{item.name}</strong>
                          </div>
                        </td>
                        <td>
                          {item.quantity} {item.unit || "件"}
                        </td>
                        <td>{item.category || "未分类"}</td>
                        <td>
                          {locations.find(
                            (location) => location.id === item.locationId,
                          )?.name || "未指定"}
                        </td>
                        <td>
                          {item.source === "automatic"
                            ? "低库存建议"
                            : "手动添加"}
                        </td>
                        <td>
                          <div className="row-actions">
                            {item.source === "manual" && (
                              <button
                                onClick={() => {
                                  setEditShoppingItem(item);
                                  setEditShoppingItemId(item.itemId || "");
                                }}
                              >
                                编辑
                              </button>
                            )}
                            {!item.completed && (
                              <button
                                onClick={() => openShoppingReceipt(item)}
                              >
                                完成入库
                              </button>
                            )}
                            <button
                              onClick={() =>
                                fetch(
                                  `/api/v1/homes/${getHomeId()}/shopping-list/${item.id}`,
                                  { method: "DELETE" },
                                ).then(load)
                              }
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {activePage === "home" && (
          <section className="summary-grid">
            <div className="summary-card">
              <span className="summary-icon"><Package size={18} /></span>
              <div>
                <span className="summary-label">物资种类</span>
                <strong>{items.length}</strong>
                <span className="summary-foot">当前在管物资</span>
              </div>
            </div>
            <div className="summary-card warning">
              <span className="summary-icon"><TriangleAlert size={18} /></span>
              <div>
                <span className="summary-label">需要补充</span>
                <strong>{lowStock}</strong>
                <span className="summary-foot">低于最低库存</span>
              </div>
            </div>
            <div className="summary-card">
              <span className="summary-icon"><CalendarClock size={18} /></span>
              <div>
                <span className="summary-label">即将到期</span>
                <strong>{expiringItems.length}</strong>
                <span className="summary-foot">未来 30 天</span>
              </div>
            </div>
            <div className="summary-card shopping">
              <span className="summary-icon"><ShoppingCart size={18} /></span>
              <div>
                <span className="summary-label">待采购</span>
                <strong>{pendingShoppingCount}</strong>
                <span className="summary-foot">未完成采购项</span>
              </div>
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
                    <h2>库存概览</h2>
                    <p className="muted">优先显示需要补充的物资</p>
                  </div>
                  <button className="text-button" onClick={() => navigate("count")}>查看全部</button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>物资</th><th>库存</th><th className="dashboard-minimum">最低库存</th><th>状态</th><th className="dashboard-location">位置</th></tr></thead>
                    <tbody>
                      {dashboardItems.map((item) => {
                        const status = displayStatusFor(item);
                        return (
                          <tr key={item.id}>
                            <td><div className="item-name"><span className="item-icon"><MaterialIcon value={itemIconFor(item)} /></span><strong>{item.name}</strong></div></td>
                            <td>{balanceFor(item.id)} {item.baseUnit}</td>
                            <td className="dashboard-minimum">{item.reorderPoint} {item.baseUnit}</td>
                            <td><span className={`stock-status ${status.level}`}>{status.label}</span></td>
                            <td className="dashboard-location">{item.locationName || "未指定"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {dashboardItems.length === 0 && <p className="empty">暂无物资</p>}
                </div>
                </div>
                <section className="panel recent-log dashboard-log">
                  <div className="panel-head">
                    <div><h2>最近变动</h2><p className="muted">按时间倒序的库存流水</p></div>
                  </div>
                  {pagedTransactions.length === 0 ? <p className="empty">暂无库存变动</p> : (
                    <div className="log-list">
                      {pagedTransactions.map((transaction) => (
                        <TransactionRow key={transaction.id} transaction={transaction} />
                      ))}
                    </div>
                  )}
                  {transactionPageCount > 1 && (
                    <div className="pagination">
                      <span>{(transactionPage - 1) * 10 + 1}–{Math.min(transactionPage * 10, transactionTotal)} / 共 {transactionTotal} 条</span>
                      <button type="button" aria-label="上一页" disabled={transactionPage === 1} onClick={() => setTransactionPage(transactionPage - 1)}><ArrowLeft size={15} /></button>
                      <span>{transactionPage} / {transactionPageCount}</span>
                      <button type="button" aria-label="下一页" disabled={transactionPage === transactionPageCount} onClick={() => setTransactionPage(transactionPage + 1)}><ArrowRight size={15} /></button>
                    </div>
                  )}
                </section>
              </div>
              <aside className="dashboard-side">
                <section className="panel dashboard-shopping">
                  <div className="panel-head">
                    <div><h2>待采购</h2><p className="muted">自动建议与手动采购项</p></div>
                    <button className="text-button" onClick={() => navigate("shopping")}>查看全部</button>
                  </div>
                  <div className="dashboard-list">
                    {shoppingItems.length === 0 ? <p className="empty compact">暂无待采购项</p> : shoppingItems.map((item) => (
                      <button type="button" className="dashboard-list-row" key={item.id} onClick={() => navigate("shopping")}>
                        <span><strong>{item.name}</strong><small>{item.category || "未分类"}</small></span>
                        <b>{item.quantity} {item.unit || "件"}</b>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="panel dashboard-categories">
                  <div className="panel-head">
                    <div><h2>分类结构</h2><p className="muted">包含子分类的物资种类</p></div>
                    <button className="text-button" onClick={() => navigate("categories")}>管理</button>
                  </div>
                  <div className="category-summary">
                    {categorySummary.map((category) => (
                      <div key={category.id}>
                        <span style={{ paddingLeft: category.depth * 14 }}>{category.name}</span>
                        <strong>{category.count}</strong>
                      </div>
                    ))}
                    {categorySummary.length === 0 && <p className="empty compact">暂无分类数据</p>}
                  </div>
                </section>
                <section className="panel dashboard-locations">
                  <div className="panel-head">
                    <div><h2>地点结构</h2><p className="muted">包含子地点的物资种类</p></div>
                    <button className="text-button" onClick={() => navigate("locations")}>管理</button>
                  </div>
                  <div className="location-summary">
                    {locationSummary.map((location) => (
                      <div key={location.id}>
                        <span style={{ paddingLeft: location.depth * 14 }}>{location.name}</span>
                        <strong>{location.count}</strong>
                      </div>
                    ))}
                    {locationSummary.length === 0 && <p className="empty compact">暂无地点数据</p>}
                  </div>
                </section>
              </aside>
            </section>
          </>
        )}
        {!countView &&
          !logView &&
          activePage === "count" && (
            <section className="count-workspace">
              <div className="count-summary" aria-label="库存状态概览">
                <button className={!stockStatusFilter && !expiryFilter ? "active" : ""} onClick={() => { setStockStatusFilter(""); setExpiryFilter(""); }}>
                  <span>全部物资</span><strong>{items.length}</strong>
                </button>
                <button className={stockStatusFilter === "empty" ? "active danger" : ""} onClick={() => { setStockStatusFilter("empty"); setExpiryFilter(""); }}>
                  <span>缺货</span><strong>{emptyStockCount}</strong>
                </button>
                <button className={stockStatusFilter === "replenishment" ? "active warning" : ""} onClick={() => { setStockStatusFilter("replenishment"); setExpiryFilter(""); }}>
                  <span>不足</span><strong>{belowStockCount}</strong>
                </button>
                <button className={stockStatusFilter === "warning" ? "active warning" : ""} onClick={() => { setStockStatusFilter("warning"); setExpiryFilter(""); }}>
                  <span>临界</span><strong>{criticalStockCount}</strong>
                </button>
                <button className={expiryFilter === "expiring" ? "active" : ""} onClick={() => { setStockStatusFilter(""); setExpiryFilter("expiring"); }}>
                  <span>30 天内到期</span><strong>{expiringItems.length}</strong>
                </button>
              </div>
              <div className="panel inventory-panel count-inventory">
                <div className="panel-head">
                  <div>
                    <h2>库存明细</h2>
                    <p className="muted">按紧急程度排序，共 {filtered.length} 项</p>
                  </div>
                  <label className="search count-search">
                    <Search size={16} strokeWidth={1.8} />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索物资" />
                  </label>
                </div>
                <div className="count-filters">
                  <SlidersHorizontal size={15} strokeWidth={1.8} />
                  <label>分类<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">全部分类</option>{categoryOptions.map((category) => <option key={category.id} value={category.name}>{"　".repeat(category.depth)}{category.name}</option>)}</select></label>
                  <label>地点<select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="">全部地点</option>{locationOptions.map((location) => <option key={location.id} value={location.id}>{"　".repeat(location.depth)}{location.name}</option>)}</select></label>
                  <label>库存状态<select value={stockStatusFilter} onChange={(event) => setStockStatusFilter(event.target.value)}><option value="">全部状态</option><option value="empty">缺货</option><option value="replenishment">不足</option><option value="warning">临界</option><option value="normal">正常</option></select></label>
                  <label>到期状态<select value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value)}><option value="">全部</option><option value="expired">过期</option><option value="expiring">临期</option><option value="valid">有效</option><option value="none">未设</option></select></label>
                  {(query || categoryFilter || locationFilter || stockStatusFilter || expiryFilter) && (
                    <button type="button" className="text-button" onClick={() => { setQuery(""); setCategoryFilter(""); setLocationFilter(""); setStockStatusFilter(""); setExpiryFilter(""); }}>重置</button>
                  )}
                </div>
                <div className="table-wrap count-table-wrap">
                  <table className="count-table">
                    <thead>
                      <tr><th>物资</th><th>当前库存</th><th>最低库存</th><th>补充建议</th><th>状态</th><th>存放地点</th><th>日期</th><th>操作</th></tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan={8} className="empty">没有符合当前条件的物资。</td></tr>
                      ) : pagedItems.map((item) => {
                        const stockStatus = displayStatusFor(item);
                        const replenishment = replenishmentFor(item);
                        return (
                          <tr key={item.id}>
                            <td><div className="item-name"><span className="item-icon"><MaterialIcon value={itemIconFor(item)} /></span><div><strong>{item.name}</strong><span>{item.category || "未分类"}</span></div></div></td>
                            <td><strong>{balanceFor(item.id)} {item.baseUnit}</strong></td>
                            <td>{item.reorderPoint} {item.baseUnit}</td>
                            <td className={replenishment > 0 ? "replenishment" : "muted-cell"}>{replenishment > 0 ? `${replenishment} ${item.baseUnit}` : "—"}</td>
                            <td><span className={`stock-status ${stockStatus.level}`}>{stockStatus.label}</span></td>
                            <td>{item.locationName || "未指定"}</td>
                            <td><div className="date-cell"><span>生产 {item.manufacturedDate || "—"}</span><span>到期 {item.expiryDate || "—"}</span></div></td>
                            <td><div className="row-actions"><button onClick={() => openStockAction("receipt", item)}>入库</button><button onClick={() => openStockAction("issue", item)}>领用</button><button onClick={() => setBatchItem(item)}>批次</button><button onClick={() => setDetailItem(item)}>编辑</button><button className="danger-action" onClick={() => confirmDelete("item", item)}>删除</button></div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filtered.length > 0 && (
                  <div className="pagination">
                    <span>{pageStart}–{pageEnd} / 共 {filtered.length} 项</span>
                    <button type="button" aria-label="上一页" title="上一页" disabled={page === 1} onClick={() => setPage(page - 1)}><ArrowLeft size={15} /></button>
                    <span>{page} / {pageCount}</span>
                    <button type="button" aria-label="下一页" title="下一页" disabled={page === pageCount} onClick={() => setPage(page + 1)}><ArrowRight size={15} /></button>
                  </div>
                )}
              </div>
            </section>
          )}
        {activePage === "count" && !logView && (
          <section className="panel recent-log">
            <div className="panel-head">
              <div>
                <h2>最近变动</h2>
                <p className="muted">按时间倒序的库存流水</p>
              </div>
            </div>
            {pagedTransactions.length === 0 ? (
              <p className="empty">暂无库存变动</p>
            ) : (
              <div className="log-list">
                {pagedTransactions.map((transaction) => (
                  <TransactionRow key={transaction.id} transaction={transaction} />
                ))}
              </div>
            )}
            {transactionPageCount > 1 && (
              <div className="pagination">
                <span>
                  {(transactionPage - 1) * 10 + 1}–
                  {Math.min(transactionPage * 10, transactionTotal)} / 共{" "}
                  {transactionTotal} 条
                </span>
                <button
                  type="button"
                  aria-label="上一页"
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
                  aria-label="下一页"
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
                <h2>{treeMode === "location" ? "地点" : "分类"}</h2>
                <p className="muted">展开节点查看库存与状态</p>
              </div>
              <div className="panel-tools">
                <button
                  className="text-button"
                  onClick={() => navigate("count")}
                >
                  返回盘点
                </button>
              </div>
            </div>
            {treeNodes
              .filter((node) => !node.parentId)
              .map((node) => renderTreeNode(node))}
            {treeNodes.length === 0 && <p className="empty">暂无节点</p>}
          </section>
        )}
        {logView && (
          <section className="panel full-log">
            <div className="panel-head">
              <div>
                <h2>完整变动日志</h2>
                <p className="muted">按时间倒序记录库存变动</p>
              </div>
              <button className="text-button" onClick={() => setLogView(false)}>
                返回总览
              </button>
            </div>
            <div className="log-list">
              {transactions.length === 0 ? (
                <p className="empty">暂无库存变动</p>
              ) : (
                transactions.map((transaction) => (
                  <TransactionRow key={transaction.id} transaction={transaction} />
                ))
              )}
            </div>
          </section>
        )}
      </main>
      {deleteTarget && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !deleting) setDeleteTarget(null); }}>
        <form className="modal delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title" onSubmit={deleteSelected}>
          <div className="modal-head"><h2 id="delete-title">删除{deleteTarget.kind === "item" ? "物资" : deleteTarget.kind === "category" ? "分类" : "地点"}</h2><button type="button" className="close" disabled={deleting} aria-label="关闭" onClick={() => setDeleteTarget(null)}><X size={18} /></button></div>
          <strong>{deleteTarget.name}</strong><p>{deleteTarget.message}</p>
          {deleteError && <p className="setup-error" role="alert">{deleteError}</p>}
          <div className="delete-dialog-actions"><button type="button" className="secondary" autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button><button className="primary danger-button" disabled={deleting}>{deleting ? "删除中…" : "确认删除"}</button></div>
        </form>
      </div>}
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
                <h2>编辑物资</h2>
                <p className="muted">{detailItem.name}</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => setDetailItem(null)}
                aria-label="关闭"
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>
            <label>
              物资名称
              <input name="name" required defaultValue={detailItem.name} />
            </label>
            <label>
              类型
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
                当前库存
                <input
                  value={`${balanceFor(detailItem.id)} ${detailItem.baseUnit}`}
                  readOnly
                />
              </label>
              <label>
                单位
                <select
                  name="baseUnit"
                  required
                  defaultValue={detailItem.baseUnit}
                >
                  <option>个</option>
                  <option>瓶</option>
                  <option>盒</option>
                  <option>包</option>
                  <option>箱</option>
                  <option>袋</option>
                  <option>千克</option>
                  <option>升</option>
                  <option>米</option>
                  <option>其他</option>
                </select>
              </label>
              <label>
                最低库存
                <input
                  name="reorderPoint"
                  type="number"
                  min="0"
                  step="0.1"
                  defaultValue={detailItem.reorderPoint}
                />
              </label>
            </div>
            <label>
              存放地点
              <select
                name="locationId"
                defaultValue={detailItem.locationId || ""}
              >
                <option value="">暂不指定</option>
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
                管理库存批次
              </button>
              <button className="primary">保存修改</button>
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
                  编辑{editTreeNode.kind === "location" ? "地点" : "分类"}
                </h2>
                <p className="muted">调整名称或父级</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => setEditTreeNode(null)}
                aria-label="关闭"
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>
            <label>
              名称
              <input name="name" required defaultValue={editTreeNode.name} />
            </label>
            <label>
              父级
              <select
                name="parentId"
                defaultValue={editTreeNode.parentId || ""}
              >
                <option value="">
                  一级{editTreeNode.kind === "location" ? "地点" : "分类"}
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
            <button className="primary full">保存修改</button>
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
                  {stockAction.type === "receipt" ? "入库物资" : "领用物资"}
                </h2>
                <p className="muted">{stockAction.item.name}</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => setStockAction(null)}
                aria-label="关闭"
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>
            <label>
              存放地点
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
              <BatchFields title="新入库批次（可选）" />
            ) : stockLocationId ? (
              <BatchSelect
                homeId={getHomeId()}
                itemId={stockAction.item.id}
                locationId={stockLocationId}
              />
            ) : null}
            <label>
              数量
              <input
                name="quantity"
                type="number"
                min="0.1"
                step="0.1"
                defaultValue="1"
                autoFocus
                required
              />
            </label>
            <label>
              备注（可选）
              <input name="reason" placeholder="例如：本周采购" />
            </label>
            <button className="primary full" disabled={busy}>
              {busy ? "处理中…" : `确认${stockAction.type === "receipt" ? "入库" : "领用"}`}
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
                <h2>添加采购项</h2>
                <p className="muted">手动加入采购清单</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => {
                  setShowShoppingForm(false);
                  setShoppingItemId("");
                }}
                aria-label="关闭"
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>
            <label>
              名称
              <input
                key={`shopping-name-${shoppingItemId}`}
                name="name"
                required
                defaultValue={linkedShoppingItem?.name || ""}
                placeholder="例如：纸巾"
                disabled={Boolean(linkedShoppingItem)}
              />
            </label>
            <label>
              关联物资（可选）
              <select
                name="itemId"
                value={shoppingItemId}
                onChange={(event) => setShoppingItemId(event.target.value)}
              >
                <option value="">不关联已有物资</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                数量
                <input
                  name="quantity"
                  type="number"
                  min="0.1"
                  step="0.1"
                  defaultValue="1"
                />
              </label>
              <label>
                单位
                <select
                  key={`shopping-unit-${shoppingItemId}`}
                  name="unit"
                  defaultValue={linkedShoppingItem?.baseUnit || "个"}
                  disabled={Boolean(linkedShoppingItem)}
                >
                  <option>个</option>
                  <option>瓶</option>
                  <option>盒</option>
                  <option>包</option>
                  <option>箱</option>
                  <option>袋</option>
                  <option>千克</option>
                  <option>升</option>
                  <option>米</option>
                  <option>其他</option>
                </select>
              </label>
            </div>
            <label>
              种类
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
              存放地点
              <select
                key={`shopping-location-${shoppingItemId}`}
                name="locationId"
                defaultValue={
                  linkedShoppingItem?.locationId || locations[0]?.id || ""
                }
                disabled={Boolean(linkedShoppingItem)}
              >
                <option value="">暂不指定</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {"　".repeat(location.depth)}
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary full">加入采购清单</button>
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
                <h2>编辑采购项</h2>
                <p className="muted">修改采购数量和入库信息</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => {
                  setEditShoppingItem(null);
                  setEditShoppingItemId("");
                }}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <label>
              名称
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
            <label>
              关联物资（可选）
              <select
                name="itemId"
                value={editShoppingItemId}
                onChange={(event) => setEditShoppingItemId(event.target.value)}
              >
                <option value="">不关联已有物资</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                数量
                <input
                  name="quantity"
                  type="number"
                  min="0.1"
                  step="0.1"
                  defaultValue={editShoppingItem.quantity}
                />
              </label>
              <label>
                单位
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
                  <option>个</option>
                  <option>瓶</option>
                  <option>盒</option>
                  <option>包</option>
                  <option>箱</option>
                  <option>袋</option>
                  <option>千克</option>
                  <option>升</option>
                  <option>米</option>
                  <option>其他</option>
                </select>
              </label>
            </div>
            <label>
              种类
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
              存放地点
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
                <option value="">暂不指定</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {"　".repeat(location.depth)}
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary full">保存修改</button>
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
                <h2>采购入库</h2>
                <p className="muted">
                  {receiveShoppingItem.name} · 建议{" "}
                  {receiveShoppingItem.quantity}{" "}
                  {receiveShoppingItem.unit || "件"}
                </p>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => setReceiveShoppingItem(null)}
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <label>
              实际入库数量
              <input
                name="quantity"
                type="number"
                min="0.1"
                step="0.1"
                defaultValue={receiveShoppingItem.quantity}
                autoFocus
                required
              />
            </label>
            <label>
              入库地点
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
            <BatchFields title="采购入库批次（可选）" />
            <button className="primary full" disabled={busy}>
              {busy ? "入库中…" : "确认入库"}
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
          <form className="modal item-form-modal" onSubmit={addItem}>
            <div className="modal-head">
              <div>
                <h2>添加物资</h2>
                <p className="muted">登记名称、当前库存和补充规则</p>
              </div>
              <button
                type="button"
                className="close"
                onClick={closeItemForm}
                aria-label="关闭"
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>
            <label>
              物资名称
              <input name="name" required placeholder="例如：洗衣液" />
            </label>
            <label>
              类型
              <select name="category" defaultValue={prefillCategory || "其他"}>
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
                单位
                <select name="baseUnit" defaultValue="个">
                  <option>个</option>
                  <option>瓶</option>
                  <option>盒</option>
                  <option>包</option>
                  <option>箱</option>
                  <option>袋</option>
                  <option>千克</option>
                  <option>升</option>
                  <option>米</option>
                  <option>其他</option>
                </select>
              </label>
              <label>
                库存
                <input
                  name="initialStock"
                  type="number"
                  min="0"
                  step="0.1"
                  defaultValue="0"
                />
              </label>
            </div>
            <label>
              最低库存
              <input
                name="reorderPoint"
                type="number"
                min="0"
                step="0.1"
                defaultValue="0"
              />
            </label>
            <BatchFields title="初始库存批次（可选）" />
            <label>
              存放地点
              <select
                name="locationId"
                defaultValue={prefillLocationId || locations[0]?.id || ""}
              >
                <option value="">暂不指定</option>
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
              {busy ? "保存中…" : "保存物资"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
