import { X } from "lucide-react";
import type * as React from "react";
import { FormEvent } from "react";
import { BatchFields } from "./BatchFields.js";
import i18n, { displayUnit, localeForDates } from "./i18n/index.js";
import type {
  FinancialSummary,
  Item,
  Location,
  ShoppingItem,
} from "./webTypes.js";
const t = i18n.t.bind(i18n);
type ReceiveShoppingDialogProps = {
  setReceiveShoppingItem: React.Dispatch<
    React.SetStateAction<ShoppingItem | null>
  >;
  receiveShopping: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  receiveShoppingItem: ShoppingItem;
  receiveQuantity: string;
  setReceiveQuantity: React.Dispatch<React.SetStateAction<string>>;
  items: Item[];
  locations: Location[];
  locationOptions: (Location & { depth: number })[];
  receiveTotal: string;
  receiveCompletion: "keep" | "complete";
  setReceiveCompletion: React.Dispatch<React.SetStateAction<"keep" | "complete">>;
  setReceiveTotal: React.Dispatch<React.SetStateAction<string>>;
  receiveUnitPrice: number | null;
  financialSummary: FinancialSummary | null;
  busy: boolean;
};
export function ReceiveShoppingDialog({
  setReceiveShoppingItem,
  receiveShopping,
  receiveShoppingItem,
  receiveQuantity,
  setReceiveQuantity,
  items,
  locations,
  locationOptions,
  receiveTotal,
  setReceiveTotal,
  receiveCompletion,
  setReceiveCompletion,
  receiveUnitPrice,
  financialSummary,
  busy,
}: ReceiveShoppingDialogProps) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && setReceiveShoppingItem(null)
      }
    >
      <form className="modal" onSubmit={receiveShopping}>
        <div className="modal-head">
          <div>
            <h2>{t("采购入库")}</h2>
            <p className="muted">
              {receiveShoppingItem.name} · {t("待采购")}{" "}
              {receiveShoppingItem.quantity}{" "}
              {displayUnit(receiveShoppingItem.unit) || t("件")}
            </p>
          </div>
          <button
            type="button"
            className="close"
            onClick={() => setReceiveShoppingItem(null)}
            aria-label={t("关闭")}
          >
            <X size={18} />
          </button>
        </div>
        <label>
          {t("实际入库数量")}
          <input
            name="quantity"
            type="number"
            min="0"
            step="any"
            value={receiveQuantity}
            onChange={(event) => setReceiveQuantity(event.target.value)}
            autoFocus
            required
          />
        </label>
        <label>
          {t("入库地点")}
          <select
            name="locationId"
            defaultValue={
              items.find((item) => item.id === receiveShoppingItem.itemId)
                ?.locationId ||
              receiveShoppingItem.locationId ||
              locations[0]?.id ||
              ""
            }
            required
          >
            {locationOptions.map((location) => (
              <option key={location.id} value={location.id}>
                {"　".repeat(location.depth)}
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            {t("实付总价")}
            <input
              name="totalPrice"
              type="number"
              min="0"
              step="0.01"
              value={receiveTotal}
              onChange={(event) => setReceiveTotal(event.target.value)}
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
        </div>
        <label>{t("收货后采购项")}
          <select value={receiveCompletion} onChange={event=>setReceiveCompletion(event.target.value as "keep"|"complete")}>
            <option value="complete">{t("完成采购项")}</option>
            <option value="keep">{t("保留剩余待收数量")}</option>
          </select>
        </label>
        <p className="muted" aria-live="polite">
          {t("折合单价")}：
          {receiveUnitPrice === null
            ? "—"
            : `${new Intl.NumberFormat(localeForDates(), { style: "currency", currency: financialSummary?.currency ?? "CNY", maximumFractionDigits: 4 }).format(receiveUnitPrice)} / ${displayUnit(receiveShoppingItem.unit) || t("件")}`}
        </p>
        <BatchFields title={t("采购入库批次（可选）")} />
        <button className="primary full" disabled={busy}>
          {busy ? t("入库中…") : t("确认入库")}
        </button>
      </form>
    </div>
  );
}
