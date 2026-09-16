import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Bell, Check, ClipboardList, Home, Plus, Search, SlidersHorizontal, X } from "lucide-react";

type Item = {
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
type Location = { id: string; homeId: string; name: string; active: boolean };
type Category = { id: string; parentId: string | null; name: string; isSystem: boolean; active: boolean };
type Transaction = { id: string; itemName: string; locationName: string; type: "receipt" | "issue"; quantity: number; reason?: string | null; occurredAt: string };

const fallbackHomeId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const getHomeId = () => localStorage.getItem("family-erp-home-id") ?? fallbackHomeId;
const itemCategories = ["食品", "饮品", "日用品", "药品与健康", "衣物", "工具", "电器", "文具", "宠物用品", "其他"];
const newIdempotencyKey = () => globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function addShelfLife(date: string, amountText: string, unit: string) {
  if (!date || !amountText || !unit) return undefined;
  const result = new Date(`${date}T00:00:00`);
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  if (unit === "day") result.setDate(result.getDate() + amount);
  if (unit === "month") result.setMonth(result.getMonth() + amount);
  if (unit === "year") result.setFullYear(result.getFullYear() + amount);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}`;
}

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
async function getTransactions() {
  const response = await fetch(`/api/v1/homes/${getHomeId()}/transactions`);
  if (!response.ok) throw new Error("无法加载变动记录");
  return response.json() as Promise<Transaction[]>;
}
async function getCategories() {
  const response = await fetch(`/api/v1/homes/${getHomeId()}/categories`);
  if (!response.ok) throw new Error("无法加载物资类型");
  return response.json() as Promise<Category[]>;
}

function Setup({ onComplete }: { onComplete: (home: { id: string; name: string; icon: string }) => void }) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [homeName, setHomeName] = useState("");
  const [homeEmoji, setHomeEmoji] = useState("🏠");
  const [currency, setCurrency] = useState("CNY");
  const homeIcons = ["🏠", "🏡", "🏢", "🏘️", "🌿", "⭐"];
  const [locations, setLocations] = useState(["储物间", "厨房"]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const canNext = step === 1 ? username.trim().length >= 2 && password.length >= 8 : step === 2 ? homeName.trim().length > 0 : locations.some((name) => name.trim());
  const submit = async () => {
    if (!canNext) return;
    if (step < 3) { setStep(step + 1); return; }
    setBusy(true); setError("");
    const response = await fetch("/api/v1/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, homeName, homeIcon: homeEmoji, currency, locations }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.message ?? "初始化失败，请检查输入"); return; }
    localStorage.setItem("family-erp-home-id", data.home.id); localStorage.setItem("family-erp-home-emoji", homeEmoji); onComplete(data.home);
  };
  return <div className="setup-shell"><div className="setup-card"><div className="setup-brand"><span className="brand-mark" role="img" aria-label="家庭">{homeEmoji}</span><div><strong>AL1S-ERP</strong><span>首次启动设置</span></div></div><div className="setup-progress"><span className={step >= 1 ? "active" : ""}>1 账号</span><i /><span className={step >= 2 ? "active" : ""}>2 家庭</span><i /><span className={step >= 3 ? "active" : ""}>3 地点</span></div>{step === 1 && <div className="setup-step"><p className="eyebrow">建立本地管理员</p><h1>先创建你的账号</h1><p className="muted">账号只保存在这台 AL1S-ERP 中，用于管理成员和敏感操作。</p><label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus /></label><label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" /></label></div>}{step === 2 && <div className="setup-step"><p className="eyebrow">建立你的 Home</p><h1>这个家庭怎么称呼？</h1><p className="muted">Home 是物资、成员、地点和预算的共同边界。</p><label>家庭名称<input value={homeName} onChange={(event) => setHomeName(event.target.value)} placeholder="例如：我们家" autoFocus /></label><label>家庭图标<div className="icon-options">{homeIcons.map((icon) => <button type="button" className={homeEmoji === icon ? "selected" : ""} onClick={() => setHomeEmoji(icon)} key={icon}>{icon}</button>)}</div></label><label>默认货币<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="CNY">人民币（CNY）</option><option value="USD">美元（USD）</option></select></label></div>}{step === 3 && <div className="setup-step"><p className="eyebrow">整理空间</p><h1>先添加几个存放地点</h1><p className="muted">之后可以继续增加。地点帮助你知道物资放在哪里。</p><div className="location-inputs">{locations.map((name, index) => <div className="location-input" key={index}><input value={name} onChange={(event) => setLocations(locations.map((value, i) => i === index ? event.target.value : value))} placeholder="例如：储物间" /><button type="button" onClick={() => setLocations(locations.filter((_, i) => i !== index))} aria-label="删除地点">×</button></div>)}</div><button className="add-location" type="button" onClick={() => setLocations([...locations, ""])}>＋ 添加另一个地点</button></div>}{error && <div className="setup-error">{error}</div>}<div className="setup-footer">{step > 1 ? <button className="secondary" onClick={() => setStep(step - 1)}>上一步</button> : <span /> }<button className="primary" disabled={!canNext || busy} onClick={submit}>{busy ? "创建中…" : step === 3 ? "完成设置，进入 Dashboard" : "继续"}</button></div></div></div>;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); const data = await response.json(); setBusy(false); if (!response.ok) { setError(data.message ?? "登录失败"); return; } onLogin(); };
  return <div className="setup-shell"><form className="setup-card login-card" onSubmit={submit}><div className="setup-brand"><span className="brand-mark">🏠</span><div><strong>AL1S-ERP</strong><span>登录你的家庭</span></div></div><div className="setup-step"><p className="eyebrow">欢迎回来</p><h1>登录</h1><p className="muted">使用初始化时创建的管理员账号继续。</p><label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus /></label><label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" /></label></div>{error && <div className="setup-error">{error}</div>}<button className="primary full" disabled={busy}>{busy ? "登录中…" : "登录"}</button></form></div>;
}

export function App() {
  const [setup, setSetup] = useState<{ complete: boolean; home?: { id: string; name: string; icon?: string } } | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stockAction, setStockAction] = useState<{ type: "receipt" | "issue"; item: Item } | null>(null);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [locationFilter, setLocationFilter] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  const [countView, setCountView] = useState(false);
  const [treeMode, setTreeMode] = useState<"location" | "category">("location");
  const [prefillLocationId, setPrefillLocationId] = useState("");
  const [prefillCategory, setPrefillCategory] = useState("");
  const [categoryManager, setCategoryManager] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryParent, setCategoryParent] = useState("");
  const [activePage, setActivePage] = useState<"home" | "count" | "locations" | "categories">("home");
  const [expandedLocations, setExpandedLocations] = useState<Record<string, boolean>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const itemCategories = categories.length ? categories.map((category) => category.name) : ["食品", "饮品", "日用品", "药品与健康", "衣物", "工具", "电器", "文具", "宠物用品", "其他"];
  const [logView, setLogView] = useState(false);

  const load = () => Promise.all([getItems(), getStock(), getLocations(), getTransactions(), getCategories()]).then(([nextItems, nextStock, nextLocations, nextTransactions, nextCategories]) => { setItems(nextItems); setStock(nextStock); setLocations(nextLocations); setTransactions(nextTransactions); setCategories(nextCategories); }).catch((error) => setNotice(error.message));
  useEffect(() => { fetch("/api/v1/setup/status").then((response) => response.json()).then((data) => { setSetup(data); if (data.home?.id) localStorage.setItem("family-erp-home-id", data.home.id); if (data.complete) fetch("/api/v1/auth/me").then((response) => setAuthenticated(response.ok)); }).catch(() => setSetup({ complete: false })); }, []);
  useEffect(() => { if (setup?.complete) load(); }, [setup?.complete]);
  const balanceFor = (itemId: string) => stock.filter((row) => row.itemId === itemId).reduce((total, row) => total + row.quantity, 0);
  const replenishmentFor = (item: Item) => Math.max(item.reorderPoint - balanceFor(item.id), 0);
  const filtered = useMemo(() => items.filter((item) => {
    if (!`${item.name} ${item.sku}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (locationFilter && item.locationId !== locationFilter) return false;
    if (lowStockOnly && replenishmentFor(item) <= 0) return false;
    if (expiringOnly && (!item.expiryDate || item.expiryDate > new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))) return false;
    return true;
  }), [items, query, locationFilter, lowStockOnly, expiringOnly, stock]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const pagedItems = filtered.slice((page - 1) * 10, page * 10);
  const pageStart = filtered.length ? (page - 1) * 10 + 1 : 0;
  const pageEnd = Math.min(page * 10, filtered.length);
  useEffect(() => { setPage(1); }, [query]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  const lowStock = items.filter((item) => replenishmentFor(item) > 0).length;
  if (!setup) return <div className="loading-screen">正在检查家庭设置…</div>;
  if (!setup.complete) return <Setup onComplete={(home) => { setAuthenticated(true); setSetup({ complete: true, home }); }} />;
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
        name: data.get("name"), category: data.get("category"), baseUnit: data.get("baseUnit"), locationId: data.get("locationId") || undefined,
        reorderPoint: Number(data.get("reorderPoint") || 0), reorderQuantity: 0, initialStock: Number(data.get("initialStock") || 0), manufacturedDate: data.get("manufacturedDate") || undefined, expiryDate: addShelfLife(String(data.get("manufacturedDate") || ""), String(data.get("shelfLifeValue") || ""), String(data.get("shelfLifeUnit") || ""))
      })
    });
    setBusy(false);
    if (!response.ok) { const result = await response.json().catch(() => ({})); setNotice(result.message || "保存失败，请检查填写内容"); return; }
    form.reset();
    setShowForm(false);
    setPrefillLocationId(""); setPrefillCategory("");
    load();
  }

  async function recordStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!stockAction) return;
    const data = new FormData(event.currentTarget); const quantity = Number(data.get("quantity")); const selectedLocation = String(data.get("locationId") || locations[0]?.id || locationId); if (!quantity || quantity <= 0) return;
    const response = await fetch(`/api/v1/homes/${getHomeId()}/stock/${stockAction.type}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: stockAction.item.id, locationId: selectedLocation, quantity, idempotencyKey: newIdempotencyKey(), reason: data.get("reason") || "Dashboard 操作" })
    });
    if (response.ok) { setStockAction(null); load(); } else setNotice("操作失败，可能是库存不足");
  }

  async function updateItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detailItem) return;
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/v1/homes/${getHomeId()}/items/${detailItem.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: data.get("name"), category: data.get("category"), baseUnit: data.get("baseUnit"), reorderPoint: Number(data.get("reorderPoint") || 0), locationId: data.get("locationId") || null, manufacturedDate: data.get("manufacturedDate") || null, expiryDate: data.get("expiryDate") || null }) });
    if (!response.ok) { setNotice("保存失败，请检查填写内容"); return; }
    setDetailItem(null); load();
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/v1/homes/${getHomeId()}/categories`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: categoryName.trim(), parentId: categoryParent || undefined }) });
    if (!response.ok) { setNotice("分类添加失败"); return; }
    setCategoryName(""); setCategoryParent(""); setCategoryManager(false); load();
  }
  function navigate(page: "home" | "count" | "locations" | "categories") {
    setActivePage(page); setLogView(false); setCountView(page === "locations" || page === "categories");
    if (page === "locations") setTreeMode("location");
    if (page === "categories") { setTreeMode("category"); setCategoryManager(true); }
  }

  return <div className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark" role="img" aria-label="家庭">{setup.home?.icon || localStorage.getItem("family-erp-home-emoji") || "🏠"}</span><div><strong>{setup.home?.name || "家庭"}</strong><span>Home inventory</span></div></div>
      <div className="home-switch"><span className="status-dot" />{setup.home?.name || "家庭"} <span className="chevron">⌄</span></div>
      <nav className="main-nav" aria-label="主导航"><button className={activePage === "home" ? "active" : ""} onClick={() => navigate("home")}>首页</button><button className={activePage === "count" ? "active" : ""} onClick={() => navigate("count")}>盘点</button><button className={activePage === "locations" ? "active" : ""} onClick={() => navigate("locations")}>地点</button><button className={activePage === "categories" ? "active" : ""} onClick={() => navigate("categories")}>分类</button></nav>
      <div className="top-actions"><button className="icon-button" title="通知" aria-label="通知"><Bell size={17} strokeWidth={1.8} /></button><span className="avatar">我</span></div>
    </header>
    <main>
      <section className="welcome"><div><p className="eyebrow">周三 · 9 月 16 日</p><h1>{activePage === "home" ? "AL1S-ERP总览" : activePage === "count" ? "物资盘点" : activePage === "locations" ? "地点" : "分类"}</h1><p className="muted">{activePage === "home" ? "掌握家里有什么，及时补充需要的东西。" : "按不同维度组织和管理家庭物资。"}</p></div>{activePage !== "categories" && <button className="primary" onClick={() => setShowForm(true)}>＋ 添加物资</button>}</section>
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="关闭">×</button></div>}
      {categoryManager && <section className="panel category-manager"><div className="panel-head"><div><h2>分类管理</h2><p className="muted">新增一级分类或子分类</p></div><button className="text-button" onClick={() => setCategoryManager(false)}>关闭</button></div><form className="category-form" onSubmit={addCategory}><input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="分类名称" required /><select value={categoryParent} onChange={(event) => setCategoryParent(event.target.value)}><option value="">一级分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><button className="primary">添加分类</button></form></section>}
      {activePage === "home" && <section className="summary-grid">
        <div className="summary-card"><span className="summary-label">物资总数</span><strong>{items.length}</strong><span className="summary-foot">当前AL1S-ERP</span></div>
        <div className="summary-card warning"><span className="summary-label">需要补充</span><strong>{lowStock}</strong><span className="summary-foot">按实际库存余额</span></div>
        <div className="summary-card"><span className="summary-label">即将到期</span><strong>0</strong><span className="summary-foot">未来 30 天</span></div>
        <div className="summary-card budget"><span className="summary-label">本月采购</span><strong>¥0</strong><span className="summary-foot">预算暂未设置</span></div>
      </section>}
      {!logView && <section className="panel recent-log"><div className="panel-head"><div><h2>最近变动</h2><p className="muted">最近 10 条库存流水</p></div><button className="text-button" onClick={() => setLogView(true)}>查看全部</button></div>{transactions.slice(0, 10).length === 0 ? <p className="empty">暂无库存变动</p> : <div className="log-list">{transactions.slice(0, 10).map((transaction) => <div className="log-row" key={transaction.id}><span className={`log-badge ${transaction.type}`}>{transaction.type === "receipt" ? "+" : "−"}</span><div><strong>{transaction.itemName}</strong><small>{transaction.locationName} · {transaction.reason || "库存调整"}</small></div><b className={transaction.type}>{transaction.type === "receipt" ? "+" : "−"}{transaction.quantity}</b><time>{new Date(transaction.occurredAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div>)}</div>}</section>}
      {!countView && !logView && <section className="content-grid">
        <div className="panel inventory-panel">
          <div className="panel-head"><div><h2>物资清单</h2><p className="muted">按名称快速查找</p></div><div className="panel-tools"><label className="search"><Search size={16} strokeWidth={1.8} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索物资" /></label><button className="filter" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={15} strokeWidth={1.8} /> 筛选</button></div></div>
          {showFilters && <div className="filter-bar"><label>地点<select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="">全部地点</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="check-filter"><input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} /> 仅看需补充</label><label className="check-filter"><input type="checkbox" checked={expiringOnly} onChange={(event) => setExpiringOnly(event.target.checked)} /> 未来 30 天到期</label></div>}
          <div className="table-wrap"><table><thead><tr><th>物资</th><th>库存</th><th>位置</th><th>操作</th></tr></thead><tbody>{filtered.length === 0 ? <tr><td colSpan={4} className="empty">还没有物资，先添加一项常用物品。</td></tr> : pagedItems.map((item) => <tr key={item.id}><td><div className="item-name"><span className="item-icon">{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><span>{item.baseUnit}</span></div></div></td><td>{balanceFor(item.id)} {item.baseUnit}{replenishmentFor(item) > 0 ? ` · 建议补充 ${replenishmentFor(item)} ${item.baseUnit}` : ""}</td><td>{item.locationName || "未指定"}</td><td><div className="row-actions"><button onClick={() => setStockAction({ type: "receipt", item })}>入库</button><button onClick={() => setStockAction({ type: "issue", item })}>领用</button><button onClick={() => setDetailItem(item)}>编辑</button></div></td></tr>)}</tbody></table></div>
          {filtered.length > 0 && <div className="pagination"><span>{pageStart}–{pageEnd} / 共 {filtered.length} 项</span><button type="button" aria-label="上一页" title="上一页" disabled={page === 1} onClick={() => setPage(page - 1)}><ArrowLeft size={15} /></button><span>{page} / {pageCount}</span><button type="button" aria-label="下一页" title="下一页" disabled={page === pageCount} onClick={() => setPage(page + 1)}><ArrowRight size={15} /></button></div>}
        </div>
        <aside className="side-column"><div className="panel quick-panel"><div className="panel-head"><div><h2>快捷操作</h2><p className="muted">常用的家庭整理动作</p></div></div><button className="quick-action" onClick={() => setShowForm(true)}><span className="quick-icon blue"><Plus size={16} strokeWidth={2} /></span><span><strong>添加新物资</strong><small>登记家里新增的物品</small></span><ArrowRight size={15} strokeWidth={1.8} /></button><button className="quick-action" onClick={() => setCountView(true)}><span className="quick-icon green"><Check size={16} strokeWidth={2} /></span><span><strong>开始盘点</strong><small>核对一个地点的实际库存</small></span><ArrowRight size={15} strokeWidth={1.8} /></button><button className="quick-action"><span className="quick-icon amber"><ClipboardList size={16} strokeWidth={1.8} /></span><span><strong>查看采购清单</strong><small>整理需要购买的物品</small></span><ArrowRight size={15} strokeWidth={1.8} /></button></div><div className="panel locations"><div className="panel-head"><div><h2>存放地点</h2><p className="muted">按空间整理物资</p></div><button className="text-button">管理</button></div>{locations.map((location) => <div className="location-row" key={location.id}><Home size={15} strokeWidth={1.8} className="location-icon" /><span>{location.name}</span></div>)}</div></aside>
      </section>}
      {countView && <section className="panel count-panel"><div className="panel-head"><div><h2>{treeMode === "location" ? "地点盘点" : "分类盘点"}</h2><p className="muted">展开节点，核对实际库存</p></div><div className="panel-tools"><button className={treeMode === "location" ? "filter active" : "filter"} onClick={() => setTreeMode("location")}>按地点</button><button className={treeMode === "category" ? "filter active" : "filter"} onClick={() => setTreeMode("category")}>按分类</button><button className="text-button" onClick={() => setCountView(false)}>返回清单</button></div></div>{(treeMode === "location" ? locations.map((location) => ({ id: location.id, name: location.name, items: items.filter((item) => item.locationId === location.id), prefill: () => { setPrefillLocationId(location.id); setPrefillCategory(""); setShowForm(true); } })) : categories.map((category) => ({ id: category.id, name: category.name, items: items.filter((item) => item.category === category.name), prefill: () => { setPrefillLocationId(""); setPrefillCategory(category.name); setShowForm(true); } }))).map((node) => { const open = expandedLocations[node.id] ?? true; return <div className="count-location" key={node.id}><div className="count-location-head"><button className="tree-toggle" onClick={() => setExpandedLocations({ ...expandedLocations, [node.id]: !open })}>{open ? "⌄" : "›"} {node.name}</button><button className="node-add" onClick={node.prefill} title="在此节点添加物资"><Plus size={15} /></button></div>{open && node.items.map((item) => <div className="count-item" key={item.id}><span>{item.name}</span><span>{balanceFor(item.id)} {item.baseUnit}</span><button className="text-button" onClick={() => setDetailItem(item)}>编辑</button></div>)}</div>; })}</section>}
      {logView && <section className="panel full-log"><div className="panel-head"><div><h2>完整变动日志</h2><p className="muted">按时间倒序记录库存变动</p></div><button className="text-button" onClick={() => setLogView(false)}>返回总览</button></div><div className="log-list">{transactions.length === 0 ? <p className="empty">暂无库存变动</p> : transactions.map((transaction) => <div className="log-row" key={transaction.id}><span className={`log-badge ${transaction.type}`}>{transaction.type === "receipt" ? "+" : "−"}</span><div><strong>{transaction.itemName}</strong><small>{transaction.locationName} · {transaction.reason || "库存调整"}</small></div><b className={transaction.type}>{transaction.type === "receipt" ? "+" : "−"}{transaction.quantity}</b><time>{new Date(transaction.occurredAt).toLocaleString("zh-CN")}</time></div>)}</div></section>}
    </main>
    {detailItem && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDetailItem(null)}><form className="modal" onSubmit={updateItem}><div className="modal-head"><div><h2>编辑物资</h2><p className="muted">{detailItem.name}</p></div><button type="button" className="close" onClick={() => setDetailItem(null)} aria-label="关闭"><X size={18} strokeWidth={1.8} /></button></div><label>物资名称<input name="name" required defaultValue={detailItem.name} /></label><label>类型<select name="category" defaultValue={detailItem.category}>{itemCategories.map((category) => <option key={category}>{category}</option>)}</select></label><div className="form-row"><label>单位<input name="baseUnit" required defaultValue={detailItem.baseUnit} /></label><label>最低库存<input name="reorderPoint" type="number" min="0" step="0.1" defaultValue={detailItem.reorderPoint} /></label></div><div className="form-row"><label>生产日期<input name="manufacturedDate" type="date" defaultValue={detailItem.manufacturedDate || ""} /></label><label>保质期至<input name="expiryDate" type="date" defaultValue={detailItem.expiryDate || ""} /></label></div><label>存放地点<select name="locationId" defaultValue={detailItem.locationId || ""}><option value="">暂不指定</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><button className="primary full">保存修改</button></form></div>}
    {stockAction && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setStockAction(null)}><form className="modal" onSubmit={recordStock}><div className="modal-head"><div><h2>{stockAction.type === "receipt" ? "入库物资" : "领用物资"}</h2><p className="muted">{stockAction.item.name}</p></div><button type="button" className="close" onClick={() => setStockAction(null)} aria-label="关闭"><X size={18} strokeWidth={1.8} /></button></div><label>存放地点<select name="locationId" defaultValue={stockAction.item.locationId || locations[0]?.id || ""}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>数量<input name="quantity" type="number" min="0.1" step="0.1" defaultValue="1" autoFocus required /></label><label>备注（可选）<input name="reason" placeholder="例如：本周采购" /></label><button className="primary full">确认{stockAction.type === "receipt" ? "入库" : "领用"}</button></form></div>}
    {showForm && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowForm(false)}><form className="modal" onSubmit={addItem}><div className="modal-head"><div><h2>添加物资</h2><p className="muted">登记名称、当前库存和补充规则</p></div><button type="button" className="close" onClick={() => setShowForm(false)} aria-label="关闭"><X size={18} strokeWidth={1.8} /></button></div><label>物资名称<input name="name" required placeholder="例如：洗衣液" /></label><label>类型<select name="category" defaultValue="其他">{itemCategories.map((category) => <option key={category}>{category}</option>)}</select></label><div className="form-row"><label>单位<select name="baseUnit" defaultValue="个"><option>个</option><option>瓶</option><option>盒</option><option>包</option><option>箱</option><option>袋</option><option>千克</option><option>升</option><option>米</option><option>其他</option></select></label><label>库存<input name="initialStock" type="number" min="0" step="0.1" defaultValue="0" /></label></div><label>最低库存<input name="reorderPoint" type="number" min="0" step="0.1" defaultValue="0" /></label><div className="form-row"><label>生产日期（可选）<input name="manufacturedDate" type="date" /></label><label>保质期（可选）<div className="form-row"><input name="shelfLifeValue" type="number" min="1" step="1" placeholder="时长" /><select name="shelfLifeUnit" defaultValue="day"><option value="day">天</option><option value="month">月</option><option value="year">年</option></select></div></label></div><label>存放地点<select name="locationId" defaultValue={locations[0]?.id || ""}><option value="">暂不指定</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><button className="primary full" disabled={busy}>{busy ? "保存中…" : "保存物资"}</button></form></div>}
  </div>;
}
