import {ConsumptionFields} from "./ConsumptionFields.js";
import { X } from "lucide-react";
import type * as React from "react";
import { FormEvent } from "react";
import { UnitOptions } from "./AppElements.js";
import { ItemCombobox } from "./ItemCombobox.js";
import i18n from "./i18n/index.js";
import { categoryLabel, channelLabel } from "./systemLabels.js";
import type {
  Category,
  Item,
  Location,
  ShoppingChannel,
  ShoppingItem,
} from "./webTypes.js";
const t = i18n.t.bind(i18n);
type EditShoppingDialogProps = {
  setEditShoppingItem: React.Dispatch<
    React.SetStateAction<ShoppingItem | null>
  >;
  setEditShoppingItemId: React.Dispatch<React.SetStateAction<string>>;
  updateShoppingItem: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  editShoppingItemId: string;
  linkedEditShoppingItem: Item | undefined;
  editShoppingItem: ShoppingItem;
  items: Item[];
  selectCategoryOptions:
    | (Category & { depth: number })[]
    | { id: string; name: string; parentId: null; depth: number }[];
  locationOptions: (Location & { depth: number })[];
  shoppingChannels: ShoppingChannel[];
};
export function EditShoppingDialog({
  setEditShoppingItem,
  setEditShoppingItemId,
  updateShoppingItem,
  editShoppingItemId,
  linkedEditShoppingItem,
  editShoppingItem,
  items,
  selectCategoryOptions,
  locationOptions,
  shoppingChannels,
}: EditShoppingDialogProps) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget &&
        (setEditShoppingItem(null), setEditShoppingItemId(""))
      }
    >
      <form className="modal" onSubmit={updateShoppingItem}>
        <div className="modal-head">
          <div>
            <h2>{t("编辑采购项")}</h2>
            <p className="muted">{t("修改采购数量和入库信息")}</p>
          </div>
          <button
            type="button"
            className="close"
            onClick={() => {
              setEditShoppingItem(null);
              setEditShoppingItemId("");
            }}
            aria-label={t("关闭")}
          >
            <X size={18} />
          </button>
        </div>
        <label>
          {t("名称")}
          <input
            key={`edit-shopping-name-${editShoppingItemId}`}
            name="name"
            required
            defaultValue={linkedEditShoppingItem?.name || editShoppingItem.name}
            disabled={Boolean(linkedEditShoppingItem)}
          />
        </label>
        <ItemCombobox
          items={items}
          value={editShoppingItemId}
          onChange={setEditShoppingItemId}
        />
        <ConsumptionFields key={`consumption-${editShoppingItemId}`} consumptionType={linkedEditShoppingItem?.consumptionType??editShoppingItem.consumptionType} openedShelfLifeDays={linkedEditShoppingItem?linkedEditShoppingItem.openedShelfLifeDays:editShoppingItem.openedShelfLifeDays} disabled={Boolean(linkedEditShoppingItem)}/>
        <div className="form-row">
          <label>
            {t("数量")}
            <input
              name="quantity"
              type="number"
              min="0"
              step="any"
              defaultValue={editShoppingItem.quantity}
            />
          </label>
          <label>
            {t("单位")}
            <select
              key={`edit-shopping-unit-${editShoppingItemId}`}
              name="unit"
              defaultValue={
                linkedEditShoppingItem?.baseUnit ||
                editShoppingItem.unit ||
                "个"
              }
              disabled={Boolean(linkedEditShoppingItem)}
            >
              <UnitOptions
                current={
                  linkedEditShoppingItem?.baseUnit || editShoppingItem.unit
                }
              />
            </select>
          </label>
        </div>
        <label>
          {t("种类")}
          <select
            key={`edit-shopping-category-${editShoppingItemId}`}
            name="category"
            defaultValue={
              linkedEditShoppingItem?.category ||
              editShoppingItem.category ||
              "其他"
            }
            disabled={Boolean(linkedEditShoppingItem)}
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
            key={`edit-shopping-location-${editShoppingItemId}`}
            name="locationId"
            defaultValue={
              linkedEditShoppingItem?.locationId ||
              editShoppingItem.locationId ||
              ""
            }
            disabled={Boolean(linkedEditShoppingItem)}
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
            <select
              name="channelId"
              defaultValue={editShoppingItem.channelId || ""}
            >
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
            <input
              name="plannedDate"
              type="date"
              defaultValue={editShoppingItem.plannedDate || ""}
            />
          </label>
          <label>
            {t("预计总价")}
            <input
              name="estimatedTotal"
              type="number"
              min="0"
              step="0.01"
              defaultValue={editShoppingItem.estimatedTotal ?? ""}
              placeholder="0.00"
            />
          </label>
        </div>
        <button className="primary full">{t("保存修改")}</button>
      </form>
    </div>
  );
}
