# Home Assistant 仪表盘

接入家庭后，默认只有 **物资种类、待补货物资、临期批次、过期批次、待采购项、使用中物资**六个汇总传感器。没有选择关注物资时，不会为每件物资创建实体。

在 **设置 → 设备与服务 → AL1S WMS → 配置**中搜索并选择关注物资。每件关注物资只增加一个数量传感器，新增物资不会自动加入。取消关注会停用对应实体；再次关注会恢复，保留实体 ID。用户自己停用的实体仍需手动启用。

从旧版升级后，自动创建的物资实体会停用。若自动化引用了它们，在配置中选回这些物资即可恢复。

## 使用原生卡片

无需安装额外的 Card。通过仪表盘编辑器添加 **实体**或 **磁贴**卡片，选择家庭汇总及少量关注物资即可。数量变化可以用**历史图表**展示。

要展示具体物资清单，添加原生 **Markdown** 卡片。以下示例中的实体 ID 需换成你在 **开发者工具 → 状态**中看到的对应实体 ID；实体 ID 由 HA 分配，不保证与示例相同。

### 临期清单

```yaml
type: markdown
title: 优先使用
content: |-
  {% set entity = 'sensor.home_expiring_batches' %}
  {% if states(entity) in ['unknown', 'unavailable'] %}
  库存数据暂不可用。
  {% else %}
  {% for item in state_attr(entity, 'items') or [] %}
  - [{{ item.name }}]({{ item.url }}) · {{ item.quantity }} {{ item.unit }} · {{ item.location or '未指定地点' }} · 剩 {{ item.days_remaining }} 天
  {% else %}
  未来 30 天没有临期库存。
  {% endfor %}
  {% endif %}
```

### 使用中清单

```yaml
type: markdown
title: 使用中
content: |-
  {% set entity = 'sensor.home_items_in_use' %}
  {% if states(entity) in ['unknown', 'unavailable'] %}
  库存数据暂不可用。
  {% else %}
  {% for item in state_attr(entity, 'items') or [] %}
  - [{{ item.name }}]({{ item.url }}) · {{ item.quantity }} {{ item.unit }} · {{ item.location or '未指定地点' }} · {{ item.opened_at[:10] }} 开封{% if item.days_remaining is not none %} · {% if item.days_remaining < 0 %}已过期 {{ -item.days_remaining }} 天{% else %}剩 {{ item.days_remaining }} 天{% endif %}{% endif %}
  {% else %}
  没有使用中的物资。
  {% endfor %}
  {% endif %}
```

### 待补货清单

```yaml
type: markdown
title: 待补货
content: |-
  {% set entity = 'sensor.home_low_stock_items' %}
  {% if states(entity) in ['unknown', 'unavailable'] %}
  库存数据暂不可用。
  {% else %}
  {% for item in state_attr(entity, 'items') or [] %}
  - [{{ item.name }}]({{ item.url }}) · 现有 {{ item.quantity }} {{ item.unit }} · 建议补 {{ item.suggested_quantity }} {{ item.unit }}
  {% else %}
  暂无需要补货的物资。
  {% endfor %}
  {% endif %}
```

将这些卡片放在**垂直堆叠**卡片中，上方放汇总磁贴，即可组成家庭库存面板。点击清单中的名称会打开 AL1S 物资详情；浏览器也需要能访问 AL1S 地址，并登录对应家庭。

## 数据含义

汇总传感器的状态是数量，具体清单在 `items` 属性中，约每分钟刷新。临期与过期统计剩余库存的批次地点记录：同一批次分布在两个地点时会有两条。临期范围为未来 30 天，包含当天到期的库存，与 AL1S 当前统计一致。

| 汇总实体 | `items` 中的额外字段 |
| --- | --- |
| 待补货物资 | `reorder_point`、`suggested_quantity` |
| 临期 / 过期批次 | `batch_id`、`expiry_date`、`days_remaining` |
| 使用中物资 | `opened_id`、`batch_id`、`opened_at`、`expiry_date`、`days_remaining` |
| 待采购项 | `shopping_id`、`source`、`planned_date` |

清单的公共字段为 `item_id`、`name`、`quantity`、`unit`、`url`；批次和开封记录还提供 `location_id`、`location`。待采购的 `source` 为 `manual` 或 `automatic`。未知日期、地点等为 `null`，不伪装成零或当天。

“使用中物资”的状态是**不同物资的种类数**，清单则逐条展示开封记录，因此两瓶已开封的洗发水可能有两条记录，但物资种类只算一项。开封到期日取原到期日和开封期限中较早的一天。

关注物资的状态是所有地点的库存总量，单位沿用 AL1S。属性包括：

| 属性 | 含义 |
| --- | --- |
| `locations` | 实际有库存的地点列表，每项包含 `location_id`、`name`、`quantity` |
| `needs_replenishment` | 是否低于补货阈值，布尔值 |
| `reorder_point` / `suggested_quantity` | 补货阈值 / 补到阈值所需数量 |
| `opened_quantity` / `unopened_quantity` | 已开封 / 未开封数量，使用物资单位 |
| `next_expiry_date` | 仍有库存的批次中最早的原始到期日 |
| `next_opened_expiry_date` | 使用中记录最早的有效到期日 |
| `opened` | 该物资的开封记录清单 |
| `url` | AL1S 物资详情地址 |

已开封数量包含在库存总量中；这里的“数量”是瓶、盒等已开封库存单位数量，**不是瓶内剩余百分比**。只有记录耗尽才会扣减总量。连接失败时实体显示不可用，卡片不会将旧清单当作当前数据。

## 用于自动化

无需额外的待补货实体，可以用关注物资数量传感器的 `needs_replenishment` 属性触发自动化；通知内容也可以引用 `suggested_quantity`。开封提醒可读取使用中清单的 `days_remaining`，用定时自动化统一发送，避免为每瓶物资创建传感器。

当前集成只读，不会勾选采购完成、自动收货或扣减库存。
