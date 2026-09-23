# 功能与调用链导航

从功能表找入口，再沿“视图 → 前端处理 → HTTP 路由 → 业务模块 → 数据”阅读。本文用符号名定位，不依赖易失效的行号。

## 先理解模块边界

- [Web App](../apps/web/src/App.tsx) 持有共享状态、Effect、业务回调及页面组合。页面组件主要接收数据和回调，但并非全部无副作用：`ProfilePage` 仍含家庭保存请求，`FinanceReports`、`ItemDetail`、`Batches` 等会自行读取数据。
- [读取客户端](../apps/web/src/apiClient.ts) 提供按当前家庭读取的方法；[apiFetch / apiJson](../apps/web/src/i18n/apiFetch.ts) 注入语言头、构造请求。`apiJson` 返回原始 Response，不负责重试、错误提示或刷新。
- [API app](../apps/api/src/app.ts) 的 `buildApp(db)` 注册认证钩子和路由，并保留家庭、物资、分类、地点、批次等部分 CRUD。测试可注入内存数据库。
- [数据库入口](../packages/db/src/index.ts) 的 `openDatabase` 创建和升级 SQLite 表；库存由流水计算，业务写入主要使用原生 SQL。不要只查看 [Drizzle schema](../packages/db/src/schema.ts) 来判断数据库结构。

下表前端文件均相对 `apps/web/src/`，后端文件均相对 `apps/api/src/`。家庭路由前缀统一为 `/api/v1/homes/:homeId`；表中列出其后缀。

## 按功能定位

