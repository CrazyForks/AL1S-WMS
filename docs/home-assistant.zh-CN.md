# 在 Home Assistant 中使用 AL1S WMS

将家庭库存接入 Home Assistant，在仪表盘查看库存异常和已开封物资，也可以在自动化中使用库存状态。

## 安装并连接

1. 在 AL1S WMS 打开**设置 → MCP 访问令牌**，为要接入的家庭创建令牌。复制令牌和 AL1S 地址，例如 `http://192.168.1.20:8080`。
2. 在 Home Assistant 打开 **HACS → 集成 → ⋮ → 自定义存储库**，添加 `https://github.com/RicterZ/AL1S-WMS`，类型选择**集成**。下载 AL1S WMS，然后重启 Home Assistant。
3. 前往 **设置 → 设备与服务 → 添加集成**，搜索 **AL1S WMS**，填写 AL1S 地址和令牌，再选择要接入的家庭。

Home Assistant 必须能够访问 AL1S 地址。如果 Home Assistant 在容器中运行，请填写 AL1S 主机地址或容器间可访问的服务名，不要填写 `localhost`。

## 添加仪表盘卡片

1. 打开仪表盘，选择**编辑仪表盘 → 添加卡片**。
2. 搜索 **AL1S WMS**。
3. 根据需要添加 **库存提醒** 或 **使用中**，两张卡可以分别放置在仪表盘的不同位置。
4. 在卡片配置中选择要显示的家庭。

**库存提醒**列出缺货、库存不足、达到补货阈值、临期和过期物资。临期表示批次将在 30 天内到期。

**使用中**列出已开封记录，包括数量、地点、开封日期和到期日期。这里的数量是登记为已开封的数量，不代表包装内的剩余量。

点击物资名称可在 AL1S WMS 中打开对应详情。使用 Home Assistant 的浏览器也需要能够访问 AL1S。

## YAML 仪表盘

使用 YAML 模式的仪表盘时，请先在 `resources` 下添加卡片模块：

```yaml
resources:
  - url: /al1s_wms/al1s-inventory-card.js
    type: module
```

然后在视图中添加需要的卡片。库存提醒：

```yaml
type: custom:al1s-inventory-attention-card
```

使用中：

```yaml
type: custom:al1s-opened-items-card
```

卡片为只读；库存变更请在 AL1S WMS 中操作。
