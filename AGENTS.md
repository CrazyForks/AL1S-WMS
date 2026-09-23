# Agent 代码入口

本项目是 React + Fastify + SQLite 的家庭物资管理系统，使用 pnpm workspace。

## 按任务定位

先读 [功能与调用链导航](docs/code-map.md)，选择对应功能行，再读相关源码和测试。

- 页面、表单展示：`apps/web/src/*Page.tsx`、`*Form.tsx`、`*Dialog.tsx`。
- 前端状态、操作处理、刷新与导航协调：`apps/web/src/App.tsx`。页面拆分未迁移这些逻辑；修改行为时同时检查这里的回调和 Effect。
- HTTP 路由、请求校验与部分 CRUD：`apps/api/src/app.ts`；库存、采购、财务的业务实现分别在 `stock.ts`、`shopping.ts`、`pricing.ts`。
- 实际建表、升级兼容和索引：`packages/db/src/index.ts` 的 `openDatabase`。`schema.ts` 不是完整运行时 schema。
- 请求校验契约：`packages/contracts/src/index.ts`；Web 展示类型：`apps/web/src/webTypes.ts`。两者用途不同。

## 修改与验证

保持现有接口、家庭范围隔离、库存幂等语义及刷新时序；重构前为涉及的行为补测试。不要仅因名称相近就合并日期、金额或分页逻辑，差异见导航文档。

在仓库根目录运行：

```sh
pnpm typecheck
pnpm test
pnpm build
```

按模块验证可用 `pnpm --filter @al1s-wms/web test` 或 `pnpm --filter @al1s-wms/api test`。API 测试使用临时/内存数据库；浏览器验证也应显式指定临时 `DATABASE_URL`，避免向日常数据写入测试记录。

变更功能入口或模块归属时，同步更新导航中对应行。按已验证、可独立回退的阶段提交，避免把格式化和业务改动混在一起。
