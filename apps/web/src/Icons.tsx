import { useState } from "react";
import { House, Building2, Trees, Warehouse, Castle, Leaf, Star, Package, Apple, Carrot, Beef, Fish, Egg, Milk, Coffee, Wine, CookingPot, Sandwich, Cookie, SprayCan, WashingMachine, Shirt, Pill, HeartPulse, Wrench, Cable, Battery, BookOpen, PawPrint, Bath, Wheat, Bean, Nut, Candy, IceCreamBowl, GlassWater, Utensils, Refrigerator, Microwave, Lightbulb, Smartphone, Laptop, Scissors, Boxes, Baby, Flower2, Umbrella, Glasses, type LucideIcon } from "lucide-react";

const icons: Record<string, [string, LucideIcon]> = {
  house: ["住宅", House], building: ["公寓", Building2], trees: ["庭院", Trees], warehouse: ["仓库", Warehouse], castle: ["城堡", Castle], leaf: ["绿植", Leaf], star: ["星星", Star],
  package: ["通用物资", Package], apple: ["水果", Apple], carrot: ["蔬菜", Carrot], beef: ["肉类", Beef], fish: ["水产", Fish], egg: ["蛋类", Egg], milk: ["乳品", Milk], coffee: ["饮品", Coffee], wine: ["酒类", Wine], cooking: ["食材", CookingPot], sandwich: ["即食食品", Sandwich], cookie: ["零食", Cookie], spray: ["清洁用品", SprayCan], laundry: ["洗衣用品", WashingMachine], shirt: ["衣物", Shirt], pill: ["药品", Pill], health: ["健康用品", HeartPulse], wrench: ["工具", Wrench], cable: ["电器配件", Cable], battery: ["电池", Battery], book: ["书籍文具", BookOpen], pet: ["宠物用品", PawPrint], bath: ["洗浴用品", Bath],
  wheat: ["米面主食", Wheat], bean: ["豆类调味", Bean], nut: ["坚果", Nut], candy: ["糖果", Candy], icecream: ["冷冻甜品", IceCreamBowl], water: ["饮用水", GlassWater],
  utensils: ["餐具厨具", Utensils], refrigerator: ["冰箱冷柜", Refrigerator], microwave: ["厨房电器", Microwave], lightbulb: ["灯具照明", Lightbulb],
  smartphone: ["手机数码", Smartphone], laptop: ["电脑设备", Laptop], scissors: ["剪裁用品", Scissors], storage: ["收纳用品", Boxes],
  baby: ["母婴用品", Baby], flower: ["园艺花卉", Flower2], umbrella: ["雨具", Umbrella], glasses: ["眼镜", Glasses],
};
export const homeIconIds = ["house", "building", "trees", "warehouse", "castle", "leaf", "star"];
export const itemIconIds = ["package", "apple", "carrot", "wheat", "bean", "beef", "fish", "egg", "milk", "water", "coffee", "wine", "cooking", "sandwich", "cookie", "candy", "nut", "icecream", "spray", "laundry", "bath", "shirt", "pill", "health", "baby", "utensils", "refrigerator", "microwave", "lightbulb", "wrench", "scissors", "cable", "battery", "smartphone", "laptop", "book", "storage", "pet", "flower", "umbrella", "glasses", "leaf"];
const legacy: Record<string, string> = { "🏠": "house", "🏡": "trees", "🏢": "building", "🏘️": "house", "🌿": "leaf", "⭐": "star" };
export const normalizeHomeIcon = (value?: string) => legacy[value || ""] || (homeIconIds.includes(value || "") ? value! : "house");
export function MaterialIcon({ value, home = false, size = 19 }: { value?: string | null; home?: boolean; size?: number }) {
  const Icon = icons[home ? normalizeHomeIcon(value || undefined) : value || "package"]?.[1] || Package;
  return <Icon size={size} strokeWidth={1.65} aria-hidden="true" />;
}
export function itemIconFor(item: { icon?: string | null; name: string; category?: string | null }) {
  if (item.icon && icons[item.icon]) return item.icon;
  const text = `${item.name} ${item.category || ""}`;
  for (const [pattern, id] of [[/鸡蛋|鸭蛋|蛋类/, "egg"], [/牛奶|酸奶|乳品/, "milk"], [/矿泉水|纯净水|饮用水|瓶装水/, "water"], [/米|面粉|大米|主食|杂粮|燕麦/, "wheat"], [/豆|酱油|醋|调味/, "bean"], [/坚果|花生|瓜子/, "nut"], [/糖果|巧克力/, "candy"], [/冰淇淋|雪糕|冷冻甜品/, "icecream"], [/洗衣/, "laundry"], [/肉|香肠|熏肠/, "beef"], [/鱼|虾|水产/, "fish"], [/水果|苹果|香蕉/, "apple"], [/蔬菜/, "carrot"], [/酒/, "wine"], [/饮|茶|咖啡|水|可乐/, "coffee"], [/零食|饼干/, "cookie"], [/即食|面包|泡面/, "sandwich"], [/清洁/, "spray"], [/洗浴|沐浴|洗发/, "bath"], [/药/, "pill"], [/健康/, "health"], [/婴儿|宝宝|母婴|尿布|纸尿裤/, "baby"], [/餐具|厨具|筷|碗|锅/, "utensils"], [/冰箱|冷柜/, "refrigerator"], [/微波炉|烤箱|空气炸锅|厨房电器/, "microwave"], [/灯|灯泡|照明/, "lightbulb"], [/手机|充电宝/, "smartphone"], [/电脑|笔记本|键盘|鼠标/, "laptop"], [/剪刀|针线|裁缝/, "scissors"], [/收纳|储物|整理箱/, "storage"], [/雨伞|雨衣|雨具/, "umbrella"], [/眼镜|隐形眼镜/, "glasses"], [/园艺|花卉|种子|肥料/, "flower"], [/衣物/, "shirt"], [/工具/, "wrench"], [/电池/, "battery"], [/电器/, "cable"], [/文具|书/, "book"], [/宠物/, "pet"], [/食品|生鲜/, "cooking"]] as [RegExp, string][]) if (pattern.test(text)) return id;
  return "package";
}
export function IconPicker({ name = "icon", initial, home = false, onChange }: { name?: string; initial?: string | null; home?: boolean; onChange?: (id: string) => void }) {
  const [selected, setSelected] = useState(home ? normalizeHomeIcon(initial || undefined) : initial || "");
  const ids = home ? homeIconIds : ["", ...itemIconIds];
  const grid = <div className="icon-picker-grid">{ids.map(id => <label key={id} title={id ? icons[id][0] : "自动匹配"} className={selected === id ? "selected" : ""}>
    <input type="radio" name={name} value={id} checked={selected === id} onChange={() => { setSelected(id); onChange?.(id); }} />
    <MaterialIcon value={id} /><span>{id ? icons[id][0] : "自动"}</span>
  </label>)}</div>;
  return <fieldset className="icon-picker"><legend>{home ? "家庭图标" : "物资图标"}</legend>{home ? grid : <details><summary><MaterialIcon value={selected} /><span>{selected ? icons[selected]?.[0] : "自动匹配"}</span><span className="icon-picker-change">更换图标</span></summary>{grid}</details>}</fieldset>;
}
