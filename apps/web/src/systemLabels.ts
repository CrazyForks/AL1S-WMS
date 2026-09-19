import i18n from "./i18n/index.js";

const systemCategories = new Set([
  "食品",
  "饮品",
  "日用品",
  "药品与健康",
  "衣物",
  "工具",
  "电器",
  "文具",
  "宠物用品",
  "其他",
]);
const systemChannels = new Set([
  "京东",
  "淘宝",
  "美团外卖",
  "淘宝闪购",
  "大润发",
  "盒马鲜生",
  "新世纪百货",
  "沃尔玛",
  "永辉超市",
]);

export function categoryLabel(name: string) {
  return systemCategories.has(name) ? i18n.t(name) : name;
}

export function channelLabel(name: string) {
  return systemChannels.has(name) ? i18n.t(name) : name;
}