| 功能 | 页面与交互入口 | 前端操作/状态入口 | 路由与后端实现 | 优先阅读的测试 |
| --- | --- | --- | --- | --- |
| 初始化、登录、退出 | `AuthScreens.tsx`：`Setup`、`Login` | AuthScreens 提交请求；`App.logout` 及 setup/authenticated 状态 | `/api/v1/setup`、`/api/v1/auth/login`、`/api/v1/auth/logout`；`app.ts`、`auth.ts:createAuth` | API `auth.test.ts`、`mcp-workflow.test.ts`；Web `pageBehavior.test.ts` |
| 家庭、账号、令牌 | `ProfilePage.tsx`：`ProfileUserSettings`、`ProfileHomeSettings`、`ProfileTokens` | `App.updateAvatar`、`changePassword`、`updateHomeCurrency`、`createApiToken`、`revokeApiToken`；家庭保存还在 ProfileHomeSettings 内 | `/api/v1/homes`、`/api/v1/auth/*`；`app.ts`、`auth.ts` | API `auth.test.ts`、`mcp-workflow.test.ts` |
| 首页概览 | `DashboardPage.tsx`；顶部统计仍在 App | `App.load`、`dashboardItems`、`shoppingItems`、分类/地点汇总 | Web 聚合多个读取接口；独立 `/overview` 接口在 `queries.ts:getHomeOverview`，不要误认为首页只调用它 | API `stock.test.ts`、`queries.test.ts`；Web `hierarchy.test.ts` |
| 库存列表、筛选、排序 | `InventoryPage.tsx` | App 的 `locationScopedItems`、`filtered`、`stockStatusFor`、`expiryStatusFor`、分页 Effect | `/items`、`/stock`；`queries.ts:listItems`，stock 路由 SQL 在 `app.ts` | API `queries.test.ts`、`stock.test.ts`；Web `hierarchy.test.ts` |
| 新增、编辑物资 | `ItemForm.tsx`；编辑弹窗仍在 App 的 `detailItem` 分支 | `App.addItem`、`updateItem`、`openItemForm` | POST `/items`、PATCH `/items/:itemId`；`app.ts`、共享 contracts 校验、`stock.ts` 初始库存写入 | API `stock.test.ts`、`mcp-workflow.test.ts`；Web `pageBehavior.test.ts` |
| 入库、领用、开封、用尽 | `StockDialog.tsx`；App 的用尽弹窗 | `App.openStockAction`、`recordStock`、`exhaustOpened`、`stockOperationKey` | `/stock/:type`、`/opened-consumables`、`/opened-consumables/:openedId/exhaust`；`stock.ts:recordStock/exhaustOpenedConsumable` | API `stock.test.ts`、`pricing.test.ts` |
| 批次、盘点、调拨 | `Batches.tsx`：`Batches`、`BatchSelect`；`BatchFields.tsx` | Batches 内加载/保存；App 的 `batchItem` 控制入口 | `/batches`、PATCH `/batches/:batchId`、`/stock/reconcile`、`/stock/transfers`；`app.ts`、`queries.ts`、`stock.ts` | API `stock.test.ts`、`pricing.test.ts` |
| 物资详情、流水、价格历史 | `ItemDetail.tsx`、`AppElements.tsx:TransactionRow`、`TransactionPagination.tsx` | ItemDetail 自行请求；App 的 `openItemDetail`、`closeItemDetail`、`transactionSnapshot` | `/transactions`、`/items/:itemId/price-history`、`/batches`；`queries.ts:listTransactions`、`pricing.ts:itemPriceHistory` | API `stock.test.ts`、`pricing.test.ts`；Web `appBehavior.test.ts`、`pageBehavior.test.ts` |
| 地点、分类树及删除 | `HierarchyManager.tsx`；树渲染和编辑/删除弹窗仍在 App | `App.addHierarchyNode`、`updateTreeNode`、`renderTreeNode`、`moveTreeItem`、`deleteSelected`；`hierarchy.ts` | `/locations`、`/categories`、对应资源 DELETE；`app.ts`、`inventory-delete.ts:deleteInventoryEntity` | API `inventory-delete.test.ts`、`queries.test.ts`；Web `hierarchy.test.ts`、`pageBehavior.test.ts` |
| 采购计划、渠道、日历 | `ShoppingPage.tsx`、`ShoppingForm.tsx`、`EditShoppingDialog.tsx`、`ConsumptionFields.tsx` | `App.addShoppingItem`、`updateShoppingItem`、`addShoppingChannel`、`moveShoppingMonth`；日历读取 Effect | `/shopping-list`、`/shopping-channels`、`/shopping-calendar`；`shopping.ts:saveShopping`，列表/日历 SQL 在 `app.ts` | API `stock.test.ts`、`mcp-workflow.test.ts`；Web `purchaseSchedule.test.ts` |
| 采购入库 | `ReceiveShoppingDialog.tsx` | `App.openShoppingReceipt`、`receiveShopping`、`receiveOperationKey` | POST `/shopping-list/:shoppingId/receive` → `shopping.ts:receiveShopping` → `stock.ts:recordStock` | API `stock.test.ts`、`pricing.test.ts`、`mcp-workflow.test.ts` |
| 预算、支出、价格、成本 | `FinancePage.tsx`、`FinanceReports.tsx`、`BudgetCategories.tsx`、`MissingCosts.tsx` | `App.saveFinanceBudget`、财务读取/布局 Effect；报表和缺失成本组件有自己的请求 | `/financial-dashboard`、`/financial-budget`、`/financial-trend`、`/purchase-records`、`/inventory-cost-analysis`、`/missing-costs`；`pricing.ts`，补价通过批次 PATCH | API `pricing.test.ts`；Web `budgetTree.test.ts`、`inventoryCohorts.test.ts`、`spendingTrend.test.ts` |
| 条码查询和扫描 | `BarcodeScanner.tsx`、`ItemForm.tsx` | `App.lookupItemBarcode`、预填值与 `itemFormRevision` | `/barcodes/:barcode`；`barcodes.ts:lookupBarcode` | API `barcodes.test.ts` |
| MCP 工具 | 无专用业务页面；令牌管理见 Profile | MCP 不经过 Web App | `/mcp` → `mcp.ts:handleMcpRequest/createMcpServer` → 注入 REST 请求，复用 API 业务 | API `mcp-workflow.test.ts`、`auth.test.ts` |
| 多语言、导航、公共显示 | `navigation.ts`、`displayDates.ts`、`formatMoney.ts`、`systemLabels.ts` | App 的导航函数、popstate Effect；`i18n/index.ts` 和 locales | API `i18n/index.ts`：语言协商、错误码/文案 | 两端 `i18n/*.test.ts`；Web `appBehavior.test.ts`、`systemLabels.test.ts` |

