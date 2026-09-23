import { X } from "lucide-react";
import type * as React from "react";
import { FormEvent } from "react";
import { BatchFields } from "./BatchFields.js";
import { BatchSelect } from "./Batches.js";
import { getHomeId } from "./apiClient.js";
import i18n from "./i18n/index.js";
import { channelLabel } from "./systemLabels.js";
import type { Item, Location, ShoppingChannel } from "./webTypes.js";
const t = i18n.t.bind(i18n);
type StockDialogProps = {
  setStockAction: React.Dispatch<
    React.SetStateAction<{ type: "receipt" | "issue"; item: Item } | null>
  >;
  recordStock: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  stockAction: { type: "receipt" | "issue"; item: Item };
  stockLocationId: string;
  setStockLocationId: React.Dispatch<React.SetStateAction<string>>;
  locationOptions: (Location & { depth: number })[];
  shoppingChannels: ShoppingChannel[];
  expiryStatusFor: (item: Item) => { level: string; label: string };
  busy: boolean;
};
export function StockDialog({
  setStockAction,
  recordStock,
  stockAction,
  stockLocationId,
  setStockLocationId,
  locationOptions,
  shoppingChannels,
  expiryStatusFor,
  busy,
}: StockDialogProps) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && setStockAction(null)
      }
    >
      <form className="modal" onSubmit={recordStock}>
        <div className="modal-head">
          <div>
            <h2>
              {stockAction.type === "receipt"
                ? t("入库物资")
                : stockAction.item.consumptionType === "long_term_consumable"
                  ? t("开封物资")
                  : t("领用物资")}
            </h2>
            <p className="muted">{stockAction.item.name}</p>
          </div>
          <button
            type="button"
            className="close"
            onClick={() => setStockAction(null)}
            aria-label={t("关闭")}
          >
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <label>
          {t("存放地点")}
          <select
            name="locationId"
            value={stockLocationId}
            onChange={(event) => setStockLocationId(event.target.value)}
          >
            {locationOptions.map((location) => (
              <option key={location.id} value={location.id}>
                {"　".repeat(location.depth)}
                {location.name}
              </option>
            ))}
          </select>
        </label>
        {stockAction.type === "receipt" ? (
          <BatchFields title={t("新入库批次（可选）")} />
        ) : stockLocationId ? (
          <BatchSelect
            homeId={getHomeId()}
            itemId={stockAction.item.id}
            locationId={stockLocationId}
          />
        ) : null}
        {stockAction.type === "receipt" && (
          <fieldset className="purchase-cost">
            <legend>{t("采购成本（可选）")}</legend>
            <div className="form-row">
              <label>
                {t("实付总价")}
                <input
                  name="totalPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                />
              </label>
              <label>
                {t("采购日期")}
                <input
                  name="purchaseDate"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </label>
              <label>
                {t("购买渠道")}
                <select name="channelId" defaultValue="">
                  <option value="">{t("未指定")}</option>
                  {shoppingChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channelLabel(channel.name)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>
        )}
        {stockAction.type === "issue" &&
          stockAction.item.consumptionType !== "long_term_consumable" && (
            <label>
              {t("领用类型")}
              <select
                name="issueReason"
                defaultValue={
                  expiryStatusFor(stockAction.item).level === "expired"
                    ? "expired"
                    : stockAction.item.consumptionType === "non_consumable"
                      ? "damaged"
                      : "used"
                }
              >
                {stockAction.item.consumptionType !== "non_consumable" && (
                  <option value="used">{t("正常使用")}</option>
                )}
                <option value="expired">{t("过期报废")}</option>
                <option value="damaged">{t("损坏")}</option>
              </select>
            </label>
          )}
        <label>
          {t("数量")}
          <input
            name="quantity"
            type="number"
            min="0"
            step="any"
            defaultValue="1"
            autoFocus
            required
          />
        </label>
        <label>
          {t("备注（可选）")}
          <input name="reason" placeholder={t("例如：本周采购")} />
        </label>
        <button className="primary full" disabled={busy}>
          {busy
            ? t("处理中…")
            : t("确认{{action}}", {
                action:
                  stockAction.type === "receipt"
                    ? t("入库")
                    : stockAction.item.consumptionType ===
                        "long_term_consumable"
                      ? t("开封")
                      : t("领用"),
              })}
        </button>
      </form>
    </div>
  );
}
