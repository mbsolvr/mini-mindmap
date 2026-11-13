import type { FloatingNote, FloatingTopic, MindNode } from "./types.ts";
import { summaryTopicNames } from "./summaries.ts";

function escapeText(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#!+\-.|~])/g, "\\$1")
    .replace(/\r\n?|\n/g, "<br>");
}

function safeUrl(value: unknown) {
  return typeof value === "string" && /^https?:\/\/[^\s<>]+$/i.test(value)
    ? value
    : null;
}

function markdownUrl(url: string) {
  return `<${url}>`;
}

function nodeContent(node: MindNode) {
  const parts = [];
  if (node.image?.src) {
    const source = node.image.src;
    if (
      !/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(source) &&
      !safeUrl(source)
    ) {
      throw new Error("This image format cannot be exported to Markdown");
    }
    parts.push(
      `![${escapeText(node.image.caption || node.text || "Image")}](${markdownUrl(source)})`,
    );
  }
  if (node.text) {
    const url = safeUrl(node.text);
    let text = escapeText(node.text);
    if (url) text = `[${text}](${markdownUrl(url)})`;
    if (node.textStyle?.bold) text = `**${text}**`;
    if (node.textStyle?.italic) text = `*${text}*`;
    if (node.textStyle?.underline) text = `<u>${text}</u>`;
    parts.push(text);
  }
  const link = safeUrl(node.link?.url);
  if (link && link !== node.text)
    parts.push(
      `[${escapeText(node.link?.label || link)}](${markdownUrl(link)})`,
    );
  return parts.join(" ") || "Untitled topic";
}

export function toMarkdown(
  tree: MindNode,
  floatingTopics: FloatingTopic[] = [],
  floatingNotes: FloatingNote[] = [],
  t: (text: string) => string = (value) => value,
) {
  const lines = [`# ${nodeContent(tree)}`, ""];
  function walk(node: MindNode, depth: number) {
    lines.push(`${"  ".repeat(depth)}- ${nodeContent(node)}`);
    node.children.forEach((child) => walk(child, depth + 1));
  }
  tree.children.forEach((child) => walk(child, 0));
  if (floatingTopics.length) {
    lines.push("", `## ${t("Independent topics")}`, "");
    floatingTopics.forEach((topic) => {
      lines.push(`### ${nodeContent(topic.tree)}`, "");
      topic.tree.children.forEach((child) => walk(child, 0));
      lines.push("");
    });
  }
  if (floatingNotes.length) {
    lines.push("", `## ${t("Floating notes")}`, "");
    floatingNotes.forEach((note) =>
      lines.push(
        `- ${nodeContent({ key: note.key, text: note.text, children: [], textStyle: note.textStyle })}`,
      ),
    );
  }
  if (tree.summaries?.length) {
    const names = summaryTopicNames(tree, floatingTopics);
    lines.push("", `## ${t("Summaries")}`, "");
    tree.summaries.forEach((summary) =>
      lines.push(
        `- ${escapeText(names.get(summary.key) || t("Untitled topic"))}: ${summary.topics.map((key) => escapeText(names.get(key) || t("Untitled topic"))).join(", ")}`,
      ),
    );
  }
  return lines.join("\n") + "\n";
}
