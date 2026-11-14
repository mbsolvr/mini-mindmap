import JSZip from "jszip";
import { makeKey, parseDocument } from "./model.ts";
import {
  MAX_IMAGE_BYTES,
  validateTabCount,
  validateRelationCount,
} from "./limits.ts";
import { checkParseBudget } from "./parseBudget.ts";
import {
  openZip,
  validateZip,
  MAX_ARCHIVE_BYTES,
  MAX_ENTRIES,
  TOO_LARGE,
} from "./zip.ts";
import { readXmindXml } from "./xmindXml.ts";
import { resolveLayout } from "./layouts.ts";
import type { MapContent, MindNode, TextStyle, Workspace } from "./types.ts";

const INVALID = "Invalid or unsupported XMind file";
const LOCAL = "mini-mindmap";
const structures: Record<string, string> = {
  mindmap: "org.xmind.ui.map.unbalanced",
  logic: "org.xmind.ui.logic.right",
  reverse: "org.xmind.ui.logic.left",
  org: "org.xmind.ui.org-chart.down",
  fishbone: "org.xmind.ui.fishbone.rightHeaded",
  "reverse-fishbone": "org.xmind.ui.fishbone.leftHeaded",
};
type Data = Record<string, unknown>;
function object(value: unknown): Data {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(INVALID);
  return value as Data;
}
function array(value: unknown): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(INVALID);
  return value;
}
function title(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error(INVALID);
  return value;
}
function isWebLink(url: string): boolean {
  return /^https?:\/\//i.test(url) && !/[\u0000-\u001f\u007f]/.test(url);
}
function properties(
  style: TextStyle | undefined,
): Record<string, string | number> {
  return {
    ...(style?.color !== undefined ? { "fo:color": style.color } : {}),
    ...(style?.size !== undefined ? { "fo:font-size": style.size } : {}),
    ...(style?.bold !== undefined
      ? { "fo:font-weight": style.bold ? "bold" : "normal" }
      : {}),
    ...(style?.italic !== undefined
      ? { "fo:font-style": style.italic ? "italic" : "normal" }
      : {}),
    ...(style?.underline !== undefined
      ? { "fo:text-decoration": style.underline ? "underline" : "none" }
      : {}),
  };
}
function textStyle(value: unknown): TextStyle | undefined {
  if (value == null) return;
  const props = object(object(value).properties || {});
  const size = Number(
    String(props["fo:font-size"] ?? "").replace(/pt|px/g, ""),
  );
  const result: TextStyle = {
    ...(typeof props["fo:color"] === "string"
      ? { color: props["fo:color"] }
      : {}),
    ...(size >= 1 && size <= 200 ? { size } : {}),
    ...(props["fo:font-weight"] !== undefined
      ? {
          bold:
            props["fo:font-weight"] === "bold" ||
            Number(props["fo:font-weight"]) >= 600,
        }
      : {}),
    ...(props["fo:font-style"] !== undefined
      ? { italic: props["fo:font-style"] === "italic" }
      : {}),
    ...(props["fo:text-decoration"] !== undefined
      ? { underline: String(props["fo:text-decoration"]).includes("underline") }
      : {}),
  };
  return Object.keys(result).length ? result : undefined;
}

