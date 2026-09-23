import type { CategorySpending } from "./budgetTree.js";
export type UserAvatar = "user" | "woman" | "cat" | "dog" | "bot";

export type CurrentUser = {
  id: string;
  username: string;
  role: string;
  avatar: UserAvatar;
};

export type Item = {
  icon?: string | null;
  id: string;
  homeId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  category: string;
  baseUnit: string;
  consumptionType: "non_consumable" | "consumable" | "long_term_consumable";
  openedShelfLifeDays?: number | null;
  reorderPoint: number;
  reorderQuantity: number;
  active: boolean;
  locationName?: string | null;
  locationId?: string | null;
  manufacturedDate?: string | null;
  expiryDate?: string | null;
  lastUnitPrice?: number | null;
  latestReceivedAt?: string | null;
  currency?: string | null;
};

export type LocationScopedItem = Item & { treeQuantity?: number };

export type Stock = {
  itemId: string;
  locationId: string;
  quantity: number;
  latestReceivedAt?: string | null;
};

export type OpenedConsumable = {
  id: string;
  itemId: string;
  itemName: string;
  baseUnit: string;
  locationId: string;
  locationName: string | null;
  batchId: string;
  batchLabel: string | null;
  manufacturedDate: string | null;
  expiryDate: string | null;
  openedExpiryDate: string | null;
  quantity: number;
  openedAt: string;
};

export type Location = {
  id: string;
  homeId: string;
  parentId: string | null;
  name: string;
  active: boolean;
};

export type Category = {
  id: string;
  parentId: string | null;
  name: string;
  isSystem: boolean;
  active: boolean;
};

export type Transaction = {
  itemId: string;
  id: string;
  itemName: string;
  locationName: string;
  type: "receipt" | "issue" | "delete" | "reclassify" | "move" | "update";
  quantity: number | null;
  reason?: string | null;
  occurredAt: string;
  batchId?: string | null;
};

export type TransactionPage = {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  snapshotAt: string;
};

export type ShoppingItem = {
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

export type ShoppingChannel = {
  id: string;
  name: string;
  isSystem: boolean;
  sortOrder: number;
};

export type FinancialSummary = {
  month: string;
  currency: string;
  budgetTotal: number | null;
  budgetSourceMonth: string | null;
  budgetMode: "none" | "explicit" | "inherited";
  spendingTotal: number;
  estimatedTotal: number;
  forecastTotal: number;
  remainingBudget: number | null;
  variance: number;
  categoryBudgets: { category: string; amount: number }[];
  categorySpending: CategorySpending[];
  byCategory: {
    category: string;
    actual: number;
    planned: number;
    budget: number | null;
  }[];
  byChannel: { channelId: string | null; channelName: string; total: number }[];
  purchases: {
    batchId: string;
    itemId: string;
    itemName: string;
    category: string;
    purchaseDate: string;
    receivedDate: string;
    quantity: number;
    unitPrice: number | null;
    totalPrice: number;
    channelName: string;
    estimatedTotal: number | null;
    variance: number | null;
  }[];
  trend: {
    month: string;
    actual: number;
    planned: number;
    budget: number | null;
  }[];
};

export type ApiToken = {
  id: string;
  name: string;
  homeId?: string | null;
  homeName?: string | null;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
};

export type Home = {id:string;name:string;icon?:string;defaultCurrency?:string};
export type SetupStatus = {complete:boolean;home?:Home};
