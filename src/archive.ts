import JSZip from "jszip";
import { parseDocument } from "./model.ts";
import type { MapContent, MindNode } from "./types.ts";
import { MAX_IMAGE_BYTES, validateTabCount } from "./limits.ts";
import { openZip, MAX_ARCHIVE_BYTES, MAX_ENTRIES, TOO_LARGE } from "./zip.ts";
import { checkParseBudget } from "./parseBudget.ts";

const INVALID = "Invalid or unsupported minimap file";
const MAX_DOCUMENT_CHARS = 256 * 1024 * 1024;
const imageTypes: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  gif: "gif",
  webp: "webp",
};
const mediaTypes: Record<string, string> = {
  png: "png",
  jpg: "jpeg",
  gif: "gif",
  webp: "webp",
};

export async function createArchive(contents: string): Promise<string> {
  if (contents.length > MAX_DOCUMENT_CHARS) throw new Error(TOO_LARGE);
  const document = parseDocument(contents);
  const zip = new JSZip(),
    images = new Map<string, string>();
  function writeNode(node: MindNode): MindNode {
    const children = node.children.map(writeNode);
    if (!node.image) return { ...node, children };
    const match =
      /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
        node.image.src,
      );
    if (!match) throw new Error("Unsupported image data");
    // Identical images share one asset even when used by multiple topics.
    let path = images.get(node.image.src);
    if (!path) {
      let bytes: string;
      try {
        bytes = atob(match[2]);
      } catch {
        throw new Error("Unsupported image data");
      }
      if (bytes.length > MAX_IMAGE_BYTES)
        throw new Error("Image exceeds 10 MB");
      path = `assets/${images.size + 1}.${imageTypes[match[1].toLowerCase()]}`;
      images.set(node.image.src, path);
      zip.file(path, match[2], { base64: true, createFolders: false });
    }
    return { ...node, children, image: { ...node.image, src: path } };
  }
  const tabs: MapContent[] =
    document.type === "map" ? [document] : document.tabs;
  const maps = tabs.map((tab, index) => {
    const path = `maps/${index + 1}.json`;
    zip.file(
      path,
      JSON.stringify({
        tree: writeNode(tab.tree),
        ...(tab.floatingTopics?.length
          ? {
              floatingTopics: tab.floatingTopics.map((topic) => ({
                ...topic,
                tree: writeNode(topic.tree),
              })),
            }
          : {}),
        ...(tab.floatingNotes?.length
          ? { floatingNotes: tab.floatingNotes }
          : {}),
      }),
      { createFolders: false },
    );
    return path;
  });
  zip.file(
    "manifest.json",
    JSON.stringify({
      format: "mini-mindmap",
      version: tabs.some((tab) => tab.tree.summaries?.length) ? 4 : 2,
      type: document.type,
      active: document.type === "workspace" ? document.active : 0,
      maps,
    }),
    { createFolders: false },
  );
  if (Object.keys(zip.files).length > MAX_ENTRIES) throw new Error(TOO_LARGE);
  const result = await zip.generateAsync({
    type: "base64",
    compression: "STORE",
  });
  if (
    result.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4 ||
    (result.length / 4) * 3 -
      (result.endsWith("==") ? 2 : result.endsWith("=") ? 1 : 0) >
      MAX_ARCHIVE_BYTES
  )
    throw new Error(TOO_LARGE);
  return result;
}

export async function readArchive(contents: string): Promise<string> {
  const { assetSizes, read } = await openZip(contents);
  const parseBudget = { count: 0 };
  async function text(path: string): Promise<string> {
    const result = new TextDecoder().decode(await read(path));
    checkParseBudget(result, false, parseBudget);
    return result;
  }
  let manifest: {
    format?: unknown;
    version?: unknown;
    type?: unknown;
    active?: unknown;
    maps?: unknown;
  };
  try {
    manifest = JSON.parse(await text("manifest.json"));
  } catch {
    throw new Error(INVALID);
  }
  if (
    !manifest ||
    manifest.format !== "mini-mindmap" ||
    (manifest.version !== 2 && manifest.version !== 4) ||
    (manifest.type !== "map" && manifest.type !== "workspace") ||
    !Array.isArray(manifest.maps) ||
    !manifest.maps.length ||
    (manifest.type === "map" && manifest.maps.length !== 1) ||
    !Number.isInteger(manifest.active) ||
    Number(manifest.active) < 0 ||
    Number(manifest.active) >= manifest.maps.length ||
    new Set(manifest.maps).size !== manifest.maps.length
  )
    throw new Error(INVALID);
  validateTabCount(manifest.maps.length);
  const assets = new Map<string, Promise<string>>();
  async function readNode(node: MindNode): Promise<MindNode> {
    const children = await Promise.all(node.children.map(readNode));
    if (!node.image) return { ...node, children };
    const path = node.image.src,
      match =
        typeof path === "string" &&
        /^assets\/[1-9]\d*\.(png|jpg|gif|webp)$/.exec(path);
    if (!match) throw new Error(INVALID);
    let source = assets.get(path);
    if (!source) {
      source = read(path, MAX_IMAGE_BYTES).then((data) => {
        let binary = "";
        for (let offset = 0; offset < data.length; offset += 8192)
          binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
        return `data:image/${mediaTypes[match[1]]};base64,${btoa(binary)}`;
      });
      assets.set(path, source);
    }
    return { ...node, children, image: { ...node.image, src: await source } };
  }
  const tabs: MapContent[] = [];
  let expandedSize = 0;
  for (const path of manifest.maps) {
    if (typeof path !== "string" || !/^maps\/[1-9]\d*\.json$/.test(path))
      throw new Error(INVALID);
    let json: string, data: Record<string, unknown>;
    try {
      json = await text(path);
    } catch {
      throw new Error(INVALID);
    }
    expandedSize += json.length;
    if (expandedSize > MAX_DOCUMENT_CHARS) throw new Error(TOO_LARGE);
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error(INVALID);
    }
    const parsed = parseDocument(
      JSON.stringify({
        ...data,
        format: "mini-mindmap",
        version: 2,
        type: "map",
      }),
    );
    if (parsed.type !== "map") throw new Error(INVALID);
    function countImages(node: MindNode) {
      if (node.image) {
        const size = assetSizes.get(node.image.src);
        if (size === undefined) throw new Error(INVALID);
        expandedSize += Math.ceil(size / 3) * 4;
        if (expandedSize > MAX_DOCUMENT_CHARS) throw new Error(TOO_LARGE);
      }
      node.children.forEach(countImages);
    }
    countImages(parsed.tree);
    parsed.floatingTopics?.forEach((topic) => countImages(topic.tree));
    tabs.push({
      tree: await readNode(parsed.tree),
      ...(parsed.floatingTopics?.length
        ? {
            floatingTopics: await Promise.all(
              parsed.floatingTopics.map(async (topic) => ({
                ...topic,
                tree: await readNode(topic.tree),
              })),
            ),
          }
        : {}),
      ...(parsed.floatingNotes?.length
        ? { floatingNotes: parsed.floatingNotes }
        : {}),
    });
  }
  const result = JSON.stringify(
    manifest.type === "map"
      ? { format: "mini-mindmap", version: 2, type: "map", ...tabs[0] }
      : {
          format: "mini-mindmap",
          version: 2,
          type: "workspace",
          active: manifest.active,
          tabs,
        },
  );
  parseDocument(result);
  return result;
}