export async function readXmind(
  contents: string,
): Promise<{ workspace: Workspace; limited: boolean }> {
  const { zip, read } = await openZip(contents, true);
  let documentChars = 0,
    expandedImages = 0,
    limited = false;
  const parseBudget = { count: 0 };
  const imageSources = new Map<string, string | null>();
  async function text(path: string): Promise<string> {
    const result = new TextDecoder().decode(await read(path));
    documentChars += result.length;
    if (documentChars + expandedImages > MAX_ARCHIVE_BYTES)
      throw new Error(TOO_LARGE);
    return result;
  }
  async function json(path: string): Promise<unknown> {
    try {
      const result = await text(path);
      checkParseBudget(result, false, parseBudget);
      return JSON.parse(result);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(INVALID);
      throw error;
    }
  }
  const xmlPath = zip.file("content.xml") ? "content.xml" : "/content.xml";
  const sheets = array(
    zip.file("content.json")
      ? await json("content.json")
      : zip.file(xmlPath)
        ? readXmindXml(
            await text(xmlPath),
            zip.file("styles.xml") ? await text("styles.xml") : undefined,
            parseBudget,
          )
        : null,
  );
  if (!sheets.length) throw new Error(INVALID);
  validateTabCount(sheets.length);
  const tabs: MapContent[] = [];
  const sheetIds: string[] = [];
  for (const rawSheet of sheets) {
    const sheet = object(rawSheet),
      nativeSheet = sheet[LOCAL] == null ? null : object(sheet[LOCAL]);
    if (nativeSheet && nativeSheet.version !== 1) throw new Error(INVALID);
    if (sheet.theme) limited = true;
    const map: MapContent = { tree: { key: "", text: "", children: [] } };
    const imageTasks: (() => Promise<void>)[] = [];
    const used = new Set<string>();
    const importedKeys = new WeakMap<object, string>();
    let count = 0;
    function walk(raw: unknown, depth: number): MindNode {
      if (++count > 5000 || depth > 100)
        throw new Error(
          "A map can contain at most 5000 objects and 100 levels",
        );
      const topic = object(raw),
        native = topic[LOCAL] == null ? null : object(topic[LOCAL]);
      const key = topic.id == null ? makeKey() : title(topic.id);
      if (!key || used.has(key)) throw new Error(INVALID);
      used.add(key);
      importedKeys.set(topic, key);
      const children = topic.children == null ? {} : object(topic.children);
      const attached = array(children.attached),
        summaries = array(children.summary);
      const style = textStyle(topic.style);
      const node: MindNode = {
        key,
        text: title(topic.title),
        children: [...attached, ...summaries].map((child) =>
          walk(child, depth + 1),
        ),
        ...(topic.branch === "folded" ? { collapsed: true } : {}),
        ...(style ? { textStyle: style } : {}),
      };
      if (native) {
        for (const field of [
          "collapsed",
          "side",
          "layout",
          "template",
          "tabTitle",
        ] as const)
          if (native[field] !== undefined)
            Object.assign(node, { [field]: native[field] });
        if (native.childOrder !== undefined) {
          const order = array(native.childOrder);
          const byId = new Map(
            node.children.map((child) => [child.key, child]),
          );
          if (
            order.length === node.children.length &&
            new Set(order).size === order.length &&
            order.every((id) => typeof id === "string" && byId.has(id))
          )
            node.children = order.map((id) => byId.get(id as string)!);
          else limited = true;
        }
      } else if (typeof topic.structureClass === "string") {
        const layout = Object.keys(structures).find(
          (key) => structures[key] === topic.structureClass,
        );
        if (layout) node.layout = layout;
        else limited = true;
      }
      if (topic.position != null && !native) {
        const position = object(topic.position);
        if (typeof position.x === "number")
          node.side = position.x < 0 ? "left" : "right";
      }
      if (topic.href != null) {
        const url = title(topic.href);
        if (isWebLink(url))
          node.link = {
            url,
            ...(typeof native?.linkLabel === "string"
              ? { label: native.linkLabel }
              : {}),
          };
        else limited = true;
      }
      if (topic.notes != null) {
        const notes = object(topic.notes);
        if (notes.plain != null)
          node.notes = title(object(notes.plain).content);
        else if (notes.realHTML != null) {
          const html = title(object(notes.realHTML).content);
          const template = document.createElement("template");
          template.innerHTML = html;
          node.notes = template.content.textContent || "";
          limited = true;
        }
      }
      if (topic.labels != null) node.labels = array(topic.labels).map(title);
      if (topic.image != null) {
        const image = object(topic.image),
          src = title(image.src);
        const path = src.replace(/^xap:/, "");
        if (
          !/^(?:resources|attachments)\/(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\0]+$/i.test(
            path,
          )
        )
          throw new Error(INVALID);
        imageTasks.push(async () => {
          const data = await read(path, MAX_IMAGE_BYTES);
          expandedImages += Math.ceil(data.length / 3) * 4;
          if (expandedImages + documentChars > MAX_ARCHIVE_BYTES)
            throw new Error(TOO_LARGE);
          if (!imageSources.has(path)) {
            const ext = path.split(".").pop()!.toLowerCase();
            const header = String.fromCharCode(...data.subarray(0, 12));
            const mime = /^(png|jpe?g|gif|webp)$/.test(ext)
              ? ext === "jpg"
                ? "jpeg"
                : ext
              : header.startsWith("\x89PNG\r\n\x1a\n")
                ? "png"
                : header.startsWith("\xff\xd8\xff")
                  ? "jpeg"
                  : /^GIF8[79]a/.test(header)
                    ? "gif"
                    : header.startsWith("RIFF") && header.slice(8) === "WEBP"
                      ? "webp"
                      : null;
            if (!mime) {
              limited = true;
              imageSources.set(path, null);
              return;
            }
            let binary = "";
            for (let offset = 0; offset < data.length; offset += 8192)
              binary += String.fromCharCode(
                ...data.subarray(offset, offset + 8192),
              );
            imageSources.set(path, `data:image/${mime};base64,${btoa(binary)}`);
          }
          const src = imageSources.get(path);
          if (src)
            node.image = {
              src,
              ...(typeof native?.imageCaption === "string"
                ? { caption: native.imageCaption }
                : {}),
            };
        });
      }
      for (const raw of array(children.detached)) {
        const floating = object(raw),
          tree = walk(raw, 0);
        const position = object(
          floating.position || {
            x: 240,
            y: (map.floatingTopics?.length || 0) * 100,
          },
        );
        const x = position.x as number,
          y = position.y as number;
        const data = floating[LOCAL] == null ? null : object(floating[LOCAL]);
        if (data?.kind === "note") {
          if (tree.children.length || tree.image || floating.image)
            throw new Error(INVALID);
          (map.floatingNotes ||= []).push({
            key: tree.key,
            text: tree.text,
            x,
            y,
            ...(tree.textStyle ? { textStyle: tree.textStyle } : {}),
          });
        } else (map.floatingTopics ||= []).push({ tree, x, y });
      }
      if (!native)
        for (const raw of array(topic.extensions)) {
          const extension = object(raw);
          if (extension.provider !== structures.mindmap) continue;
          const item = array(extension.content)
            .map(object)
            .find((item) => item.name === "right-number");
          if (!item) continue;
          const right = Number(item.content);
          if (!Number.isInteger(right) || right < 0 || right > attached.length)
            throw new Error(INVALID);
          node.children.slice(0, attached.length).forEach((child, index) => {
            child.side = index < right ? "right" : "left";
          });
        }
      if (!nativeSheet)
        for (const raw of array(topic.summaries)) {
          const summary = object(raw),
            range = /^\((\d+),(\d+)\)$/.exec(title(summary.range));
          if (!range) throw new Error(INVALID);
          const start = Number(range[1]),
            end = Number(range[2]);
          if (
            start > end ||
            end >= attached.length ||
            !summaries.some((raw) => object(raw).id === summary.topicId)
          )
            throw new Error(INVALID);
          (map.tree.summaries ||= []).push({
            key: title(summary.topicId),
            topics: attached
              .slice(start, end + 1)
              .map((raw) => importedKeys.get(object(raw))!),
          });
          const summaryNode = node.children.find(
            (child) => child.key === summary.topicId,
          );
          if (summaryNode && node.children[start].side)
            summaryNode.side = node.children[start].side;
        }
      if (
        array(children.callout).length ||
        array(topic.boundaries).length ||
        array(topic.markers).length
      )
        limited = true;
      return node;
    }
    const tree = walk(sheet.rootTopic, 0);
    if (map.tree.summaries) tree.summaries = map.tree.summaries;
    map.tree = tree;
    if (!object(sheet.rootTopic)[LOCAL] && sheet.title != null)
      tree.tabTitle = title(sheet.title);
    if (nativeSheet?.summaries !== undefined)
      tree.summaries = nativeSheet.summaries as MindNode["summaries"];
    const relationships = array(sheet.relationships);
    validateRelationCount(relationships.length);
    const relations = relationships.map((raw) => {
      const relation = object(raw),
        native = relation[LOCAL] == null ? null : object(relation[LOCAL]);
      if (relation.controlPoints && !native) limited = true;
      return {
        relKey: title(relation.id) || makeKey(),
        from: title(relation.end1Id),
        to: title(relation.end2Id),
        label: title(relation.title),
        ...(native?.controls !== undefined
          ? {
              controls: native.controls as NonNullable<
                MindNode["relations"]
              >[number]["controls"],
            }
          : {}),
      };
    });
    if (relations.length) tree.relations = relations;
    for (const load of imageTasks) await load();
    sheetIds.push(title(sheet.id));
    tabs.push(map);
  }
  let active = 0;
  if (zip.file("metadata.json")) {
    const metadata = object(await json("metadata.json"));
    active = Math.max(0, sheetIds.indexOf(title(metadata.activeSheetId)));
  }
  const serialized = JSON.stringify({
    format: "mini-mindmap",
    version: 2,
    type: "workspace",
    active,
    tabs,
  });
  if (serialized.length > MAX_ARCHIVE_BYTES) throw new Error(TOO_LARGE);
  const workspace = parseDocument(serialized) as Workspace;
  return { workspace, limited };
}

