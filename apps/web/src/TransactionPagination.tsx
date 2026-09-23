import { ArrowLeft, ArrowRight } from "lucide-react";
import { PageSizeSelect } from "./PageSizeSelect.js";
import i18n from "./i18n/index.js";
const t = i18n.t.bind(i18n);

type Props = {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
};
export function TransactionPagination({
  total,
  page,
  pageSize,
  pageCount,
  onPage,
  onPageSize,
}: Props) {
  if (total <= 0) return null;
  return (
    <div className="pagination">
      <PageSizeSelect
        value={pageSize}
        onChange={(size) => {
          onPageSize(size);
          onPage(1);
        }}
      />
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}{" "}
        {t("/ 共")} {total} {t("条")}
      </span>
      <button
        type="button"
        aria-label={t("上一页")}
        disabled={page === 1}
        onClick={() => onPage(page - 1)}
      >
        <ArrowLeft size={15} />
      </button>
      <span>
        {page} / {pageCount}
      </span>
      <button
        type="button"
        aria-label={t("下一页")}
        disabled={page === pageCount}
        onClick={() => onPage(page + 1)}
      >
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
