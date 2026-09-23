import i18n from "./i18n/index.js";
import { apiFetch } from "./i18n/apiFetch.js";
import type {
  Item,
  Stock,
  OpenedConsumable,
  Location,
  TransactionPage,
  ShoppingItem,
  ShoppingChannel,
  FinancialSummary,
  Category,
} from "./webTypes.js";
const t = i18n.t.bind(i18n);
export const fallbackHomeId = "11111111-1111-4111-8111-111111111111";

export const getHomeId = () =>
  localStorage.getItem("al1s-wms-home-id") ?? fallbackHomeId;

export async function getItems() {
  return readHome<Item[]>(`items`, "无法加载物资");
}

export async function getStock() {
  return readHome<Stock[]>(`stock`, "无法加载库存");
}

export async function getOpenedConsumables() {
  return readHome<OpenedConsumable[]>(
    `opened-consumables`,
    "无法加载已开封消耗品",
  );
}

export async function getLocations() {
  return readHome<Location[]>(`locations`, "无法加载地点");
}

export async function getTransactions(
  page = 1,
  snapshotAt = "",
  pageSize = 10,
) {
  return readHome<TransactionPage>(
    `transactions?limit=${pageSize}&offset=${(page - 1) * pageSize}${snapshotAt ? `&snapshotAt=${encodeURIComponent(snapshotAt)}` : ""}`,
    "无法加载变动记录",
  );
}

export async function getShoppingList() {
  return readHome<ShoppingItem[]>(`shopping-list`, "无法加载采购清单");
}

export async function getShoppingChannels() {
  return readHome<ShoppingChannel[]>(`shopping-channels`, "无法加载购买渠道");
}

export async function getShoppingCalendar(
  month: string,
  includeCompleted = false,
) {
  return readHome<ShoppingItem[]>(
    `shopping-calendar?month=${month}&includeCompleted=${includeCompleted}`,
    "无法加载采购日历",
  );
}

export async function getFinancialSummary(month: string) {
  return readHome<FinancialSummary>(
    `financial-dashboard?month=${month}`,
    "无法加载财务数据",
  );
}

export async function getCategories() {
  return readHome<Category[]>(`categories`, "无法加载物资类型");
}

async function readHome<T>(path: string, errorKey: string): Promise<T> {
  const response = await apiFetch(`/api/v1/homes/${getHomeId()}/${path}`);
  if (!response.ok) throw new Error(t(errorKey));
  return response.json() as Promise<T>;
}
