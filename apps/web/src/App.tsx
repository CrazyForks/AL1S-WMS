import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, Bell, Check, ClipboardList, Home, Plus, Search, SlidersHorizontal, X } from "lucide-react";

type Item = {
  id: string;
  homeId: string;
  sku: string;
  name: string;
  baseUnit: string;
  reorderPoint: number;
  reorderQuantity: number;
  active: boolean;
};
type Stock = { itemId: string; locationId: string; quantity: number };
type Location = { id: string; homeId: string; name: string; active: boolean };

const fallbackHomeId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const getHomeId = () => localStorage.getItem("family-erp-home-id") ?? fallbackHomeId;

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

function Setup({ onComplete }: { onComplete: (home: { id: string; name: string }) => void }) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [homeName, setHomeName] = useState("");
  const [homeEmoji, setHomeEmoji] = useState("🏠");
  const [locations, setLocations] = useState(["储物间", "厨房"]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canNext = step === 1 ? username.trim().length >= 2 && password.length >= 8 : step === 2 ? homeName.trim().length > 0 : locations.some((name) => name.trim());
  const submit = async () => {
    if (!canNext) return;
    if (step < 3) { setStep(step + 1); return; }
    setBusy(true); setError("");
    const response = await fetch("/api/v1/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, homeName, homeEmoji, locations }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.message ?? "初始化失败，请检查输入"); return; }
    localStorage.setItem("family-erp-home-id", data.home.id); localStorage.setItem("family-erp-home-emoji", homeEmoji); onComplete(data.home);
  };
  return <div className="setup-shell"><div className="setup-card"><div className="setup-brand"><span className="brand-mark" role="img" aria-label="家庭">{homeEmoji}</span><div><strong>家庭物资</strong><span>首次启动设置</span></div></div><div className="setup-progress"><span className={step >= 1 ? "active" : ""}>1 账号</span><i /><span className={step >= 2 ? "active" : ""}>2 家庭</span><i /><span className={step >= 3 ? "active" : ""}>3 地点</span></div>{step === 1 && <div className="setup-step"><p className="eyebrow">建立本地管理员</p><h1>先创建你的账号</h1><p className="muted">账号只保存在这台家庭 ERP 中，用于管理成员和敏感操作。</p><label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="例如：主人" autoFocus /></label><label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="至少 8 位" /></label></div>}{step === 2 && <div className="setup-step"><p className="eyebrow">建立你的 Home</p><h1>这个家庭怎么称呼？</h1><p className="muted">Home 是物资、成员、地点和预算的共同边界。</p><label>家庭名称<input value={homeName} onChange={(event) => setHomeName(event.target.value)} placeholder="例如：我们家" autoFocus /></label><label className="emoji-field">家庭 Emoji<input value={homeEmoji} onChange={(event) => setHomeEmoji(event.target.value.slice(0, 2))} placeholder="🏠" maxLength={2} /></label><label>默认货币<select defaultValue="CNY"><option value="CNY">人民币（CNY）</option><option value="USD">美元（USD）</option></select></label></div>}{step === 3 && <div className="setup-step"><p className="eyebrow">整理空间</p><h1>先添加几个存放地点</h1><p className="muted">之后可以继续增加。地点帮助你知道物资放在哪里。</p><div className="location-inputs">{locations.map((name, index) => <div className="location-input" key={index}><input value={name} onChange={(event) => setLocations(locations.map((value, i) => i === index ? event.target.value : value))} placeholder="例如：储物间" /><button type="button" onClick={() => setLocations(locations.filter((_, i) => i !== index))} aria-label="删除地点">×</button></div>)}</div><button className="add-location" type="button" onClick={() => setLocations([...locations, ""])}>＋ 添加另一个地点</button></div>}{error && <div className="setup-error">{error}</div>}<div className="setup-footer">{step > 1 ? <button className="secondary" onClick={() => setStep(step - 1)}>上一步</button> : <span /> }<button className="primary" disabled={!canNext || busy} onClick={submit}>{busy ? "创建中…" : step === 3 ? "完成设置，进入 Dashboard" : "继续"}</button></div></div></div>;
}

export function App() {
  const [setup, setSetup] = useState<{ complete: boolean; home?: { id: string; name: string } } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([getItems(), getStock(), getLocations()]).then(([nextItems, nextStock, nextLocations]) => { setItems(nextItems); setStock(nextStock); setLocations(nextLocations); }).catch((error) => setNotice(error.message));
  useEffect(() => { fetch("/api/v1/setup/status").then((response) => response.json()).then((data) => { setSetup(data); if (data.home?.id) localStorage.setItem("family-erp-home-id", data.home.id); }).catch(() => setSetup({ complete: false })); }, []);
  useEffect(() => { if (setup?.complete) load(); }, [setup?.complete]);
  const filtered = useMemo(() => items.filter((item) => `${item.name} ${item.sku}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const balanceFor = (itemId: string) => stock.filter((row) => row.itemId === itemId).reduce((total, row) => total + row.quantity, 0);
  const lowStock = items.filter((item) => item.reorderPoint > 0 && balanceFor(item.id) <= item.reorderPoint).length;
  if (!setup) return <div className="loading-screen">正在检查家庭设置…</div>;
  if (!setup.complete) return <Setup onComplete={(home) => setSetup({ complete: true, home })} />;

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/v1/homes/${getHomeId()}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku: data.get("sku"), name: data.get("name"), baseUnit: data.get("baseUnit"),
        reorderPoint: Number(data.get("reorderPoint") || 0), reorderQuantity: Number(data.get("reorderQuantity") || 1)
      })
    });
    setBusy(false);
    if (!response.ok) { setNotice("保存失败，请检查填写内容"); return; }
    event.currentTarget.reset();
    setShowForm(false);
    setNotice("物资已添加");
    load();
  }

  async function recordStock(type: "receipt" | "issue", item: Item) {
    const quantity = Number(window.prompt(`${type === "receipt" ? "入库" : "领用"}数量`, "1"));
    if (!quantity || quantity <= 0) return;
    const response = await fetch(`/api/v1/homes/${getHomeId()}/stock/${type}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: item.id, locationId: locations[0]?.id ?? locationId, quantity, idempotencyKey: crypto.randomUUID(), reason: "Dashboard 操作" })
    });
    setNotice(response.ok ? `${item.name} 已${type === "receipt" ? "入库" : "领用"}` : "操作失败，可能是库存不足");
  }

  return <div className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark" role="img" aria-label="家庭">{localStorage.getItem("family-erp-home-emoji") || "🏠"}</span><div><strong>家庭物资</strong><span>Home inventory</span></div></div>
      <div className="home-switch"><span className="status-dot" />我的家庭 <span className="chevron">⌄</span></div>
      <div className="top-actions"><button className="icon-button" title="通知" aria-label="通知"><Bell size={17} strokeWidth={1.8} /></button><span className="avatar">我</span></div>
    </header>
    <main>
      <section className="welcome"><div><p className="eyebrow">周三 · 9 月 16 日</p><h1>家庭物资总览</h1><p className="muted">掌握家里有什么，及时补充需要的东西。</p></div><button className="primary" onClick={() => setShowForm(true)}>＋ 添加物资</button></section>
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="关闭">×</button></div>}
      <section className="summary-grid">
        <div className="summary-card"><span className="summary-label">物资总数</span><strong>{items.length}</strong><span className="summary-foot">当前家庭物资</span></div>
        <div className="summary-card warning"><span className="summary-label">需要补充</span><strong>{lowStock}</strong><span className="summary-foot">按实际库存余额</span></div>
        <div className="summary-card"><span className="summary-label">即将到期</span><strong>0</strong><span className="summary-foot">未来 30 天</span></div>
        <div className="summary-card budget"><span className="summary-label">本月采购</span><strong>¥0</strong><span className="summary-foot">预算暂未设置</span></div>
      </section>
      <section className="content-grid">
        <div className="panel inventory-panel">
          <div className="panel-head"><div><h2>物资清单</h2><p className="muted">按名称或编码快速查找</p></div><div className="panel-tools"><label className="search"><Search size={16} strokeWidth={1.8} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索物资" /></label><button className="filter"><SlidersHorizontal size={15} strokeWidth={1.8} /> 筛选</button></div></div>
          <div className="table-wrap"><table><thead><tr><th>物资</th><th>分类编码</th><th>当前库存</th><th>操作</th></tr></thead><tbody>{filtered.length === 0 ? <tr><td colSpan={4} className="empty">还没有物资，先添加一项常用物品。</td></tr> : filtered.map((item) => <tr key={item.id}><td><div className="item-name"><span className="item-icon">{item.name.slice(0, 1)}</span><div><strong>{item.name}</strong><span>{item.baseUnit}</span></div></div></td><td><code>{item.sku}</code></td><td>{balanceFor(item.id)} {item.baseUnit}{item.reorderPoint > 0 && balanceFor(item.id) <= item.reorderPoint ? " · 需补充" : ""}</td><td><div className="row-actions"><button onClick={() => recordStock("receipt", item)}>入库</button><button onClick={() => recordStock("issue", item)}>领用</button></div></td></tr>)}</tbody></table></div>
        </div>
        <aside className="side-column"><div className="panel quick-panel"><div className="panel-head"><div><h2>快捷操作</h2><p className="muted">常用的家庭整理动作</p></div></div><button className="quick-action" onClick={() => setShowForm(true)}><span className="quick-icon blue"><Plus size={16} strokeWidth={2} /></span><span><strong>添加新物资</strong><small>登记家里新增的物品</small></span><ArrowRight size={15} strokeWidth={1.8} /></button><button className="quick-action"><span className="quick-icon green"><Check size={16} strokeWidth={2} /></span><span><strong>开始盘点</strong><small>核对一个地点的实际库存</small></span><ArrowRight size={15} strokeWidth={1.8} /></button><button className="quick-action"><span className="quick-icon amber"><ClipboardList size={16} strokeWidth={1.8} /></span><span><strong>查看采购清单</strong><small>整理需要购买的物品</small></span><ArrowRight size={15} strokeWidth={1.8} /></button></div><div className="panel locations"><div className="panel-head"><div><h2>存放地点</h2><p className="muted">按空间整理物资</p></div><button className="text-button">管理</button></div>{locations.map((location) => <div className="location-row" key={location.id}><Home size={15} strokeWidth={1.8} className="location-icon" /><span>{location.name}</span><strong>{stock.filter((row) => row.locationId === location.id).reduce((sum, row) => sum + row.quantity, 0)}</strong></div>)}</div></aside>
      </section>
    </main>
    {showForm && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowForm(false)}><form className="modal" onSubmit={addItem}><div className="modal-head"><div><h2>添加物资</h2><p className="muted">先登记名称和基本补货规则</p></div><button type="button" className="close" onClick={() => setShowForm(false)} aria-label="关闭"><X size={18} strokeWidth={1.8} /></button></div><label>物资名称<input name="name" required placeholder="例如：洗衣液" /></label><label>编码<input name="sku" required placeholder="例如：CLEAN-001" /></label><div className="form-row"><label>单位<input name="baseUnit" required defaultValue="个" /></label><label>最低库存<input name="reorderPoint" type="number" min="0" step="0.1" defaultValue="0" /></label></div><label>建议补充量<input name="reorderQuantity" type="number" min="0.1" step="0.1" defaultValue="1" /></label><button className="primary full" disabled={busy}>{busy ? "保存中…" : "保存物资"}</button></form></div>}
  </div>;
}
