import type { FormEvent } from "react";
import i18n from "./i18n/index.js";
import { categoryLabel } from "./systemLabels.js";

const t = i18n.t.bind(i18n);
const labels = {
  location: {
    title: "地点管理",
    hint: "新增一级地点或子地点",
    name: "地点名称",
    root: "一级地点",
    add: "添加地点",
  },
  category: {
    title: "分类管理",
    hint: "新增一级分类或子分类",
    name: "分类名称",
    root: "一级分类",
    add: "添加分类",
  },
} as const;

type Props = {
  kind: keyof typeof labels;
  name: string;
  parent: string;
  options: { id: string; name: string; depth: number }[];
  onNameChange: (value: string) => void;
  onParentChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};
export function HierarchyManager({
  kind,
  name,
  parent,
  options,
  onNameChange,
  onParentChange,
  onSubmit,
}: Props) {
  const text = labels[kind];
  return (
    <section className="panel category-manager">
      <div className="panel-head">
        <div>
          <h2>{t(text.title)}</h2>
          <p className="muted">{t(text.hint)}</p>
        </div>
      </div>
      <form className="category-form" onSubmit={onSubmit}>
        <input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t(text.name)}
          required
        />
        <select
          value={parent}
          onChange={(event) => onParentChange(event.target.value)}
        >
          <option value="">{t(text.root)}</option>
          {options.map((node) => (
            <option key={node.id} value={node.id}>
              {"　".repeat(node.depth)}
              {kind === "category" ? categoryLabel(node.name) : node.name}
            </option>
          ))}
        </select>
        <button className="primary">{t(text.add)}</button>
      </form>
    </section>
  );
}