export async function createXmind(
  workspace: Workspace,
): Promise<{ contents: string; limited: boolean }> {
  const text = JSON.stringify(workspace);
  if (text.length > MAX_ARCHIVE_BYTES) throw new Error(TOO_LARGE);
  const checked = parseDocument(text) as Workspace;
  validateTabCount(checked.tabs.length);
  const zip = new JSZip(),
    images = new Map<string, string>();
  let limited = false;
  function writeImage(src: string): string {
    let path = images.get(src);
    if (path) return `xap:${path}`;
    const match =
      /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
        src,
      );
    if (!match) throw new Error("Unsupported image data");
    const data = atob(match[2]);
    if (data.length > MAX_IMAGE_BYTES) throw new Error("Image exceeds 10 MB");
    path = `resources/${images.size + 1}.${match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase()}`;
    images.set(src, path);
    zip.file(path, match[2], {
      base64: true,
      createFolders: false,
      compression: "STORE",
    });
    return `xap:${path}`;
  }
  const sheets = checked.tabs.map((map, index) => {
    if (map.tree.relations?.some((relation) => relation.controls))
      limited = true;
    const summaryByKey = new Map(
      map.tree.summaries?.map((summary) => [summary.key, summary]),
    );
    const standard = new Map<string, { key: string; topics: string[] }[]>();
    const standardKeys = new Set<string>();
    function children(node: MindNode) {
      return node === map.tree && resolveLayout(node.layout) === "mindmap"
        ? [
            ...node.children.filter((child) => child.side !== "left"),
            ...node.children.filter((child) => child.side === "left"),
          ]
        : node.children;
    }
    function locate(node: MindNode) {
      for (const child of node.children) {
        const summary = summaryByKey.get(child.key);
        if (!summary) continue;
        const attached = children(node).filter(
          (child) => child.key !== summary.key,
        );
        const indexes = new Map(
          attached.map((child, index) => [child.key, index]),
        );
        const positions = summary.topics
          .map((key) => indexes.get(key) ?? -1)
          .sort((a, b) => a - b);
        if (
          positions[0] >= 0 &&
          positions.every((n, i) => n === positions[0] + i)
        ) {
          const entries = standard.get(node.key) || [];
          entries.push({ key: summary.key, topics: summary.topics });
          standard.set(node.key, entries);
          standardKeys.add(summary.key);
        } else limited = true;
      }
      node.children.forEach(locate);
    }
    locate(map.tree);
    map.floatingTopics?.forEach((topic) => locate(topic.tree));
    if (standardKeys.size !== (map.tree.summaries?.length || 0)) limited = true;
    function walk(node: MindNode): Data {
      const native: Data = {};
      for (const field of [
        "collapsed",
        "side",
        "layout",
        "template",
        "tabTitle",
      ] as const)
        if (node[field] !== undefined) native[field] = node[field];
      if (node.image?.caption !== undefined)
        native.imageCaption = node.image.caption;
      const link =
        node.link && isWebLink(node.link.url) ? node.link : undefined;
      if (node.link && !link) limited = true;
      if (link?.label !== undefined) native.linkLabel = link.label;
      const ordered = children(node);
      const attached = ordered.filter((child) => !standardKeys.has(child.key));
      const summary = ordered.filter((child) => standardKeys.has(child.key));
      if (
        summary.length ||
        ordered.some((child, index) => child !== node.children[index])
      )
        native.childOrder = node.children.map((child) => child.key);
      const result: Data = {
        id: node.key,
        class: "topic",
        title: node.text,
        children: {
          attached: attached.map(walk),
          ...(summary.length ? { summary: summary.map(walk) } : {}),
        },
        [LOCAL]: native,
        ...(node.layout
          ? { structureClass: structures[resolveLayout(node.layout)] }
          : {}),
        ...(node.collapsed ? { branch: "folded" } : {}),
        ...(node.side
          ? { position: { x: node.side === "left" ? -200 : 200, y: 0 } }
          : {}),
        ...(node.textStyle
          ? { style: { properties: properties(node.textStyle) } }
          : {}),
        ...(node.notes !== undefined
          ? { notes: { plain: { content: node.notes } } }
          : {}),
        ...(node.labels ? { labels: node.labels } : {}),
        ...(link ? { href: link.url } : {}),
        ...(node.image ? { image: { src: writeImage(node.image.src) } } : {}),
      };
      const ranges = standard.get(node.key);
      if (ranges) {
        const indexes = new Map(
          attached.map((child, index) => [child.key, index]),
        );
        result.summaries = ranges.map((range) => {
          const positions = range.topics.map((key) => indexes.get(key)!);
          return {
            id: makeKey(),
            topicId: range.key,
            range: `(${Math.min(...positions)},${Math.max(...positions)})`,
          };
        });
      }
      if (node === map.tree && resolveLayout(node.layout) === "mindmap")
        result.extensions = [
          {
            provider: structures.mindmap,
            content: [
              {
                name: "right-number",
                content: String(
                  attached.filter((child) => child.side !== "left").length,
                ),
              },
            ],
          },
        ];
      return result;
    }
    const rootTopic = walk(map.tree);
    rootTopic.structureClass ||= structures.mindmap;
    const detached = [
      ...(map.floatingTopics || []).map((topic) => ({
        ...walk(topic.tree),
        position: { x: topic.x, y: topic.y },
      })),
      ...(map.floatingNotes || []).map((note) => ({
        ...walk({
          key: note.key,
          text: note.text,
          children: [],
          textStyle: note.textStyle,
        }),
        position: { x: note.x, y: note.y },
        [LOCAL]: { kind: "note" },
      })),
    ];
    if (detached.length) object(rootTopic.children).detached = detached;
    return {
      id: `sheet-${index + 1}`,
      class: "sheet",
      title: map.tree.tabTitle || map.tree.text,
      rootTopic,
      topicPositioning: "fixed",
      topicOverlapping: "overlap",
      [LOCAL]: {
        version: 1,
        ...(map.tree.summaries !== undefined
          ? { summaries: map.tree.summaries }
          : {}),
      },
      ...(map.tree.relations?.length
        ? {
            relationships: map.tree.relations.map((relation) => ({
              id: relation.relKey,
              end1Id: relation.from,
              end2Id: relation.to,
              title: relation.label,
              controlPoints: {
                "0": { angle: 0, amount: 0.3 },
                "1": { angle: 0, amount: 0.3 },
              },
              [LOCAL]: {
                ...(relation.controls ? { controls: relation.controls } : {}),
              },
            })),
          }
        : {}),
    };
  });
  const content = JSON.stringify(sheets);
  const metadata = JSON.stringify({
    creator: { name: "Mini Mindmap" },
    dataStructureVersion: "2",
    layoutEngineVersion: "3",
    activeSheetId: sheets[checked.active].id,
  });
  const parseBudget = { count: 0 };
  checkParseBudget(content, false, parseBudget);
  checkParseBudget(metadata, false, parseBudget);
  zip.file("content.json", content);
  zip.file("metadata.json", metadata);
  zip.file(
    "manifest.json",
    JSON.stringify({
      "file-entries": Object.fromEntries(
        Object.keys(zip.files).map((path) => [path, {}]),
      ),
    }),
  );
  if (Object.keys(zip.files).length > MAX_ENTRIES) throw new Error(TOO_LARGE);
  const contents = await zip.generateAsync({
    type: "base64",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  validateZip(contents, true);
  return { contents, limited };
}
