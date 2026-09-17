# AL1S ERP

面向家庭场景的库存与采购管理系统。支持树状地点与分类、批次库存、到期提醒、采购入库、实盘校准，以及供 AI Agent 使用的 MCP 接口。

![Alice](apps/web/public/alice.gif)

## Quick start

```bash
gh repo clone RicterZ/AL1S-ERP
cd AL1S-ERP
docker build -t al1s-erp .
docker run -d \
  --name al1s-erp \
  --restart unless-stopped \
  -p 8080:8080 \
  -v al1s-erp-data:/data \
  al1s-erp
```

打开 `http://服务器地址:8080`，首次访问时按引导创建管理员和家庭。

> 数据库保存在 `/data/family-erp.db`。生产部署必须挂载 `/data`，否则删除容器时会丢失数据。

## Feature

- 家庭物资：维护名称、图标、分类、基础单位、最低库存和默认存放地点。
- 树状管理：地点和分类支持多级父子结构，筛选父节点时自动包含所有后代。
- 批次库存：每次入库创建独立批次，可记录生产日期、到期日期和批次备注。
- 库存流转：支持入库、按批次领用、FEFO 自动领用和跨地点调拨。
- 到期管理：区分过期、临期、缺货、不足、临界和正常状态。
- 采购管理：支持自动补货建议、手动采购项、采购入库及独立采购转物资。
- 物资盘点：提交实盘数量后自动记录盘盈或盘亏，保留完整流水。
- 操作流水：按物资、地点、批次、类型和时间查询，支持稳定分页。
- Agent 接入：通过 MCP 查询家庭状态并执行入库、盘点、采购和基础资料管理。
- 本地优先：数据存储在单个 SQLite 数据库中，不依赖外部数据库服务。

## Deployment

### 使用命名卷

推荐使用 Docker 命名卷，Docker 会管理实际存储位置：

```bash
docker run -d \
  --name al1s-erp \
  --restart unless-stopped \
  -p 8080:8080 \
  -v al1s-erp-data:/data \
  al1s-erp
```

### 使用宿主机目录

需要直接访问数据库文件时，可以绑定宿主机目录：

```bash
mkdir -p /root/docker-services/data/al1s-erp

docker run -d \
  --name al1s-erp \
  --restart unless-stopped \
  -p 8080:8080 \
  -v /root/docker-services/data/al1s-erp:/data \
  al1s-erp
```

容器默认以 root 运行，以便在不同 NAS、服务器和 bind mount 权限配置下创建 SQLite 数据库。不要向公网直接暴露管理端口，建议放在可信内网、VPN 或带 TLS 的反向代理后。

### 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | HTTP 服务端口 |
| `BIND_ADDRESS` | `0.0.0.0` | 服务监听地址 |
| `DATABASE_URL` | `/data/family-erp.db` | SQLite 数据库路径 |
| `STATIC_ROOT` | `/app/public` | Web 静态文件目录 |
| `NODE_ENV` | `production` | Node.js 运行环境 |

构建时默认使用 npmmirror。需要切换 npm registry 时：

```bash
docker build \
  --build-arg NPM_REGISTRY=https://registry.npmjs.org \
  -t al1s-erp .
```

### 健康检查

镜像内置 Docker `HEALTHCHECK`，也可以手动检查：

```bash
curl --fail http://127.0.0.1:8080/healthz
docker inspect al1s-erp --format '{{.State.Health.Status}}'
```

正常响应：

```json
{"status":"ok"}
```

### 更新

```bash
git pull
docker build -t al1s-erp .
docker stop al1s-erp
docker rm al1s-erp
docker run -d \
  --name al1s-erp \
  --restart unless-stopped \
  -p 8080:8080 \
  -v al1s-erp-data:/data \
  al1s-erp
```

应用启动时会自动执行兼容性数据库迁移。更新时必须继续挂载原来的卷或目录。

### 备份与恢复

先停止容器，确保 SQLite WAL 已完整关闭，再复制数据库：

```bash
docker stop al1s-erp
docker cp al1s-erp:/data/family-erp.db ./family-erp-$(date +%F).db
docker start al1s-erp
```

恢复时：

```bash
docker stop al1s-erp
docker run --rm -v al1s-erp-data:/data alpine \
  rm -f /data/family-erp.db-wal /data/family-erp.db-shm
docker cp ./family-erp-backup.db al1s-erp:/data/family-erp.db
docker start al1s-erp
```

恢复前建议另存当前数据库；不要在容器运行时直接覆盖数据库文件。

## MCP

MCP 地址为：

```text
https://你的域名/mcp
```

认证使用 Bearer Token。登录 Web 后进入“我的设置 → MCP 访问令牌”创建：

