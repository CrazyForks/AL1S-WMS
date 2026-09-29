/* Bundled AL1S inventory card: no external libraries or API credentials. */
const CARD = "al1s-inventory-card";
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const language = (hass) => String(hass?.locale?.language || hass?.language || "en").startsWith("zh");
const words = (zh) => zh ? {
  title: "家庭库存", attention: "库存提醒", opened: "使用中", item: "物资", quantity: "数量", location: "地点", status: "状态", detail: "详情", openedAt: "开封日", expiry: "到期日", all: "全部", empty: "当前没有需要关注的库存", noOpened: "没有使用中的物资", unavailable: "库存数据暂不可用", missing: "未找到 AL1S 明细实体，请更新集成并重启 Home Assistant", unset: "未设置", noLocation: "未指定地点", buy: "建议补", threshold: "阈值", remaining: "天后到期", overdue: "天前过期", today: "今天到期", household: "家庭", customTitle: "标题（可选）", showAttention: "显示库存提醒", showOpened: "显示使用中物资", statuses: { out_of_stock: "缺货", low_stock: "不足", critical: "临界", expiring: "临期", expired: "过期" },
} : {
  title: "Household inventory", attention: "Inventory attention", opened: "In use", item: "Item", quantity: "Quantity", location: "Location", status: "Status", detail: "Details", openedAt: "Opened", expiry: "Expires", all: "All", empty: "No inventory needs attention", noOpened: "No items in use", unavailable: "Inventory data is unavailable", missing: "AL1S detail entities not found. Update the integration and restart Home Assistant", unset: "Not set", noLocation: "No location", buy: "Buy", threshold: "Threshold", remaining: "days left", overdue: "days overdue", today: "Expires today", household: "Household", customTitle: "Title (optional)", showAttention: "Show inventory attention", showOpened: "Show items in use", statuses: { out_of_stock: "Out of stock", low_stock: "Low stock", critical: "At threshold", expiring: "Expiring", expired: "Expired" },
};
const households = (hass) => Object.values(hass?.states || {}).filter((entity) => entity.attributes.integration === "al1s_wms" && entity.attributes.detail_type === "attention");
const stateFor = (hass, home, type) => Object.values(hass?.states || {}).find((entity) => entity.attributes.integration === "al1s_wms" && entity.attributes.household === home && entity.attributes.detail_type === type);
const isUnavailable = (entity) => !entity || ["unknown", "unavailable"].includes(entity.state);
const quantity = (row) => `${escape(row.quantity)} <span class="unit">${escape(row.unit)}</span>`;
const itemName = (row) => {
  try {
    const url = new URL(row.url);
    if (["http:", "https:"].includes(url.protocol)) return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(row.name)}</a>`;
  } catch { /* Render plain text for missing or invalid links. */ }
  return escape(row.name);
};
const STYLE = `
  :host{display:block;min-width:0}ha-card{overflow:hidden;color:var(--primary-text-color);background:var(--ha-card-background,var(--card-background-color));border-radius:var(--ha-card-border-radius,12px)}
  .header{padding:20px 20px 8px}h2{font-size:20px;font-weight:500;margin:0;line-height:1.4}.household{font-size:13px;color:var(--secondary-text-color);margin-top:4px}
  section{padding:16px 0}section+section{border-top:1px solid var(--divider-color)}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 20px 12px}h3{font-size:16px;font-weight:500;margin:0}.count{font-size:13px;color:var(--secondary-text-color);margin-inline-start:8px}
  select{background:var(--card-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px;max-width:50%}
  .scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}table{border-collapse:collapse;width:100%;font-size:14px;text-align:start}th{font-size:12px;font-weight:500;color:var(--secondary-text-color);white-space:nowrap}td,th{padding:10px 12px;border-bottom:1px solid var(--divider-color);vertical-align:top}td:first-child,th:first-child{padding-inline-start:20px}td:last-child,th:last-child{padding-inline-end:20px}tbody tr:last-child td{border-bottom:0}.number{text-align:end;white-space:nowrap}.unit,.meta{color:var(--secondary-text-color)}.meta{display:block;font-size:12px;line-height:1.6;margin-top:3px}a{color:var(--primary-text-color);text-decoration:none;border-bottom:1px dashed var(--secondary-text-color)}a:hover{color:var(--primary-color)}
  .badge{display:inline-block;border-radius:5px;padding:3px 6px;font-size:12px;white-space:nowrap;background:var(--secondary-background-color)}.out_of_stock,.expired{color:var(--error-color,#db4437)}.low_stock,.critical,.expiring{color:var(--warning-color,#a66b00)}.empty{padding:10px 20px;color:var(--secondary-text-color);font-size:14px}.notice{padding:16px 20px;color:var(--secondary-text-color)}
  @media(max-width:480px){.header{padding:16px 16px 4px}.section-head{padding:0 16px 10px}td,th{padding:9px 8px}td:first-child,th:first-child{padding-inline-start:16px}td:last-child,th:last-child{padding-inline-end:16px}.empty{padding:10px 16px}table{font-size:13px}}
`;

class AL1SInventoryCard extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); this._filter = "all"; }
  setConfig(config) {
    if (config.show_attention === false && config.show_opened === false) throw new Error("Enable at least one section");
    this._config = { show_attention: true, show_opened: true, ...config };
    this.render();
  }
  set hass(hass) { this._hass = hass; this.render(); }
  getCardSize() { return 6; }
  static getConfigElement() { return document.createElement(`${CARD}-editor`); }
  static getStubConfig(hass) { return { household: households(hass)[0]?.attributes.household, show_attention: true, show_opened: true }; }
  render() {
    if (!this._hass || !this._config) return;
    const w = words(language(this._hass));
    const homes = households(this._hass);
    const home = this._config.household || homes[0]?.attributes.household;
    const attention = stateFor(this._hass, home, "attention");
    const opened = stateFor(this._hass, home, "opened_details");
    const signature = [attention, opened, home, this._hass.locale?.language, this._hass.language, this._config.title, this._config.show_attention, this._config.show_opened, this._filter];
    if (this._signature && signature.every((value, index) => value === this._signature[index])) return;
    this._signature = signature;
    const title = this._config.title || w.title;
    const name = attention?.attributes.household_name || opened?.attributes.household_name || "";
    let content = `<div class="header"><h2>${escape(title)}</h2><div class="household">${escape(name)}</div></div>`;
    if ((!this._config.show_attention || !attention) && (!this._config.show_opened || !opened)) content += `<div class="notice">${escape(w.missing)}</div>`;
    else {
      if (this._config.show_attention) content += this.attentionTable(attention, w);
      if (this._config.show_opened) content += this.openedTable(opened, w);
    }
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>${content}</ha-card>`;
    this.shadowRoot.querySelector("select")?.addEventListener("change", (event) => { this._filter = event.target.value; this.render(); });
  }
  attentionTable(entity, w) {
    if (isUnavailable(entity)) return `<section><div class="section-head"><h3>${escape(w.attention)}</h3></div><div class="empty">${escape(w.unavailable)}</div></section>`;
    const allRows = entity.attributes.items || [];
    const rows = allRows.filter((row) => this._filter === "all" || row.status === this._filter);
    const options = [["all", w.all], ...Object.entries(w.statuses)].map(([key, label]) => `<option value="${key}"${key === this._filter ? " selected" : ""}>${escape(label)} (${key === "all" ? allRows.length : allRows.filter((row) => row.status === key).length})</option>`).join("");
    const body = rows.map((row) => {
      const detail = row.expiry_date ? `${escape(row.location || w.noLocation)}<span class="meta">${escape(row.expiry_date)} · ${escape(row.days_remaining < 0 ? `${-row.days_remaining} ${w.overdue}` : row.days_remaining === 0 ? w.today : `${row.days_remaining} ${w.remaining}`)}</span>` : `${escape(row.suggested_quantity > 0 ? w.buy : w.threshold)} ${escape(row.suggested_quantity > 0 ? row.suggested_quantity : row.reorder_point)} ${escape(row.unit)}`;
      return `<tr><td><span class="badge ${escape(row.status)}">${escape(w.statuses[row.status] || row.status)}</span></td><td>${itemName(row)}</td><td class="number">${quantity(row)}</td><td>${detail}</td></tr>`;
    }).join("");
    return `<section><div class="section-head"><h3>${escape(w.attention)}</h3><select aria-label="${escape(w.status)}">${options}</select></div>${rows.length ? `<div class="scroll"><table><thead><tr><th>${escape(w.status)}</th><th>${escape(w.item)}</th><th class="number">${escape(w.quantity)}</th><th>${escape(w.detail)}</th></tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty">${escape(w.empty)}</div>`}</section>`;
  }
  openedTable(entity, w) {
    if (isUnavailable(entity)) return `<section><div class="section-head"><h3>${escape(w.opened)}</h3></div><div class="empty">${escape(w.unavailable)}</div></section>`;
    const rows = entity.attributes.items || [];
    const body = rows.map((row) => `<tr><td>${itemName(row)}<span class="meta">${escape(w.openedAt)} ${escape(row.opened_at?.slice(0, 10) || w.unset)}</span></td><td class="number">${quantity(row)}</td><td>${escape(row.location || w.noLocation)}</td><td>${escape(row.expiry_date || w.unset)}</td></tr>`).join("");
    return `<section><div class="section-head"><h3>${escape(w.opened)}<span class="count">${rows.length}</span></h3></div>${rows.length ? `<div class="scroll"><table><thead><tr><th>${escape(w.item)}</th><th class="number">${escape(w.quantity)}</th><th>${escape(w.location)}</th><th>${escape(w.expiry)}</th></tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty">${escape(w.noOpened)}</div>`}</section>`;
  }
}

