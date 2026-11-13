import React from "react";
import type { MapContent, MindNode } from "../types.ts";
import { useT } from "../i18n.ts";
import { textStyleCss } from "../textStyle.ts";
import { summaryTopicNames } from "../summaries.ts";

const colors = [
  "#0e7c7b",
  "#4a5899",
  "#b26a2b",
  "#96496b",
  "#557a46",
  "#7d5ba6",
];

function Content({ node }: { node: MindNode }) {
  const t = useT();
  const image = node.image?.src;
  return (
    <>
      {image && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(image) && (
        <img src={image} alt={node.text || t("Topic image")} />
      )}
      <span>{node.text || (!image ? t("Untitled topic") : "")}</span>
    </>
  );
}
function Leaves({ nodes, depth = 3 }: { nodes: MindNode[]; depth?: number }) {
  if (!nodes.length) return null;
  if (depth >= 5) {
    const items: { node: MindNode; depth: number }[] = [];
    function visit(node: MindNode, level: number) {
      items.push({ node, depth: level });
      node.children.forEach((child) => visit(child, level + 1));
    }
    nodes.forEach((node) => visit(node, depth));
    return (
      <ul className="print-list print-deep-list">
        {items.map(({ node, depth: level }) => (
          <li key={node.key}>
            <span className="print-level">L{level}</span>
            <Content node={node} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="print-list">
      {nodes.map((node) => (
        <li key={node.key}>
          <Content node={node} />
          <Leaves nodes={node.children} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}
export default function PrintDocument({
  tree,
  floatingTopics = [],
  floatingNotes = [],
  date,
}: MapContent & { date: string }) {
  const t = useT();
  const names = summaryTopicNames(tree, floatingTopics);
  function count(node: MindNode): number {
    return 1 + node.children.reduce((sum, child) => sum + count(child), 0);
  }
  function hasDeep(node: MindNode, depth: number): boolean {
    return (
      depth >= 5 || node.children.some((child) => hasDeep(child, depth + 1))
    );
  }
  return (
    <article className="print-document">
      <header className="print-head">
        <h1>
          <Content node={tree} />
        </h1>
        <div className="print-meta">
          <span>
            {t("Exported")} {date}
          </span>
          <span>
            {count(tree) +
              floatingTopics.reduce(
                (sum, topic) => sum + count(topic.tree),
                0,
              )}{" "}
            {t("nodes")} · {tree.children.length} {t("main branches")}
          </span>
        </div>
      </header>
      {tree.children.map((section, index) => (
        <section
          className="print-section"
          key={section.key}
          style={
            {
              "--print-accent": colors[index % colors.length],
            } as React.CSSProperties
          }
        >
          <h2>
            <Content node={section} />
          </h2>
          {!!section.children.length && (
            <div
              className={
                "print-grid" +
                (hasDeep(section, 1) ? " print-single-column" : "")
              }
            >
              {section.children.map((child) => (
                <div className="print-subsection" key={child.key}>
                  <h3>
                    <Content node={child} />
                  </h3>
                  <Leaves nodes={child.children} />
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
      {!!floatingTopics.length && (
        <section
          className="print-section"
          style={{ "--print-accent": colors[0] } as React.CSSProperties}
        >
          <h2>{t("Independent topics")}</h2>
          {floatingTopics.map((topic) => (
            <div className="print-subsection" key={topic.tree.key}>
              <h3>
                <Content node={topic.tree} />
              </h3>
              <Leaves nodes={topic.tree.children} depth={1} />
            </div>
          ))}
        </section>
      )}
      {!!floatingNotes.length && (
        <section
          className="print-section"
          style={{ "--print-accent": colors[1] } as React.CSSProperties}
        >
          <h2>{t("Floating notes")}</h2>
          <ul className="print-list">
            {floatingNotes.map((note) => (
              <li key={note.key} style={textStyleCss(note.textStyle)}>
                {note.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!tree.summaries?.length && (
        <section className="print-section">
          <h2>{t("Summaries")}</h2>
          <ul className="print-list">
            {tree.summaries.map((summary) => (
              <li key={summary.key}>
                {names.get(summary.key) || t("Untitled topic")}:{" "}
                {summary.topics
                  .map((key) => names.get(key) || t("Untitled topic"))
                  .join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="print-foot">
        {tree.text} · {date}
      </footer>
    </article>
  );
}
