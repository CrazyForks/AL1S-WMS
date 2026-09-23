import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export function pageQuery(
  db: DatabaseSync,
  sql: string,
  params: SQLInputValue[],
  limit: number,
  offset: number,
  order: string,
) {
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params) as {
      n: number;
    }
  ).n;
  const items = db
    .prepare(`SELECT * FROM (${sql}) ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const nextOffset =
    offset + items.length < total ? offset + items.length : null;
  return {
    items,
    total,
    limit,
    offset,
    hasMore: nextOffset !== null,
    nextOffset,
  };
}

export const itemBalanceSqlFor = (alias: "i" | "items") =>
  `(SELECT ROUND(COALESCE(SUM(CASE WHEN type='receipt' THEN quantity ELSE -quantity END),0),2) FROM stock_transactions WHERE home_id=${alias}.home_id AND item_id=${alias}.id)`;
export const itemBalanceSql = itemBalanceSqlFor("i");