class AL1SInventoryCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); }
  setConfig(config) { this._config = { show_attention: true, show_opened: true, ...config }; this.render(); }
  set hass(hass) { this._hass = hass; this.render(); }
  render() {
    if (!this._config || !this._hass) return;
    const w = words(language(this._hass));
    const homes = households(this._hass);
    const options = homes.map((entity) => `<option value="${escape(entity.attributes.household)}"${(this._config.household || homes[0]?.attributes.household) === entity.attributes.household ? " selected" : ""}>${escape(entity.attributes.household_name)}</option>`).join("");
    this.shadowRoot.innerHTML = `<style>:host{display:block}label{display:block;margin:16px 0;color:var(--primary-text-color)}input[type=text],select{box-sizing:border-box;display:block;width:100%;padding:10px;margin-top:6px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit}.check{display:flex;align-items:center;gap:8px}.notice{color:var(--secondary-text-color)}</style><label>${escape(w.household)}<select name="household">${options}</select></label>${homes.length ? "" : `<p class="notice">${escape(w.missing)}</p>`}<label>${escape(w.customTitle)}<input type="text" name="title" value="${escape(this._config.title || "")}"></label><label class="check"><input type="checkbox" name="show_attention"${this._config.show_attention ? " checked" : ""}>${escape(w.showAttention)}</label><label class="check"><input type="checkbox" name="show_opened"${this._config.show_opened ? " checked" : ""}>${escape(w.showOpened)}</label>`;
    this.shadowRoot.querySelectorAll("input,select").forEach((element) => element.addEventListener("change", () => {
      const config = { ...this._config, type: `custom:${CARD}`, [element.name]: element.type === "checkbox" ? element.checked : element.value };
      if (config.show_attention === false && config.show_opened === false) { element.checked = true; return; }
      this._config = config;
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
    }));
  }
}
if (!customElements.get(CARD)) customElements.define(CARD, AL1SInventoryCard);
if (!customElements.get(`${CARD}-editor`)) customElements.define(`${CARD}-editor`, AL1SInventoryCardEditor);
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === CARD)) window.customCards.push({ type: CARD, name: "AL1S WMS", description: "Inventory attention and opened items / 异常库存与已开封物资", preview: true });
