import {
  ArrowRight,
  Bot,
  Cat,
  Dog,
  Trash2,
  UserRound,
  Venus,
} from "lucide-react";
import { formatDateTime } from "./displayDates.js";
import i18n, { displayUnit } from "./i18n/index.js";
import type { Transaction, UserAvatar } from "./webTypes.js";
const t = i18n.t.bind(i18n);
export const unitOptions = [
  "个",
  "瓶",
  "盒",
  "包",
  "箱",
  "袋",
  "罐",
  "桶",
  "卷",
  "支",
  "根",
  "条",
  "片",
  "张",
  "块",
  "颗",
  "把",
  "双",
  "套",
  "份",
  "克",
  "市斤",
  "千克",
  "毫升",
  "升",
  "厘米",
  "米",
  "其他",
] as const;

export function UnitOptions({ current }: { current?: string | null }) {
  return (
    <>
      {current && !unitOptions.some((unit) => unit === current) && (
        <option value={current}>{displayUnit(current)}</option>
      )}
      {unitOptions.map((unit) => (
        <option key={unit} value={unit}>
          {displayUnit(unit)}
        </option>
      ))}
    </>
  );
}

export const avatarOptions: {
  value: UserAvatar;
  label: string;
  Icon: typeof UserRound;
}[] = [
  { value: "user", label: "男", Icon: UserRound },
  { value: "woman", label: "女", Icon: Venus },
  { value: "cat", label: "猫", Icon: Cat },
  { value: "dog", label: "狗", Icon: Dog },
  { value: "bot", label: "机器人", Icon: Bot },
];

export function AvatarIcon({
  avatar,
  size = 16,
}: {
  avatar?: UserAvatar | null;
  size?: number;
}) {
  const Icon =
    avatarOptions.find((option) => option.value === avatar)?.Icon ?? UserRound;
  return <Icon size={size} aria-hidden="true" />;
}

export function TransactionRow({
  transaction,
  onOpenItem,
}: {
  transaction: Transaction;
  onOpenItem?: (itemId: string) => void;
}) {
  const labels = {
    receipt: t("入库"),
    issue: t("领用"),
    delete: t("删除"),
    reclassify: t("分类变更"),
    move: t("位置变更"),
    update: t("批次变更"),
  };
  const stockChange =
    transaction.type === "receipt" || transaction.type === "issue";
  return (
    <div className="log-row">
      <span
        className={`log-badge ${transaction.type}`}
        title={labels[transaction.type]}
      >
        {transaction.type === "delete" ? (
          <Trash2 size={14} />
        ) : stockChange ? (
          transaction.type === "receipt" ? (
            "+"
          ) : (
            "−"
          )
        ) : (
          <ArrowRight size={14} />
        )}
      </span>
      <div>
        {onOpenItem ? (
          <button
            type="button"
            className="item-link"
            onClick={() => onOpenItem(transaction.itemId)}
          >
            {transaction.itemName}
          </button>
        ) : (
          <strong>{transaction.itemName}</strong>
        )}
        <small>
          {[
            transaction.locationName,
            transaction.reason || labels[transaction.type],
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </div>
      <b className={transaction.type}>
        {stockChange
          ? `${transaction.type === "receipt" ? "+" : "−"}${transaction.quantity}`
          : labels[transaction.type]}
      </b>
      <time>{formatDateTime(transaction.occurredAt)}</time>
    </div>
  );
}

export function BrandWordmark() {
  return (
    <strong className="brand-wordmark">
      <b>AL</b>
      <i>1</i>
      <b>S</b>
      <small>WMS</small>
    </strong>
  );
}
