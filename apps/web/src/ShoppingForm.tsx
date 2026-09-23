import {ConsumptionFields} from "./ConsumptionFields.js";
import { X } from "lucide-react";
import type * as React from "react";
import { FormEvent } from "react";
import { UnitOptions } from "./AppElements.js";
import { ItemCombobox } from "./ItemCombobox.js";
import i18n from "./i18n/index.js";
import { categoryLabel, channelLabel } from "./systemLabels.js";
import type { Category, Item, Location, ShoppingChannel } from "./webTypes.js";
const t = i18n.t.bind(i18n);
type ShoppingFormProps = {
  setShowShoppingForm: React.Dispatch<React.SetStateAction<boolean>>;
  setShoppingItemId: React.Dispatch<React.SetStateAction<string>>;
  addShoppingItem: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  shoppingItemId: string;
  linkedShoppingItem: Item | undefined;
  items: Item[];
  selectCategoryOptions:
    | (Category & { depth: number })[]
    | { id: string; name: string; parentId: null; depth: number }[];
  locationOptions: (Location & { depth: number })[];
  shoppingChannels: ShoppingChannel[];
};
export function ShoppingForm({
  setShowShoppingForm,
  setShoppingItemId,
  addShoppingItem,
  shoppingItemId,
  linkedShoppingItem,
  items,
  selectCategoryOptions,
  locationOptions,
  shoppingChannels,
}: ShoppingFormProps) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget &&
        (setShowShoppingForm(false), setShoppingItemId(""))
      }
    >
      <form className="modal" onSubmit={addShoppingItem}>
        <div className="modal-head">
          <div>
            <h2>{t("添加采购项")}</h2>
            <p className="muted">{t("手动加入采购清单")}</p>
          </div>
          <button
            type="button"
            className="close"
            onClick={() => {
              setShowShoppingForm(false);
              setShoppingItemId("");
            }}
            aria-label={t("关闭")}
          >
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>
        <label>
          {t("名称")}
          <input
            key={`shopping-name-${shoppingItemId}`}
            name="name"
            required
            defaultValue={linkedShoppingItem?.name || ""}
            placeholder={t("例如：纸巾")}
            disabled={Boolean(linkedShoppingItem)}
          />
        </label>
        <ItemCombobox
          items={items}
          value={shoppingItemId}
          onChange={setShoppingItemId}
        />
        <ConsumptionFields key={`consumption-${shoppingItemId}`} consumptionType={linkedShoppingItem?.consumptionType} openedShelfLifeDays={linkedShoppingItem?.openedShelfLifeDays} disabled={Boolean(linkedShoppingItem)}/>
        <div className="form-row">
          <label>
            {t("数量")}
            <input
              name="quantity"
              type="number"
              min="0"
              step="any"
              defaultValue="1"
            />
          </label>
          <label>
            {t("单位")}
            <select
              key={`shopping-unit-${shoppingItemId}`}
              name="unit"
              defaultValue={linkedShoppingItem?.baseUnit || "个"}
              disabled={Boolean(linkedShoppingItem)}
            >
              <UnitOptions current={linkedShoppingItem?.baseUnit} />
            </select>
          </label>
        </div>
        <label>
          {t("种类")}
          <select
            key={`shopping-category-${shoppingItemId}`}
            name="category"
            defaultValue={linkedShoppingItem?.category || "其他"}
            disabled={Boolean(linkedShoppingItem)}
          >
            {selectCategoryOptions.map((category) => (
              <option key={category.id} value={category.name}>
                {"　".repeat(category.depth)}
                {categoryLabel(category.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("存放地点")}
          <select
            key={`shopping-location-${shoppingItemId}-${locationOptions[0]?.id ?? ""}`}
            name="locationId"
            defaultValue={
              linkedShoppingItem?.locationId || locationOptions[0]?.id || ""
            }
            disabled={Boolean(linkedShoppingItem)}
          >
            <option value="">{t("暂不指定")}</option>
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
            {t("购买渠道")}
            <select name="channelId" defaultValue="">
              <option value="">{t("未安排")}</option>
              {shoppingChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channelLabel(channel.name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("计划采购日")}
            <input name="plannedDate" type="date" />
          </label>
          <label>
            {t("预计总价")}
            <input
              name="estimatedTotal"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
            />
          </label>
        </div>
        <button className="primary full">{t("加入采购清单")}</button>
      </form>
    </div>
  );
}
