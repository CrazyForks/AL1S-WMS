import { ArrowLeft, ArrowRight } from "lucide-react";
import type * as React from "react";
import { FormEvent, type KeyboardEvent } from "react";
import {
  BudgetAllocationEditor,
  BudgetCategoryPicker,
  BudgetExecution,
} from "./BudgetCategories.js";
import {
  FinancePurchases,
  FinanceTrend,
  InventoryCostWaste,
} from "./FinanceReports.js";
import { getFinancialSummary, getHomeId } from "./apiClient.js";
import { removeBudgetAllocation, setBudgetAllocation } from "./budgetTree.js";
import { formatMoney } from "./formatMoney.js";
import i18n from "./i18n/index.js";
import { adjacentMonth } from "./purchaseSchedule.js";
import { channelLabel } from "./systemLabels.js";
import type { Category, FinancialSummary } from "./webTypes.js";
const t = i18n.t.bind(i18n);
type FinancePageProps = {
  setFinanceMonth: React.Dispatch<React.SetStateAction<string>>;
  financeMonth: string;
  financeDashboard: FinancialSummary;
  saveFinanceBudget: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  financeFlowRef: React.RefObject<HTMLDivElement | null>;
  financeFlowSize: { width: number; height: number };
  financeBudgetLinks: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  }[];
  financeBudgetOriginRef: React.RefObject<HTMLDivElement | null>;
  financeBudgetTotal: string;
  setFinanceBudgetTotal: React.Dispatch<React.SetStateAction<string>>;
  financeAllocatedBudget: number;
  categories: Category[];
  financeBudgetEntries: { category: string; amount: string }[];
  financeCategorySelection: string;
  setFinanceCategorySelection: React.Dispatch<React.SetStateAction<string>>;
  financeCategoryAmount: string;
  setFinanceCategoryAmount: React.Dispatch<React.SetStateAction<string>>;
  addFinanceCategoryBudgetOnEnter: (
    event: KeyboardEvent<HTMLInputElement>,
  ) => void;
  addFinanceCategoryBudget: () => void;
  financeBudgetListRef: React.RefObject<HTMLDivElement | null>;
  financeBudgetEntryRefs: React.RefObject<
    Record<string, HTMLDivElement | null>
  >;
  setFinanceBudgetEntries: React.Dispatch<
    React.SetStateAction<{ category: string; amount: string }[]>
  >;
  financeSaving: boolean;
  financeAllocations: {
    rows: {
      amount: number;
      path: string[];
      parent: string | null;
      allocated: number;
      unallocated: number;
      category: string;
    }[];
    total: number;
  };
  openItemDetail: (itemId: string) => void;
  setFinanceDashboard: React.Dispatch<
    React.SetStateAction<FinancialSummary | null>
  >;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  load: () => Promise<void>;
};
export function FinancePage({
  setFinanceMonth,
  financeMonth,
  financeDashboard,
  saveFinanceBudget,
  financeFlowRef,
  financeFlowSize,
  financeBudgetLinks,
  financeBudgetOriginRef,
  financeBudgetTotal,
  setFinanceBudgetTotal,
  financeAllocatedBudget,
  categories,
  financeBudgetEntries,
  financeCategorySelection,
  setFinanceCategorySelection,
  financeCategoryAmount,
  setFinanceCategoryAmount,
  addFinanceCategoryBudgetOnEnter,
  addFinanceCategoryBudget,
  financeBudgetListRef,
  financeBudgetEntryRefs,
  setFinanceBudgetEntries,
  financeSaving,
  financeAllocations,
  openItemDetail,
  setFinanceDashboard,
  setNotice,
  load,
}: FinancePageProps) {
  return (
    <div className="finance-page">
      <div className="finance-section-title">
        <div>
          <h2>{t("预算与支出")}</h2>
          <p>{t("安排采购预算，追踪实际支出与待采购计划")}</p>
        </div>
      </div>
      <section className="finance-toolbar">
        <div className="finance-month-nav">
          <button
            type="button"
            className="secondary"
            aria-label={t("上个月")}
            onClick={() => setFinanceMonth((month) => adjacentMonth(month, -1))}
          >
            <ArrowLeft size={16} />
          </button>
          <label>
            {t("统计月份")}
            <input
              type="month"
              value={financeMonth}
              onChange={(event) => {
                if (event.target.value) setFinanceMonth(event.target.value);
              }}
            />
          </label>
          <button
            type="button"
            className="secondary"
            aria-label={t("下个月")}
            onClick={() => setFinanceMonth((month) => adjacentMonth(month, 1))}
          >
            <ArrowRight size={16} />
          </button>
        </div>
        <span>{t("入库日期决定实际支出归属月份")}</span>
      </section>
      <section className="finance-kpis">
        {[
          [t("月度预算"), financeDashboard.budgetTotal],
          [t("实际支出"), financeDashboard.spendingTotal],
          [t("待采购预计"), financeDashboard.estimatedTotal],
          [t("预测支出"), financeDashboard.forecastTotal],
          [t("剩余预算"), financeDashboard.remainingBudget],
        ].map(([label, value]) => (
          <div
            className={`finance-kpi ${label === t("剩余预算") && typeof value === "number" && value < 0 ? "over" : ""}`}
            key={String(label)}
          >
            <small>{label}</small>
            <strong>
              {value === null
                ? t("未设置")
                : formatMoney(Number(value), financeDashboard.currency)}
            </strong>
          </div>
        ))}
      </section>
      <section className="finance-layout">
        <FinanceTrend
          key={getHomeId()}
          homeId={getHomeId()}
          month={financeMonth}
          revision={financeDashboard}
        />
        <form className="panel finance-budget" onSubmit={saveFinanceBudget}>
          <div className="panel-head">
            <div>
              <h2>{t("预算设置")}</h2>
              {financeDashboard.budgetMode === "inherited" && (
                <p className="muted">
                  {t("沿用预算")} · {financeDashboard.budgetSourceMonth}
                </p>
              )}
            </div>
            <span className={`budget-mode ${financeDashboard.budgetMode}`}>
              {financeDashboard.budgetMode === "inherited"
                ? t("沿用预算")
                : financeDashboard.budgetMode === "explicit"
                  ? t("本月预算")
                  : t("未设置")}
            </span>
          </div>
          <div className="finance-budget-body">
            <div className="finance-budget-flow" ref={financeFlowRef}>
              {financeFlowSize.width > 0 && (
                <svg
                  className="budget-flow-lines"
                  viewBox={`0 0 ${financeFlowSize.width} ${financeFlowSize.height}`}
                  aria-hidden="true"
                >
                  {financeBudgetLinks.map((link, index) => {
                    const span = Math.max(60, link.toX - link.fromX);
                    return (
                      <path
                        key={index}
                        d={`M ${link.fromX} ${link.fromY} C ${link.fromX + span * 0.46} ${link.fromY}, ${link.toX - span * 0.4} ${link.toY}, ${link.toX} ${link.toY}`}
                      />
                    );
                  })}
                </svg>
              )}
              <div className="finance-budget-overview">
                <div
                  className="finance-budget-source"
                  ref={financeBudgetOriginRef}
                >
                  <label>
                    {t("月度总预算")}
                    <input
                      value={financeBudgetTotal}
                      onChange={(event) =>
                        setFinanceBudgetTotal(event.target.value)
                      }
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                    />
                  </label>
                  <div className="budget-allocation">
                    <span>{t("已分配")}</span>
                    <strong>
                      {formatMoney(
                        financeAllocatedBudget,
                        financeDashboard.currency,
                      )}
                    </strong>
                    <small>
                      {t("可分配")}{" "}
                      {financeBudgetTotal.trim() === ""
                        ? t("未设置")
                        : formatMoney(
                            Number(financeBudgetTotal) - financeAllocatedBudget,
                            financeDashboard.currency,
                          )}
                    </small>
                  </div>
                </div>
                <div className="budget-add">
                  <div>
                    <strong>{t("添加分类预算")}</strong>
                  </div>
                  <div className="budget-category-picker">
                    <BudgetCategoryPicker
                      categories={categories}
                      entries={financeBudgetEntries}
                      value={financeCategorySelection}
                      onChange={setFinanceCategorySelection}
                    />
                    <input
                      value={financeCategoryAmount}
                      onChange={(event) =>
                        setFinanceCategoryAmount(event.target.value)
                      }
                      onKeyDown={addFinanceCategoryBudgetOnEnter}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={t("预算金额")}
                    />
                    <button
                      type="button"
                      className="secondary"
                      disabled={
                        !financeCategorySelection ||
                        financeCategoryAmount.trim() === ""
                      }
                      onClick={addFinanceCategoryBudget}
                    >
                      {t("添加")}
                    </button>
                  </div>
                </div>
              </div>
              <div className="finance-budget-editor">
                <div className="budget-editor-head">
                  <div>
                    <strong>{t("分类预算")}</strong>
                  </div>
                  <b>
                    {formatMoney(
                      financeAllocatedBudget,
                      financeDashboard.currency,
                    )}
                  </b>
                </div>
                <div
                  className="category-budget-list"
                  ref={financeBudgetListRef}
                >
                  {financeBudgetEntries.length ? (
                    <BudgetAllocationEditor
                      categories={categories}
                      entries={financeBudgetEntries}
                      currency={financeDashboard.currency}
                      entryRef={(category, node) => {
                        financeBudgetEntryRefs.current[category] = node;
                      }}
                      onChange={(category, amount) =>
                        setFinanceBudgetEntries((entries) =>
                          setBudgetAllocation(
                            categories,
                            entries,
                            category,
                            amount,
                          ),
                        )
                      }
                      onRemove={(category) =>
                        setFinanceBudgetEntries((entries) =>
                          removeBudgetAllocation(categories, entries, category),
                        )
                      }
                    />
                  ) : (
                    <p className="muted">{t("尚未添加分类预算")}</p>
                  )}
                </div>
              </div>
            </div>
            <div className="finance-budget-actions">
              {financeBudgetTotal.trim() !== "" &&
                financeAllocatedBudget > Number(financeBudgetTotal) && (
                  <small role="alert">{t("分类预算合计不得超过总预算")}</small>
                )}
              <button
                className="primary"
                disabled={
                  financeSaving ||
                  financeAllocations.rows.some((row) => row.unallocated < 0)
                }
              >
                {financeSaving ? t("保存中…") : t("保存预算")}
              </button>
            </div>
          </div>
        </form>
        <BudgetExecution
          key={`${getHomeId()}:${financeMonth}`}
          categories={categories}
          spending={financeDashboard.categorySpending ?? []}
          budgets={financeDashboard.categoryBudgets}
          currency={financeDashboard.currency}
        />
        <section className="panel finance-bars">
          <div className="panel-head">
            <div>
              <h2>{t("渠道支出")}</h2>
              <p className="muted">{t("已完成采购")}</p>
            </div>
          </div>
          <div className="bar-list">
            {financeDashboard.byChannel.length ? (
              financeDashboard.byChannel.map((row) => {
                const max = Math.max(
                  1,
                  ...financeDashboard.byChannel.map((item) => item.total),
                );
                return (
                  <div className="bar-row" key={row.channelId ?? "none"}>
                    <span>{channelLabel(row.channelName)}</span>
                    <div>
                      <i style={{ width: `${(row.total / max) * 100}%` }} />
                    </div>
                    <b>{formatMoney(row.total, financeDashboard.currency)}</b>
                  </div>
                );
              })
            ) : (
              <p className="empty">{t("本月暂无渠道支出")}</p>
            )}
          </div>
        </section>
      </section>
      <FinancePurchases
        key={getHomeId()}
        homeId={getHomeId()}
        revision={financeDashboard}
        onOpenItem={openItemDetail}
      />
      <InventoryCostWaste
        key={`${getHomeId()}:inventory-cost`}
        homeId={getHomeId()}
        revision={financeDashboard}
        onOpenItem={openItemDetail}
        onCostsChanged={() => {
          void getFinancialSummary(financeMonth)
            .then(setFinanceDashboard)
            .catch((error) => setNotice(error.message));
          void load();
        }}
      />
    </div>
  );
}
