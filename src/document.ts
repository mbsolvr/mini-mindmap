import type { Document, MapContent, MindNode, TextStyle } from "./types.ts";
import { makeKey } from "./ids.ts";
import { hasSummaryOverlap, summaryIndex } from "./summaryConflicts.ts";
import {
  MAX_IMAGE_BYTES,
  validateMapLimits,
  validRelationControls,
} from "./limits.ts";

export function parseDocument(text: string): Document {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid map file format or version");
  const data = parsed as Record<string, unknown>;
  if (
    data.format !== "mini-mindmap" ||
    data.version !== 2 ||
    (data.type !== "map" && data.type !== "workspace")
  )
    throw new Error("Invalid map file format or version");
  const seen = new Set<string>();
  let count = 0;
  function validStyle(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const s = value as Record<string, unknown>;
    return (
      (s.color == null || typeof s.color === "string") &&
      [s.bold, s.italic, s.underline].every(
        (v) => v == null || typeof v === "boolean",
      ) &&
      (s.size == null ||
        (typeof s.size === "number" &&
          Number.isFinite(s.size) &&
          s.size >= 1 &&
          s.size <= 200))
    );
  }
  function normalize(value: unknown, depth: number): MindNode {
    count += 1;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      depth > 100 ||
      count > 5000
    ) {
      throw new Error("Invalid or overly complex topic data");
    }
    const node = value as Record<string, unknown>;
    if (typeof node.text !== "string")
      throw new Error("Invalid or overly complex topic data");
    if (node.children != null && !Array.isArray(node.children))
      throw new Error("Invalid child topic data");
    if (node.textStyle != null && !validStyle(node.textStyle))
      throw new Error("Invalid topic style");
    if ((node.notes != null && typeof node.notes !== "string") ||
        (node.labels != null && (!Array.isArray(node.labels) ||
          node.labels.some((label: unknown) => typeof label !== "string"))))
      throw new Error("Invalid topic data");
    if (
      [node.tabTitle, node.layout, node.template].some(
        (v) => v != null && typeof v !== "string",
      ) ||
      (node.collapsed != null && typeof node.collapsed !== "boolean") ||
      (node.side != null && node.side !== "left" && node.side !== "right")
    )
      throw new Error("Invalid topic data");
    for (const field of ["image", "link"] as const)
      if (node[field] != null) {
        const item = node[field];
        if (typeof item !== "object" || Array.isArray(item))
          throw new Error("Invalid topic data");
        const data = item as Record<string, unknown>,
          primary = field === "image" ? "src" : "url",
          secondary = field === "image" ? "caption" : "label";
        if (
          typeof data[primary] !== "string" ||
          (data[secondary] != null && typeof data[secondary] !== "string")
        )
          throw new Error("Invalid topic data");
        if (field === "image") {
          const src = data.src as string,
            match =
              /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
                src,
              );
          if (
            match &&
            (match[1].length / 4) * 3 -
              (match[1].endsWith("==") ? 2 : match[1].endsWith("=") ? 1 : 0) >
              MAX_IMAGE_BYTES
          )
            throw new Error("Image exceeds 10 MB");
        }
      }
    const key = typeof node.key === "string" && node.key ? node.key : makeKey();
    if (seen.has(key)) throw new Error("The map contains duplicate topic IDs");
    seen.add(key);
    return {
      ...node,
      key,
      text: node.text,
      children: (node.children || []).map((child: unknown) =>
        normalize(child, depth + 1),
      ),
    } as MindNode;
  }
  function content(value: Record<string, unknown>): MapContent {
    seen.clear();
    count = 0;
    const tree = normalize(value.tree, 0);
    const position = (item: Record<string, unknown>) => {
      if (
        typeof item.x !== "number" ||
        typeof item.y !== "number" ||
        !Number.isFinite(item.x) ||
        !Number.isFinite(item.y) ||
        Math.abs(item.x) > 100000 ||
        Math.abs(item.y) > 100000
      )
        throw new Error("Invalid floating element position");
      return { x: item.x, y: item.y };
    };
    if (value.floatingTopics != null && !Array.isArray(value.floatingTopics))
      throw new Error("Invalid floating topic data");
    if (value.floatingNotes != null && !Array.isArray(value.floatingNotes))
      throw new Error("Invalid floating note data");
    const floatingTopics = (value.floatingTopics || []).map(
      (entry: unknown) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
          throw new Error("Invalid floating topic data");
        const item = entry as Record<string, unknown>;
        return { ...position(item), tree: normalize(item.tree, 0) };
      },
    );
    const topicKeys = new Set(seen);
    const floatingNotes = (value.floatingNotes || []).map((entry: unknown) => {
      count++;
      if (
        count > 5000 ||
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry)
      )
        throw new Error("Invalid floating note data");
      const item = entry as Record<string, unknown>;
      if (
        typeof item.key !== "string" ||
        !item.key ||
        seen.has(item.key) ||
        typeof item.text !== "string"
      )
        throw new Error("Invalid floating note data");
      let textStyle: TextStyle | undefined;
      if (item.textStyle != null) {
        if (!validStyle(item.textStyle))
          throw new Error("Invalid floating note style");
        const style = item.textStyle as Record<string, unknown>;
        textStyle = {
          ...(typeof style.color === "string" ? { color: style.color } : {}),
          ...(typeof style.bold === "boolean" ? { bold: style.bold } : {}),
          ...(typeof style.italic === "boolean"
            ? { italic: style.italic }
            : {}),
          ...(typeof style.underline === "boolean"
            ? { underline: style.underline }
            : {}),
          ...(typeof style.size === "number" ? { size: style.size } : {}),
        };
      }
      seen.add(item.key);
      return {
        key: item.key,
        text: item.text,
        ...position(item),
        ...(textStyle ? { textStyle } : {}),
      };
    });
    const result = {
      tree,
      ...(floatingTopics.length ? { floatingTopics } : {}),
      ...(floatingNotes.length ? { floatingNotes } : {}),
    };
    if (tree.relations != null) {
      if (!Array.isArray(tree.relations))
        throw new Error("Invalid connection data");
      const ids = new Set<string>();
      for (const relation of tree.relations) {
        if (
          !relation ||
          typeof relation !== "object" ||
          typeof relation.relKey !== "string" ||
          !relation.relKey ||
          ids.has(relation.relKey) ||
          typeof relation.from !== "string" ||
          typeof relation.to !== "string" ||
          !topicKeys.has(relation.from) ||
          !topicKeys.has(relation.to) ||
          relation.from === relation.to ||
          typeof relation.label !== "string" ||
          (relation.controls !== undefined &&
            !validRelationControls(relation.controls))
        )
          throw new Error("Invalid connection data");
        ids.add(relation.relKey);
      }
    }
    if (tree.summaries != null) {
      if (!Array.isArray(tree.summaries) || tree.summaries.length > 5000)
        throw new Error("Invalid summary data");
      const ids = new Set<string>();
      for (const summary of tree.summaries) {
        if (
          !summary ||
          typeof summary !== "object" ||
          typeof summary.key !== "string" ||
          !summary.key ||
          ids.has(summary.key) ||
          !topicKeys.has(summary.key) ||
          !Array.isArray(summary.topics) ||
          !summary.topics.length ||
          summary.topics.length > 5000 ||
          new Set(summary.topics).size !== summary.topics.length ||
          summary.topics.some(
            (key: unknown) =>
              typeof key !== "string" ||
              key === summary.key ||
              !topicKeys.has(key),
          )
        )
          throw new Error("Invalid summary data");
        ids.add(summary.key);
      }
      if (tree.summaries.length) {
        if (hasSummaryOverlap(result)) throw new Error("Invalid summary data");
        const index = summaryIndex(result);
        const summaries = tree.summaries.map((summary) => ({
          ...summary,
          topics: index.normalize(summary.topics, false),
        }));
        if (
          summaries.some((summary) => index.oppositeSides(summary.topics)) ||
          hasSummaryOverlap({ ...result, tree: { ...tree, summaries } })
        )
          throw new Error("Invalid summary data");
      }
    }
    validateMapLimits(result);
    return result;
  }
  if (data.type === "workspace") {
    if (
      !Array.isArray(data.tabs) ||
      !data.tabs.length ||
      typeof data.active !== "number" ||
      !Number.isInteger(data.active) ||
      data.active < 0 ||
      data.active >= data.tabs.length
    )
      throw new Error("Invalid workspace data");
    return {
      format: "mini-mindmap",
      version: 2,
      type: "workspace",
      active: data.active,
      tabs: data.tabs.map((tab: unknown) => {
        if (!tab || typeof tab !== "object" || !("tree" in tab))
          throw new Error("Invalid workspace tab data");
        return content(tab as Record<string, unknown>);
      }),
    };
  }
  if (!data.tree) throw new Error("Invalid map file format or version");
  return { format: "mini-mindmap", version: 2, type: "map", ...content(data) };
}
