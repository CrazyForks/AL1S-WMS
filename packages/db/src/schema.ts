import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const homes = sqliteTable("homes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  defaultCurrency: text("default_currency").notNull().default("CNY"),
  active: integer("active", { mode: "boolean" }).notNull().default(true)
});

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  homeId: text("home_id").notNull().references(() => homes.id),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  baseUnit: text("base_unit").notNull(),
  reorderPoint: real("reorder_point").notNull().default(0),
  reorderQuantity: real("reorder_quantity").notNull().default(1),
  active: integer("active", { mode: "boolean" }).notNull().default(true)
});