## 示例：修改采购入库

1. 在 [ReceiveShoppingDialog](../apps/web/src/ReceiveShoppingDialog.tsx) 找字段和 `onSubmit`，在 [App](../apps/web/src/App.tsx) 找同名 `receiveShopping` 回调。
2. 查看 `openShoppingReceipt` 如何生成操作键，以及提交时空字段如何转成 `null` 或 `undefined`。
3. 在 [API app](../apps/api/src/app.ts) 搜索 `shopping-list/:shoppingId/receive`，进入 [shopping.ts](../apps/api/src/shopping.ts) 的 `receiveShopping`。
4. 跟进 [stock.ts](../apps/api/src/stock.ts) 的 `recordStock`、`withStockOperation` 和事务逻辑；成本相关再看 [pricing.ts](../apps/api/src/pricing.ts)。
5. 阅读 [stock.test.ts](../apps/api/src/stock.test.ts) 的采购入库重试用例和 [pricing.test.ts](../apps/api/src/pricing.test.ts) 的渠道/实付金额用例，修改后验证库存、批次、采购完成状态和支出。

从仓库根目录快速定位：

```sh
rg -n 'openShoppingReceipt|receiveShopping|receiveOperationKey' apps/web/src/App.tsx
rg -n 'shopping-list/:shoppingId/receive|receiveShopping|withStockOperation' apps/api/src
```

## 状态与刷新容易遗漏的边界

- `App.load` 批量读取库存、地点、流水、采购、分类、渠道和当月财务；业务回调有的等待它，有的不等待。不要在纯重构中统一 await 方式。
- 日历和财务页另有读取 Effect；财务预算连线依赖 `useLayoutEffect` 和 DOM refs。页面拆分后这些协调逻辑仍在 App。
- 页面切换会关闭多个弹窗；详情页返回依赖 history state。改变组件 key 或状态持有位置可能改变表单重置行为。
- 库存操作的幂等键、FEFO 分配和“长期消耗品先开封、用尽再扣库存”由 stock 业务实现保护，不要在视图层另写规则。
- 家庭数据隔离、REST Session/Token 优先级及 MCP 的 Token 要求由 API preHandler 与 auth 共同决定。

## 相似代码不一定语义相同

- `displayDates.ts` 与 ItemDetail 的开封到期日显示算法不同；`formatMoney` 固定至少两位小数，部分详情金额格式使用币种默认精度。
- 库存 offset 分页不会像财务采购 page 分页那样钳制越界页；流水还具有 `snapshotAt`。
- 创建和更新请求的 `null`、省略字段含义不同；`apiJson` 只序列化，不做补默认值。
- `webTypes.ts` 是 Web 所需的视图类型；contracts 的 Zod schema 是部分输入/领域契约，不要仅为消除类型重复扩大接口要求。

## 验证入口

| 改动范围 | 先运行 | 补充验证 |
| --- | --- | --- |
| Web 工具、请求、展示 | `pnpm --filter @al1s-wms/web test` | 页面交互用临时库检查；静态渲染测试不替代真实提交与刷新 |
| 库存、采购、财务、认证 | `pnpm --filter @al1s-wms/api test` | 关注家庭隔离、事务、重试幂等、金额及日期边界 |
| 交付前集成检查 | `pnpm typecheck`、`pnpm test`、`pnpm build` | 构建大小提示不代表行为验证失败，也不应忽略体积变化 |

开发命令和部署方式见 [README](../README.md) / [中文 README](../README.zh-CN.md)。测试覆盖范围以用例为准；本文不表示每个表单分支都有自动化保护。

采购项的 `consumptionType`、`openedShelfLifeDays` 保存在 shopping_list；未关联物资时入库用这两个字段创建物资，关联物资时沿用已有物资设置。旧库由 openDatabase 补列，默认消耗品。回归见 `apps/api/src/shopping.test.ts`。
