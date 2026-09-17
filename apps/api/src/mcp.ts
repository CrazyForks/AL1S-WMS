import { itemIconSchema } from "@family-erp/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { deleteInventoryEntity, DeleteError, transactionQuery } from "./inventory-delete.js";

export function createMcpServer(db: DatabaseSync) {
  const server = new McpServer({ name: "AL1S-ERP", version: "0.2.0" });

  for (const kind of ["item", "category", "location"] as const) {
    const idKey = `${kind}Id`;
    server.registerTool(`delete_${kind}`, {
      description: kind === "item"
        ? "Delete an item, clear remaining stock, retain history and unlink pending purchases. Records an item deletion event."
        : "Delete a tree node. Direct items and child nodes move to its parent. Root items use an unclassified/unspecified fallback. Only actual item changes are logged; node deletion itself is not logged.",
      inputSchema: { homeId: z.string().uuid().describe("Home ID"), [idKey]: z.string().uuid().describe(`The ${kind} ID to delete`) },
      annotations: { destructiveHint: true, readOnlyHint: false },
    }, async (args) => {
      try { return { content: [{ type: "text" as const, text: JSON.stringify(deleteInventoryEntity(db, args.homeId, kind, args[idKey])) }] }; }
      catch (error) {
        if (error instanceof DeleteError) return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ status: error.status, message: error.message }) }] };
        throw error;
      }
    });
  }

  server.registerTool(
    "list_homes",
    {
      title: "List homes",
      description:
        "List active Homes. Call this first to obtain the required homeId for other tools.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            db
              .prepare(
                "SELECT id, name, icon, timezone, default_currency AS defaultCurrency FROM homes WHERE active = 1 ORDER BY name",
              )
              .all(),
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "search_items",
    {
      title: "Search items",
      description:
        "Search active items in a Home with optional location, low-stock, and expiry filters.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        query: z.string().trim().min(1).max(100).optional().describe("Name search text"),
        category: z.string().trim().min(1).optional().describe("Exact category name"),
        locationId: z.string().uuid().optional().describe("Location subtree root ID"),
        includeDescendantLocations: z.boolean().optional().describe("Include child locations; defaults to true"),
        lowStockOnly: z.boolean().optional().describe("Only items below minimum stock"),
        expiryBefore: z.string().date().optional().describe("Latest expiry date, YYYY-MM-DD"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum results; defaults to 50"),
      },
    },
    async ({
      homeId,
      query,
      category,
      locationId,
      includeDescendantLocations = true,
      lowStockOnly,
      expiryBefore,
      limit = 50,
    }) => {
      const conditions = ["items.home_id = ?", "items.active = 1"];
      const params: (string | number)[] = [homeId];
      if (query) {
        conditions.push("(items.name LIKE ? OR items.sku LIKE ?)");
        params.push(`%${query}%`, `%${query}%`);
      }
      if (category) {
        conditions.push("items.category = ?");
        params.push(category);
      }
      if (locationId) {
        const locationIds = [locationId];
        if (includeDescendantLocations)
          for (let index = 0; index < locationIds.length; index++) {
            const children = db
              .prepare(
                "SELECT id FROM locations WHERE home_id = ? AND parent_id = ? AND active = 1",
              )
              .all(homeId, locationIds[index]) as { id: string }[];
            locationIds.push(...children.map((child) => child.id));
          }
        conditions.push(
          `items.default_location_id IN (${locationIds.map(() => "?").join(", ")})`,
        );
        params.push(...locationIds);
      }
      if (lowStockOnly)
        conditions.push(
          "(SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) FROM stock_transactions WHERE item_id = items.id) < items.reorder_point",
        );
      if (expiryBefore) {
        conditions.push(
          "items.expiry_date IS NOT NULL AND items.expiry_date <= ?",
        );
        params.push(expiryBefore);
      }
      const rows = db
        .prepare(
          `SELECT items.icon, items.id, items.name, items.category, items.base_unit AS baseUnit, items.reorder_point AS reorderPoint, items.default_location_id AS locationId, items.manufactured_date AS manufacturedDate, items.expiry_date AS expiryDate, (SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) FROM stock_transactions WHERE item_id = items.id) AS quantity FROM items WHERE ${conditions.join(" AND ")} ORDER BY items.name LIMIT ?`,
        )
        .all(...params, limit);
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    },
  );

  server.registerTool(
    "get_stock",
    {
      title: "Get stock",
      description: "Return current stock balance for an item at a location.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        itemId: z.string().uuid().describe("Item ID from search_items"),
        locationId: z.string().uuid().optional().describe("Optional location ID; omit for total stock"),
      },
    },
    async ({ homeId, itemId, locationId }) => {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ?${locationId ? " AND location_id = ?" : ""}`,
        )
        .get(...(locationId ? [homeId, itemId, locationId] : [homeId, itemId]));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ homeId, itemId, locationId, ...row }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_item",
    {
      title: "Get item",
      description: "Get one item with its replenishment and expiry fields.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        itemId: z.string().uuid().describe("Item ID from search_items"),
      },
    },
    async ({ homeId, itemId }) => {
      const row = db
        .prepare(
          "SELECT id, icon, sku, name, category, base_unit AS baseUnit, reorder_point AS reorderPoint, manufactured_date AS manufacturedDate, expiry_date AS expiryDate, default_location_id AS locationId FROM items WHERE home_id = ? AND id = ? AND active = 1",
        )
        .get(homeId, itemId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(row ?? { code: "ITEM_NOT_FOUND" }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "create_item",
    {
      title: "Create item",
      description:
        "Create an inventory item. category defaults to 其他, baseUnit is required, and initialQuantity requires locationId.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        name: z.string().trim().min(1).max(200).describe("Item name"),
        icon: itemIconSchema.nullable().optional().describe("Display icon; null uses automatic matching"),
        category: z.string().trim().min(1).max(100).optional().describe("Category name; defaults to 其他"),
        baseUnit: z.string().trim().min(1).max(30).describe("Stock unit, for example 个、瓶、盒"),
        locationId: z.string().uuid().optional().describe("Default storage location ID"),
        initialQuantity: z.number().nonnegative().optional().describe("Opening stock; defaults to 0"),
        reorderPoint: z.number().nonnegative().optional().describe("Minimum desired stock; defaults to 0"),
        manufacturedDate: z.string().date().optional().describe("Production date, YYYY-MM-DD"),
        expiryDate: z.string().date().optional().describe("Expiry date, YYYY-MM-DD"),
      },
    },
    async ({
      homeId,
      name,
      category = "其他",
      icon,
      baseUnit,
      locationId,
      initialQuantity = 0,
      reorderPoint = 0,
      manufacturedDate,
      expiryDate,
    }) => {
      if (initialQuantity > 0 && !locationId)
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ code: "LOCATION_REQUIRED_FOR_INITIAL_STOCK" }),
            },
          ],
        };
      if (
        locationId &&
        !db
          .prepare(
            "SELECT id FROM locations WHERE id = ? AND home_id = ? AND active = 1",
          )
          .get(locationId, homeId)
      )
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ code: "LOCATION_NOT_FOUND" }) },
          ],
        };
      const id = randomUUID();
      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        db.prepare(
          "INSERT INTO items (id, home_id, sku, name, category, base_unit, reorder_point, reorder_quantity, default_location_id, manufactured_date, expiry_date, icon) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
        ).run(
          id,
          homeId,
          `ITEM-${id.slice(0, 8).toUpperCase()}`,
          name,
          category,
          baseUnit,
          reorderPoint,
          locationId ?? null,
          manufacturedDate ?? null,
          expiryDate ?? null,
          icon ?? null,
        );
        if (initialQuantity > 0)
          db.prepare(
            "INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, 'receipt', ?, 'MCP 初始库存', ?, ?)",
          ).run(
            randomUUID(),
            homeId,
            id,
            locationId as string,
            initialQuantity,
            `mcp:create-item:${id}`,
            now,
          );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id,
              homeId,
              name,
              category,
              baseUnit,
              locationId: locationId ?? null,
              quantity: initialQuantity,
              icon: icon ?? null,
              reorderPoint,
              manufacturedDate: manufacturedDate ?? null,
              expiryDate: expiryDate ?? null,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description: "Update editable item fields. System SKU cannot be changed.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        itemId: z.string().uuid().describe("Item ID from search_items"),
        name: z.string().trim().min(1).max(200).optional().describe("Item name"),
        icon: itemIconSchema.nullable().optional().describe("Display icon; null restores automatic matching"),
        category: z.string().trim().min(1).max(100).optional().describe("Category name"),
        baseUnit: z.string().trim().min(1).max(30).optional().describe("Stock unit"),
        reorderPoint: z.number().nonnegative().optional().describe("Minimum desired stock"),
        locationId: z.string().uuid().nullable().optional().describe("Default location; null clears it"),
        manufacturedDate: z.string().date().nullable().optional().describe("YYYY-MM-DD; null clears it"),
        expiryDate: z.string().date().nullable().optional().describe("YYYY-MM-DD; null clears it"),
      },
    },
    async ({ homeId, itemId, ...changes }) => {
      const fields = Object.entries(changes)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => ({
          name:
            key === "baseUnit"
              ? "base_unit"
              : key === "reorderPoint"
                ? "reorder_point"
                : key === "locationId"
                  ? "default_location_id"
                  : key === "manufacturedDate"
                    ? "manufactured_date"
                    : key === "expiryDate"
                      ? "expiry_date"
                      : key,
          value: value ?? null,
        }));
      if (!fields.length)
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ code: "NO_CHANGES" }) },
          ],
        };
      if (
        !db
          .prepare(
            "SELECT id FROM items WHERE home_id = ? AND id = ? AND active = 1",
          )
          .get(homeId, itemId)
      )
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ code: "ITEM_NOT_FOUND" }) },
          ],
        };
      const current = db
        .prepare(
          "SELECT default_location_id AS locationId FROM items WHERE home_id = ? AND id = ?",
        )
        .get(homeId, itemId) as { locationId: string | null };
      if (
        changes.locationId &&
        !db
          .prepare(
            "SELECT id FROM locations WHERE home_id = ? AND id = ? AND active = 1",
          )
          .get(homeId, changes.locationId)
      )
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ code: "LOCATION_NOT_FOUND" }) },
          ],
        };
      db.exec("BEGIN");
      try {
        db.prepare(
          `UPDATE items SET ${fields.map((field) => `${field.name} = ?`).join(", ")} WHERE home_id = ? AND id = ?`,
        ).run(...fields.map((field) => field.value), homeId, itemId);
        const changedLocation =
          Object.prototype.hasOwnProperty.call(changes, "locationId") &&
          changes.locationId &&
          changes.locationId !== current.locationId;
        if (changedLocation) {
          const destination = changes.locationId as string;
          const balances = db
            .prepare(
              "SELECT location_id AS locationId, COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ? GROUP BY location_id HAVING quantity > 0",
            )
            .all(homeId, itemId) as { locationId: string; quantity: number }[];
          const insert = db.prepare(
            "INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          );
          const now = new Date().toISOString();
          for (const balance of balances)
            if (balance.locationId !== destination) {
              const key = `relocate:${itemId}:${randomUUID()}`;
              insert.run(
                randomUUID(),
                homeId,
                itemId,
                balance.locationId,
                "issue",
                balance.quantity,
                "更改存放地点",
                `${key}:out`,
                now,
              );
              insert.run(
                randomUUID(),
                homeId,
                itemId,
                destination,
                "receipt",
                balance.quantity,
                "更改存放地点",
                `${key}:in`,
                now,
              );
            }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: itemId,
              updated: fields.map((field) => field.name),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "create_location",
    {
      title: "Create location",
      description: "Create a storage location or child location in a Home.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        name: z.string().trim().min(1).max(100).describe("Location name"),
        parentId: z.string().uuid().optional().describe("Parent location ID; omit for a top-level location"),
      },
    },
    async ({ homeId, name, parentId }) => {
      if (
        parentId &&
        !db
          .prepare(
            "SELECT id FROM locations WHERE id = ? AND home_id = ? AND active = 1",
          )
          .get(parentId, homeId)
      )
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "PARENT_LOCATION_NOT_FOUND" }) }] };
      const id = randomUUID();
      try {
        db.prepare(
          "INSERT INTO locations (id, home_id, parent_id, name) VALUES (?, ?, ?, ?)",
        ).run(id, homeId, parentId ?? null, name);
      } catch {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "LOCATION_EXISTS" }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ id, homeId, name, parentId: parentId ?? null }) }] };
    },
  );

  server.registerTool(
    "create_category",
    {
      title: "Create category",
      description: "Create an item category or child category in a Home.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        name: z.string().trim().min(1).max(100).describe("Category name"),
        parentId: z.string().uuid().optional().describe("Parent category ID; omit for a top-level category"),
      },
    },
    async ({ homeId, name, parentId }) => {
      if (
        parentId &&
        !db
          .prepare(
            "SELECT id FROM item_categories WHERE id = ? AND home_id = ? AND active = 1",
          )
          .get(parentId, homeId)
      )
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "PARENT_CATEGORY_NOT_FOUND" }) }] };
      const id = randomUUID();
      try {
        db.prepare(
          "INSERT INTO item_categories (id, home_id, parent_id, name) VALUES (?, ?, ?, ?)",
        ).run(id, homeId, parentId ?? null, name);
      } catch {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "CATEGORY_EXISTS" }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ id, homeId, name, parentId: parentId ?? null }) }] };
    },
  );

  server.registerTool(
    "list_locations",
    {
      title: "List locations",
      description: "List active storage locations in a Home.",
      inputSchema: { homeId: z.string().uuid().describe("Home ID from list_homes") },
    },
    async ({ homeId }) => {
      const rows = db
        .prepare(
          "SELECT id, parent_id AS parentId, name FROM locations WHERE home_id = ? AND active = 1 ORDER BY name",
        )
        .all(homeId);
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    },
  );

  server.registerTool(
    "list_categories",
    {
      title: "List categories",
      description: "List active item categories and their parent relationships.",
      inputSchema: { homeId: z.string().uuid().describe("Home ID from list_homes") },
    },
    async ({ homeId }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            db
              .prepare(
                "SELECT id, parent_id AS parentId, name, is_system AS isSystem FROM item_categories WHERE home_id = ? AND active = 1 ORDER BY name",
              )
              .all(homeId),
          ),
        },
      ],
    }),
  );

  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description: "List recent inventory transactions in a Home.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        itemId: z.string().uuid().optional().describe("Filter by item"),
        locationId: z.string().uuid().optional().describe("Filter by location"),
        type: z.enum(["receipt", "issue", "delete", "reclassify", "move"]).optional().describe("Filter by item event: receipt, issue, deletion, category change or location change"),
        occurredFrom: z.string().datetime().optional().describe("Inclusive ISO 8601 timestamp"),
        occurredTo: z.string().datetime().optional().describe("Inclusive ISO 8601 timestamp"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum results; defaults to 50"),
      },
    },
    async ({ homeId, itemId, locationId, type, occurredFrom, occurredTo, limit = 50 }) => {
      const conditions = ["homeId = ?"];
      const params: (string | number)[] = [homeId];
      if (itemId) (conditions.push("itemId = ?"), params.push(itemId));
      if (locationId) (conditions.push("locationId = ?"), params.push(locationId));
      if (type) (conditions.push("type = ?"), params.push(type));
      if (occurredFrom) (conditions.push("occurredAt >= ?"), params.push(occurredFrom));
      if (occurredTo) (conditions.push("occurredAt <= ?"), params.push(occurredTo));
      const rows = db
        .prepare(
          `SELECT * FROM (${transactionQuery}) WHERE ${conditions.join(" AND ")} ORDER BY occurredAt DESC, id DESC LIMIT ?`,
        )
        .all(...params, limit);
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    },
  );

  server.registerTool(
    "list_shopping_items",
    {
      title: "List shopping list",
      description:
        "List manual shopping entries and automatically suggested low-stock items.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        includeCompleted: z.boolean().optional().describe("Include completed manual entries; defaults to false"),
      },
    },
    async ({ homeId, includeCompleted = false }) => {
      const manual = db
        .prepare(
          "SELECT id, item_id AS itemId, name, quantity, unit, category, location_id AS locationId, source, completed, created_at AS createdAt FROM shopping_list WHERE home_id = ? AND (? OR completed = 0) ORDER BY completed, created_at DESC",
        )
        .all(homeId, includeCompleted ? 1 : 0);
      const automatic = db
        .prepare(
        "SELECT 'auto:' || items.id AS id, items.id AS itemId, items.name, MAX(items.reorder_point - (SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) FROM stock_transactions WHERE item_id = items.id), 0) AS quantity, items.base_unit AS unit, items.category, items.default_location_id AS locationId, 'automatic' AS source, 0 AS completed, NULL AS createdAt FROM items WHERE items.home_id = ? AND items.active = 1 AND (SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) FROM stock_transactions WHERE item_id = items.id) < items.reorder_point GROUP BY items.id ORDER BY items.name",
        )
        .all(homeId);
      return {
        content: [
          { type: "text", text: JSON.stringify([...manual, ...automatic]) },
        ],
      };
    },
  );

  server.registerTool(
    "create_shopping_item",
    {
      title: "Create shopping item",
      description:
        "Create a shopping entry. With itemId, master item fields are inherited. Without itemId, name, unit, category and locationId are required.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        itemId: z.string().uuid().optional().describe("Existing item to purchase"),
        name: z.string().trim().min(1).max(200).optional().describe("Required when itemId is omitted"),
        quantity: z.number().positive().optional().describe("Planned quantity; defaults to 1"),
        unit: z.string().trim().min(1).max(30).optional().describe("Required when itemId is omitted"),
        category: z.string().trim().min(1).max(100).optional().describe("Required when itemId is omitted"),
        locationId: z.string().uuid().optional().describe("Required when itemId is omitted"),
      },
    },
    async ({ homeId, name, quantity = 1, itemId, unit, category, locationId }) => {
      const linked = itemId
        ? (db
            .prepare(
              "SELECT name, base_unit AS unit, category, default_location_id AS locationId FROM items WHERE id = ? AND home_id = ? AND active = 1",
            )
            .get(itemId, homeId) as
            | {
                name: string;
                unit: string;
                category: string;
                locationId: string | null;
              }
            | undefined)
        : undefined;
      if (itemId && !linked)
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ code: "ITEM_NOT_FOUND" }) }],
        };
      const resolvedName = linked?.name ?? name?.trim();
      if (!resolvedName || (!linked && (!unit || !category || !locationId)))
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                code: "UNLINKED_SHOPPING_FIELDS_REQUIRED",
                required: ["name", "unit", "category", "locationId"],
              }),
            },
          ],
        };
      if (
        !linked &&
        !db
          .prepare(
            "SELECT id FROM locations WHERE id = ? AND home_id = ? AND active = 1",
          )
          .get(locationId as string, homeId)
      )
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ code: "LOCATION_NOT_FOUND" }) },
          ],
        };
      const id = randomUUID();
      db.prepare(
        "INSERT INTO shopping_list (id, home_id, item_id, name, quantity, unit, category, location_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)",
      ).run(
        id,
        homeId,
        itemId ?? null,
        resolvedName,
        quantity,
        linked?.unit ?? unit ?? null,
        linked?.category ?? category ?? null,
        linked ? linked.locationId : locationId ?? null,
        new Date().toISOString(),
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id,
              homeId,
              name: resolvedName,
              quantity,
              itemId: itemId ?? null,
              unit: linked?.unit ?? unit ?? null,
              category: linked?.category ?? category ?? null,
              locationId: linked ? linked.locationId : locationId ?? null,
              source: "manual",
              completed: 0,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "receive_shopping_item",
    {
      title: "Receive shopping item",
      description:
        "Receive a linked shopping entry into stock and mark it completed. The actual quantity is required explicitly.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        shoppingItemId: z
          .string()
          .min(1)
          .describe("Shopping entry ID; automatic entries use the auto: prefix"),
        actualQuantity: z
          .number()
          .positive()
          .describe("Quantity actually received"),
      },
    },
    async ({ homeId, shoppingItemId, actualQuantity }) => {
      const automatic = shoppingItemId.startsWith("auto:");
      const item = automatic
        ? (db
            .prepare(
              "SELECT id AS itemId, default_location_id AS locationId FROM items WHERE id = ? AND home_id = ? AND active = 1",
            )
            .get(shoppingItemId.slice(5), homeId) as
            | { itemId: string; locationId: string | null }
            | undefined)
        : (db
            .prepare(
              "SELECT item_id AS itemId, location_id AS locationId, completed FROM shopping_list WHERE id = ? AND home_id = ?",
            )
            .get(shoppingItemId, homeId) as
            | { itemId: string | null; locationId: string | null; completed: number }
            | undefined);
      if (!item)
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ code: "SHOPPING_ITEM_NOT_FOUND" }) },
          ],
        };
      if (!automatic && "completed" in item && item.completed)
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ code: "SHOPPING_ITEM_ALREADY_COMPLETED" }) },
          ],
        };
      if (!item.itemId || !item.locationId)
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ code: "SHOPPING_ITEM_NOT_LINKED" }) },
          ],
        };
      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        db.prepare(
          "INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, 'receipt', ?, '采购入库', ?, ?)",
        ).run(
          randomUUID(),
          homeId,
          item.itemId,
          item.locationId,
          actualQuantity,
          `mcp:shopping:${shoppingItemId}:${randomUUID()}`,
          now,
        );
        if (!automatic)
          db.prepare(
            "UPDATE shopping_list SET completed = 1, completed_at = ? WHERE id = ? AND home_id = ?",
          ).run(now, shoppingItemId, homeId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: shoppingItemId,
              completed: true,
              received: actualQuantity,
              itemId: item.itemId,
              locationId: item.locationId,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "delete_shopping_item",
    {
      title: "Delete shopping item",
      description: "Remove a manual shopping entry that is no longer needed.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        shoppingItemId: z.string().uuid().describe("Manual shopping entry ID"),
      },
    },
    async ({ homeId, shoppingItemId }) => {
      const result = db
        .prepare("DELETE FROM shopping_list WHERE id = ? AND home_id = ?")
        .run(shoppingItemId, homeId);
      if (!result.changes)
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ code: "SHOPPING_ITEM_NOT_FOUND" }),
            },
          ],
        };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id: shoppingItemId, deleted: true }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "record_receipt",
    {
      title: "Record receipt",
      description:
        "Record stock received into a location. Requires a unique idempotency key.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        itemId: z.string().uuid().describe("Item ID from search_items"),
        locationId: z.string().uuid().describe("Destination location ID"),
        quantity: z.number().positive().describe("Quantity received"),
        idempotencyKey: z.string().trim().min(1).max(200).describe("Caller-generated unique key for safe retries"),
        reason: z.string().trim().max(200).optional(),
      },
    },
    async ({
      homeId,
      itemId,
      locationId,
      quantity,
      idempotencyKey,
      reason,
    }) => {
      if (
        !db
          .prepare(
            "SELECT 1 FROM items JOIN locations ON locations.id = ? AND locations.home_id = items.home_id AND locations.active = 1 WHERE items.id = ? AND items.home_id = ? AND items.active = 1",
          )
          .get(locationId, itemId, homeId)
      )
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ code: "ITEM_OR_LOCATION_NOT_FOUND" }) },
          ],
        };
      const existing = db
        .prepare(
          "SELECT id FROM stock_transactions WHERE home_id = ? AND idempotency_key = ?",
        )
        .get(homeId, idempotencyKey);
      if (existing)
        return { content: [{ type: "text", text: JSON.stringify(existing) }] };
      if (
        !db
          .prepare(
            "SELECT 1 FROM items JOIN locations ON locations.id = ? AND locations.home_id = items.home_id AND locations.active = 1 WHERE items.id = ? AND items.home_id = ? AND items.active = 1",
          )
          .get(locationId, itemId, homeId)
      )
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ code: "ITEM_OR_LOCATION_NOT_FOUND" }) },
          ],
        };
      const id = randomUUID();
      db.prepare(
        "INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, 'receipt', ?, ?, ?, ?)",
      ).run(
        id,
        homeId,
        itemId,
        locationId,
        quantity,
        reason ?? "MCP 入库",
        idempotencyKey,
        new Date().toISOString(),
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id,
              homeId,
              itemId,
              locationId,
              quantity,
              type: "receipt",
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "record_issue",
    {
      title: "Record issue",
      description:
        "Record stock issued from a location. Rejects negative balances.",
      inputSchema: {
        homeId: z.string().uuid().describe("Home ID from list_homes"),
        itemId: z.string().uuid().describe("Item ID from search_items"),
        locationId: z.string().uuid().describe("Source location ID"),
        quantity: z.number().positive().describe("Quantity issued"),
        idempotencyKey: z.string().trim().min(1).max(200).describe("Caller-generated unique key for safe retries"),
        reason: z.string().trim().max(200).optional(),
      },
    },
    async ({
      homeId,
      itemId,
      locationId,
      quantity,
      idempotencyKey,
      reason,
    }) => {
      const existing = db
        .prepare(
          "SELECT id FROM stock_transactions WHERE home_id = ? AND idempotency_key = ?",
        )
        .get(homeId, idempotencyKey);
      if (existing)
        return { content: [{ type: "text", text: JSON.stringify(existing) }] };
      const balance = db
        .prepare(
          "SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ? AND location_id = ?",
        )
        .get(homeId, itemId, locationId) as { quantity: number };
      if (balance.quantity < quantity)
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                code: "INSUFFICIENT_STOCK",
                available: balance.quantity,
              }),
            },
          ],
        };
      const id = randomUUID();
      db.prepare(
        "INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, 'issue', ?, ?, ?, ?)",
      ).run(
        id,
        homeId,
        itemId,
        locationId,
        quantity,
        reason ?? "MCP 领用",
        idempotencyKey,
        new Date().toISOString(),
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id,
              homeId,
              itemId,
              locationId,
              quantity,
              type: "issue",
            }),
          },
        ],
      };
    },
  );

  return server;
}

export async function handleMcpRequest(
  request: any,
  reply: any,
  db: DatabaseSync,
) {
  reply.hijack();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createMcpServer(db);
  await server.connect(transport);
  await transport.handleRequest(request.raw, reply.raw, request.body);
}
