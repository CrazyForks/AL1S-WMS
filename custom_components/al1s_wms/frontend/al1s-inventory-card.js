/* Bundled AL1S inventory cards: no external libraries or API credentials. */
const CARD_TYPES = {
  attention: "al1s-inventory-attention-card",
  opened: "al1s-opened-items-card",
};
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const language = (hass) => String(hass?.locale?.language || hass?.language || "en").startsWith("zh");
const words = (zh) => zh ? {
  item: "物资", quantity: "数量", location: "地点", status: "状态", detail: "详情", openedAt: "开封日", expiry: "到期日", due: "到期", empty: "当前没有需要关注的库存", noOpened: "没有使用中的物资", unavailable: "库存数据暂不可用", missing: "未找到 AL1S 明细实体，请更新集成并重启 Home Assistant", unset: "未设置", noLocation: "未指定地点", buy: "建议补", household: "家庭", statuses: { out_of_stock: "缺货", low_stock: "不足", critical: "临界", expiring: "临期", expired: "过期" },
} : {
  item: "Item", quantity: "Quantity", location: "Location", status: "Status", detail: "Details", openedAt: "Opened", expiry: "Expires", due: "Expires", empty: "No inventory needs attention", noOpened: "No items in use", unavailable: "Inventory data is unavailable", missing: "AL1S detail entities not found. Update the integration and restart Home Assistant", unset: "Not set", noLocation: "No location", buy: "Buy", household: "Household", statuses: { out_of_stock: "Out of stock", low_stock: "Low stock", critical: "At threshold", expiring: "Expiring", expired: "Expired" },
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
  section{padding:16px 0}
  .scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}table{border-collapse:collapse;width:100%;font-size:14px;text-align:start}th{text-align:start;font-size:12px;font-weight:500;color:var(--secondary-text-color);white-space:nowrap}td,th{padding:10px 12px;border-bottom:1px solid var(--divider-color);vertical-align:top}td:first-child,th:first-child{padding-inline-start:20px}td:last-child,th:last-child{padding-inline-end:20px}tbody tr:last-child td{border-bottom:0}.number{text-align:end;white-space:nowrap}.nowrap{white-space:nowrap}.unit,.meta{color:var(--secondary-text-color)}.meta{display:block;font-size:12px;line-height:1.6;margin-top:3px}a{color:var(--primary-text-color);text-decoration:none;border-bottom:1px dashed var(--secondary-text-color)}a:hover{color:var(--primary-color)}
  .badge{display:inline-block;border-radius:5px;padding:3px 6px;font-size:12px;white-space:nowrap;background:var(--secondary-background-color)}.out_of_stock,.expired{color:var(--error-color,#db4437)}.low_stock,.critical,.expiring{color:var(--warning-color,#a66b00)}.empty{padding:10px 20px;color:var(--secondary-text-color);font-size:14px}.notice{padding:16px 20px;color:var(--secondary-text-color)}
  @media(max-width:480px){td,th{padding:9px 8px}td:first-child,th:first-child{padding-inline-start:16px}td:last-child,th:last-child{padding-inline-end:16px}.empty{padding:10px 16px}table{font-size:13px}}
`;

class AL1SCardBase extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); }
  set hass(hass) { this._hass = hass; this.render(); }
  getCardSize() { return 4; }
  static getConfigElement() { return document.createElement(`${this.cardType}-editor`); }
  static getStubConfig(hass) { return { household: households(hass)[0]?.attributes.household }; }
  setConfig(config) {
    this._config = config;
    this.render();
  }
  render() {
    if (!this._hass || !this._config) return;
    const w = words(language(this._hass));
    const homes = households(this._hass);
    const home = this._config.household || homes[0]?.attributes.household;
    const entity = stateFor(this._hass, home, this._mode === "attention" ? "attention" : "opened_details");
    const signature = [entity, home, this._hass.locale?.language, this._hass.language];
    if (this._signature && signature.every((value, index) => value === this._signature[index])) return;
    this._signature = signature;
    const content = !entity ? `<div class="notice">${escape(w.missing)}</div>` : this._mode === "attention" ? this.attentionTable(entity, w) : this.openedTable(entity, w);
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>${content}</ha-card>`;
  }
  attentionTable(entity, w) {
    if (isUnavailable(entity)) return `<section><div class="empty">${escape(w.unavailable)}</div></section>`;
    const rows = entity.attributes.items || [];
    const body = rows.map((row) => {
      const detail = row.expiry_date
        ? `${row.location ? `${escape(row.location)} · ` : ""}${escape(w.due)} ${escape(row.expiry_date)}`
        : row.suggested_quantity > 0 ? `${escape(w.buy)} ${escape(row.suggested_quantity)} ${escape(row.unit)}` : "--";
      return `<tr><td><span class="badge ${escape(row.status)}">${escape(w.statuses[row.status] || row.status)}</span></td><td>${itemName(row)}</td><td class="number">${quantity(row)}</td><td class="nowrap">${detail}</td></tr>`;
    }).join("");
    return `<section>${rows.length ? `<div class="scroll"><table><thead><tr><th>${escape(w.status)}</th><th>${escape(w.item)}</th><th class="number">${escape(w.quantity)}</th><th>${escape(w.detail)}</th></tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty">${escape(w.empty)}</div>`}</section>`;
  }
  openedTable(entity, w) {
    if (isUnavailable(entity)) return `<section><div class="empty">${escape(w.unavailable)}</div></section>`;
    const rows = entity.attributes.items || [];
    const body = rows.map((row) => `<tr><td>${itemName(row)}<span class="meta">${escape(w.openedAt)} ${escape(row.opened_at?.slice(0, 10) || w.unset)}</span></td><td class="number">${quantity(row)}</td><td class="nowrap">${escape(row.location || w.noLocation)}</td><td class="nowrap">${escape(row.expiry_date || w.unset)}</td></tr>`).join("");
    return `<section>${rows.length ? `<div class="scroll"><table><thead><tr><th>${escape(w.item)}</th><th class="number">${escape(w.quantity)}</th><th>${escape(w.location)}</th><th>${escape(w.expiry)}</th></tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty">${escape(w.noOpened)}</div>`}</section>`;
  }
}