- 家庭级 Token：默认选项，只能管理一个家庭；Agent 调用工具时不需要传 `homeId`。
- 跨家庭 Token：高级选项，可以列出和选择所有家庭；调用家庭相关工具时必须传 `homeId`。

Token 只在创建时完整显示一次，请保存到 MCP 客户端的安全配置中。不要写入代码仓库或聊天记录。

### 客户端配置

支持远程 HTTP MCP 的客户端可使用：

```json
{
  "mcpServers": {
    "al1s-erp": {
      "url": "https://erp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer al1s_REPLACE_WITH_YOUR_TOKEN"
      }
    }
  }
}
```

如果服务只部署在内网，将 `url` 替换为内网地址，例如 `http://192.168.1.10:8080/mcp`。

### 推荐 Agent 流程

Agent 应先调用 `get_home_context`，确认 Token 范围，再调用 `get_home_overview` 获取需要补充、临期、过期和待采购事项。`get_agent_guide` 会返回服务端维护的标准工作流。

一次普通入库：

1. `search_items` 确认物资和基础单位。
2. `list_locations` 确认入库地点。
3. `record_receipt` 提交数量、地点、生产日期和到期日期。
4. 使用返回的 `beforeQuantity`、`afterQuantity` 和批次信息向用户确认结果。

一次采购入库：

1. `list_shopping_items` 找到采购项。
2. `receive_shopping_item` 提交实际数量、地点和批次日期。
3. 系统将采购项标记完成，并创建一个新的库存批次。

一次物资盘点：

1. `search_items` 和 `list_locations` 确认盘点对象。
2. `reconcile_stock` 提交该地点的 `countedQuantity`。
3. 盘盈会创建新批次；盘亏默认按最早到期批次优先扣减，也可指定 `batchId`。

处理过期批次：

1. 从 `get_home_overview` 获取过期批次及剩余数量。
2. 与用户确认实际处理方式。
3. 调用 `record_issue`，传入对应 `batchId`、数量和明确原因。

### MCP 工具分组

| 范围 | 主要工具 |
| --- | --- |
| 家庭与指引 | `get_home_context`、`get_home_overview`、`get_agent_guide`、`list_homes` |
| 物资与库存 | `search_items`、`get_item`、`get_stock`、`create_item`、`update_item` |
| 批次与盘点 | `list_batches`、`update_batch`、`record_receipt`、`record_issue`、`transfer_stock`、`reconcile_stock` |
| 采购 | `list_shopping_items`、`create_shopping_item`、`update_shopping_item`、`delete_shopping_item`、`receive_shopping_item` |
| 地点与分类 | `list_locations`、`create_location`、`update_location`、`list_categories`、`create_category`、`update_category` |
| 历史与删除 | `list_transactions`、`delete_item`、`delete_location`、`delete_category` |

所有库存写操作都需要 `idempotencyKey`。只有在重试完全相同的请求时才能复用原值；新的业务操作必须使用新值。数量始终使用物资的基础单位，目前不进行单位换算。

## Local development

需要 Node.js 24 和 pnpm 10：

```bash
pnpm install
```

分别启动 API 和 Web 开发服务器：

```bash
pnpm --filter @family-erp/api dev
```

```bash
pnpm --filter @family-erp/web dev
```

- Web：`http://localhost:5173`
- API：`http://localhost:8080`
- 本地数据库：`apps/api/data/family-erp.db`

常用检查：

```bash
pnpm typecheck
pnpm build
pnpm --filter @family-erp/api exec tsx --test \
  src/inventory-delete.test.ts \
  src/stock.test.ts \
  src/mcp-workflow.test.ts
```

## Architecture

```text
apps/web             React + Vite Web 界面
apps/api             Fastify REST API 与 MCP 服务
packages/contracts   前后端共享 Zod 契约
packages/db          SQLite 初始化与迁移
```

Web 和 MCP 复用同一组 REST 业务逻辑，因此批次校验、幂等、采购入库和权限规则保持一致。

## Troubleshooting

### `unable to open database file`

确认 `/data` 已挂载为可写目录，且宿主机文件系统没有以只读方式挂载：

```bash
docker inspect al1s-erp --format '{{json .Mounts}}'
docker exec al1s-erp sh -lc 'ls -ld /data && touch /data/.write-test && rm /data/.write-test'
```

### MCP 返回 `401`

确认请求使用 `Authorization: Bearer <Token>`，Token 未被撤销，并且 URL 指向 `/mcp`。

### MCP 返回 `HOME_SCOPE_FORBIDDEN`

当前 Token 已绑定单一家庭。使用该家庭的 Token，或重新创建“全部家庭（高级）”Token。

### 库存写入发生幂等冲突

同一个 `idempotencyKey` 已用于不同参数。为新的入库、领用、调拨或盘点操作生成新键。
