import type { MindNode } from "../types.ts";
import { useT } from "../i18n.ts";
import { MenuLabel } from "./AppMenu.tsx";

type TextStyle = NonNullable<MindNode["textStyle"]>;
interface Props {
  x: number;
  y: number;
  node: MindNode;
  isRoot: boolean;
  multiple?: boolean;
  onStyle: (style: Partial<TextStyle>) => void;
  onRelation?: () => void;
  onSummary?: () => void;
  canAddSummary?: boolean;
  onRemove: () => void;
}
export default function NodeContextMenu({
  x,
  y,
  node,
  isRoot,
  multiple,
  onStyle,
  onRelation,
  onSummary,
  canAddSummary,
  onRemove,
}: Props) {
  const t = useT();
  const style = node.textStyle;
  const sizes = [
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 28, 32, 36, 40,
  ];
  if (style?.size && !sizes.includes(style.size)) sizes.push(style.size);
  sizes.sort((a, b) => a - b);
  return (
    <div
      className="context"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {!multiple && (
        <>
          <div className="context-section">
            <div className="context-heading">{t("Text color")}</div>
            <div className="colors">
              {[
                ["Default", ""],
                ["Red", "#c45850"],
                ["Yellow", "#c59632"],
                ["Blue", "#4782bc"],
                ["Green", "#648d5b"],
              ].map(([name, color]) => (
                <button
                  type="button"
                  aria-label={t(name)}
                  aria-pressed={(style?.color || "") === color}
                  title={t(name)}
                  key={name}
                  style={{ background: color || "#ddd" }}
                  onClick={() => onStyle({ color })}
                />
              ))}
            </div>
          </div>
          <div className="context-section">
            <div className="context-heading">{t("Style")}</div>
            <div className="format-buttons">
              {(
                [
                  ["Bold", "bold", "B"],
                  ["Italic", "italic", "I"],
                  ["Underline", "underline", "U"],
                ] as const
              ).map(([name, key, symbol]) => (
                <button
                  type="button"
                  title={t(name)}
                  aria-label={t(name)}
                  aria-pressed={!!style?.[key]}
                  key={key}
                  onClick={() => onStyle({ [key]: !style?.[key] })}
                >
                  {symbol}
                </button>
              ))}
            </div>
          </div>
          <label className="context-size">
            {t("Font size")}{" "}
            <select
              value={style?.size || ""}
              onChange={(e) =>
                onStyle({
                  size: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            >
              <option value="">{t("Default")}</option>
              {sizes.map((n) => (
                <option key={n} value={n}>
                  {n} px
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <div className="context-actions">
        {onRelation && !multiple && (
          <button type="button" onClick={onRelation}>
            ⌁　{t("Create connection")}
          </button>
        )}
        {onSummary && (
          <button type="button" disabled={!canAddSummary} onClick={onSummary}>
            <MenuLabel label="Add summary" />
          </button>
        )}
        <button type="button" disabled={isRoot} onClick={onRemove}>
          <MenuLabel label="Delete" />
        </button>
      </div>
    </div>
  );
}
