import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const transactionQuery = `
  SELECT t.id, t.home_id AS homeId, t.item_id AS itemId, i.name AS itemName,
    t.location_id AS locationId, l.name AS locationName, t.type, t.quantity,
    t.reason, t.idempotency_key AS idempotencyKey, t.occurred_at AS occurredAt
  FROM stock_transactions t JOIN items i ON i.id = t.item_id
  LEFT JOIN locations l ON l.id = t.location_id
  WHERE t.idempotency_key NOT LIKE 'event:%'
  UNION ALL
  SELECT id, home_id, item_id, item_name, location_id, location_name, type,
    quantity, reason, NULL, occurred_at FROM item_events`;

export class DeleteError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Shared by REST and MCP. History stays intact; all changes commit together.
export function deleteInventoryEntity(db: DatabaseSync, homeId: string, kind: "item" | "category" | "location", id: string) {
  const table = kind === "item" ? "items" : kind === "category" ? "item_categories" : "locations";
  const node = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND home_id = ? AND active = 1`).get(id, homeId) as
    { name: string; base_unit?: string; parent_id?: string | null; default_location_id?: string | null } | undefined;
  if (!node) throw new DeleteError(404, "对象不存在或已删除");
  const occurredAt = new Date().toISOString();
  const event = (item: { id: string; name: string }, type: string, reason: string, locationId: string | null = null, quantity: number | null = null) => {
    const eventId = randomUUID();
    const location = locationId ? db.prepare("SELECT name FROM locations WHERE id = ? AND home_id = ?").get(locationId, homeId) as { name: string } | undefined : undefined;
    db.prepare("INSERT INTO item_events (id, home_id, item_id, item_name, location_id, location_name, type, quantity, reason, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(eventId, homeId, item.id, item.name, locationId, location?.name ?? null, type, quantity, reason, occurredAt);
    return eventId;
  };
  const ledger = (eventId: string, itemId: string, locationId: string, type: string, quantity: number, reason: string) => {
    db.prepare("INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), homeId, itemId, locationId, type, quantity, reason, `event:${eventId}:${randomUUID()}`, occurredAt);
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    let affectedItems = 0;
    let destination: string | null = null;
    if (kind === "item") {
      const balances = db.prepare("SELECT location_id AS locationId, SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ? GROUP BY location_id HAVING SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END) > 0").all(homeId, id) as { locationId: string; quantity: number }[];
      const quantity = balances.reduce((sum, row) => sum + row.quantity, 0);
      const eventId = event({ id, name: node.name }, "delete", `删除物资，移除库存 ${quantity} ${node.base_unit}；保留历史流水`, node.default_location_id ?? null, quantity);
      for (const balance of balances) ledger(eventId, id, balance.locationId, "issue", balance.quantity, "删除物资");
      db.prepare("UPDATE items SET active = 0 WHERE id = ? AND home_id = ?").run(id, homeId);
      // Pending purchases remain usable as standalone purchases.
      db.prepare("UPDATE shopping_list SET item_id = NULL WHERE item_id = ? AND home_id = ?").run(id, homeId);
      affectedItems = 1;
    } else {
      const parent = node.parent_id ? db.prepare(`SELECT id, name FROM ${table} WHERE id = ? AND home_id = ? AND active = 1`).get(node.parent_id, homeId) as { id: string; name: string } | undefined : undefined;
      if (node.parent_id && !parent) throw new DeleteError(409, "上一级节点不存在，请先调整层级");
      const stockRows = kind === "location" ? db.prepare("SELECT item_id AS itemId, SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END) AS quantity FROM stock_transactions WHERE home_id = ? AND location_id = ? GROUP BY item_id HAVING SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END) > 0").all(homeId, id) as { itemId: string; quantity: number }[] : [];
      const linkedItems = db.prepare(kind === "category"
        ? "SELECT id, name FROM items WHERE home_id = ? AND active = 1 AND category = ?"
        : "SELECT id, name FROM items WHERE home_id = ? AND active = 1 AND (default_location_id = ? OR id IN (SELECT item_id FROM stock_transactions WHERE home_id = ? AND location_id = ? GROUP BY item_id HAVING SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END) > 0))")
        .all(...(kind === "category" ? [homeId, node.name] : [homeId, id, homeId, id])) as { id: string; name: string }[];
      const shoppingCount = db.prepare(`SELECT COUNT(*) AS count FROM shopping_list WHERE home_id = ? AND ${kind === "category" ? "category" : "location_id"} = ?`).get(homeId, kind === "category" ? node.name : id) as { count: number };
      let target = parent;
      if (!target && (linkedItems.length || shoppingCount.count || stockRows.length)) {
        const fallback = kind === "category" ? (node.name === "未分类" ? "其他" : "未分类") : (node.name === "未指定" ? "待整理" : "未指定");
        target = db.prepare(`SELECT id, name FROM ${table} WHERE home_id = ? AND name = ? AND id != ? AND parent_id IS NULL ORDER BY active DESC LIMIT 1`).get(homeId, fallback, id) as { id: string; name: string } | undefined;
        if (target) db.prepare(`UPDATE ${table} SET active = 1 WHERE id = ? AND home_id = ?`).run(target.id, homeId);
        if (!target) {
          target = { id: randomUUID(), name: fallback };
          db.prepare(`INSERT INTO ${table} (id, home_id, name) VALUES (?, ?, ?)`).run(target.id, homeId, target.name);
        }
      }
      destination = target?.name ?? null;
      for (const item of linkedItems) {
        const quantity = stockRows.find(row => row.itemId === item.id)?.quantity ?? 0;
        const reason = `${kind === "category" ? "分类" : "位置"}变更：${node.name} → ${target!.name}（原节点已删除）`;
        const eventId = event(item, kind === "category" ? "reclassify" : "move", reason, kind === "location" ? target!.id : null);
        if (quantity > 0) {
          ledger(eventId, item.id, id, "issue", quantity, reason);
          ledger(eventId, item.id, target!.id, "receipt", quantity, reason);
        }
      }
      if (target) {
        if (kind === "category") {
          db.prepare("UPDATE items SET category = ? WHERE home_id = ? AND active = 1 AND category = ?").run(target.name, homeId, node.name);
          db.prepare("UPDATE shopping_list SET category = ? WHERE home_id = ? AND category = ?").run(target.name, homeId, node.name);
        } else {
          db.prepare("UPDATE items SET default_location_id = ? WHERE home_id = ? AND active = 1 AND default_location_id = ?").run(target.id, homeId, id);
          db.prepare("UPDATE shopping_list SET location_id = ? WHERE home_id = ? AND location_id = ?").run(target.id, homeId, id);
        }
      }
      // Free this category's sibling name before promoting its children.
      if (kind === "category") db.prepare("UPDATE item_categories SET name = ? WHERE id = ?").run(`deleted:${id}`, id);
      db.prepare(`UPDATE ${table} SET parent_id = ? WHERE home_id = ? AND parent_id = ?`).run(parent?.id ?? null, homeId, id);
      if (kind === "category") db.prepare("DELETE FROM item_categories WHERE id = ? AND home_id = ?").run(id, homeId);
      else db.prepare("UPDATE locations SET active = 0 WHERE id = ? AND home_id = ?").run(id, homeId);
      affectedItems = linkedItems.length;
    }
    db.exec("COMMIT");
    return { id, deleted: true, affectedItems, destination };
  } catch (error) {
    db.exec("ROLLBACK");
    if (String(error).includes("UNIQUE")) throw new DeleteError(409, "上一级存在同名节点或默认归属名称已被占用，请先重命名后再删除");
    throw error;
  }
}