class AL1SInventoryAttentionCard extends AL1SCardBase { static cardType = "al1s-inventory-attention-card"; constructor() { super(); this._mode = "attention"; } }
class AL1SOpenedItemsCard extends AL1SCardBase { static cardType = "al1s-opened-items-card"; constructor() { super(); this._mode = "opened"; } }
class AL1SCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); }
  setConfig(config) { this._config = { ...config }; this.render(); }
  set hass(hass) { this._hass = hass; this.render(); }
  render() {
    if (!this._config || !this._hass) return;
    const w = words(language(this._hass));
    const homes = households(this._hass);
    const options = homes.map((entity) => `<option value="${escape(entity.attributes.household)}"${(this._config.household || homes[0]?.attributes.household) === entity.attributes.household ? " selected" : ""}>${escape(entity.attributes.household_name)}</option>`).join("");
    this.shadowRoot.innerHTML = `<style>:host{display:block}label{display:block;margin:16px 0;color:var(--primary-text-color)}select{box-sizing:border-box;display:block;width:100%;padding:10px;margin-top:6px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);font:inherit}.notice{color:var(--secondary-text-color)}</style><label>${escape(w.household)}<select name="household">${options}</select></label>${homes.length ? "" : `<p class="notice">${escape(w.missing)}</p>`}`;
    this.shadowRoot.querySelectorAll("input,select").forEach((element) => element.addEventListener("change", () => {
      const config = { ...this._config, type: `custom:${this.constructor.cardType}`, [element.name]: element.type === "checkbox" ? element.checked : element.value };
      this._config = config;
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
    }));
  }
}
class AL1SAttentionEditor extends AL1SCardEditor { static cardType = CARD_TYPES.attention; }
class AL1SOpenedEditor extends AL1SCardEditor { static cardType = CARD_TYPES.opened; }

[
  [CARD_TYPES.attention, AL1SInventoryAttentionCard],
  [CARD_TYPES.opened, AL1SOpenedItemsCard],
  [`${CARD_TYPES.attention}-editor`, AL1SAttentionEditor],
  [`${CARD_TYPES.opened}-editor`, AL1SOpenedEditor],
].forEach(([tag, element]) => { if (!customElements.get(tag)) customElements.define(tag, element); });

window.customCards = window.customCards || [];
[
  { type: CARD_TYPES.attention, name: "AL1S WMS · 库存提醒", description: "Inventory attention / 库存提醒", preview: true },
  { type: CARD_TYPES.opened, name: "AL1S WMS · 使用中", description: "Opened items / 已开封物资", preview: true },
].forEach((card) => { if (!window.customCards.some((entry) => entry.type === card.type)) window.customCards.push(card); });
