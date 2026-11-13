import JSZip from "jszip";
import { parseDocument } from "./model.ts";
import type { MapContent, MindNode } from "./types.ts";
import { MAX_IMAGE_BYTES } from "./limits.ts";

const INVALID = "Invalid or unsupported minimap file";
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_DOCUMENT_CHARS = 256 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const TOO_LARGE = "Map file exceeds the 256 MB or 10000 entry limit";
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

// Check entry names, sizes and STORE compression before JSZip reads archive contents.
function validateZip(contents: string): {
  bytes: Uint8Array;
  assetSizes: Map<string, number>;
} {
  if (contents.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4)
    throw new Error(TOO_LARGE);
  let binary: string;
  try {
    binary = atob(contents);
  } catch {
    throw new Error(INVALID);
  }
  if (binary.length > MAX_ARCHIVE_BYTES) throw new Error(TOO_LARGE);
  if (binary.length < 22) throw new Error(INVALID);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  let end = bytes.length - 22;
  const min = Math.max(0, bytes.length - 22 - 65535);
  while (
    end >= min &&
    (view.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + view.getUint16(end + 20, true) !== bytes.length)
  )
    end--;
  if (
    end < min ||
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true)
  )
    throw new Error(INVALID);
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true);
  if (count > MAX_ENTRIES) throw new Error(TOO_LARGE);
  if (!count || view.getUint16(end + 8, true) !== count || start + size !== end)
    throw new Error(INVALID);
  const names = new Set<string>();
  const assetSizes = new Map<string, number>();
  let offset = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error(INVALID);
    const flags = view.getUint16(offset + 8, true),
      method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true),
      uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true),
      extraLength = view.getUint16(offset + 30, true),
      commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      nameLength > 100 ||
      flags & 1 ||
      method !== 0 ||
      compressed !== uncompressed
    )
      throw new Error(INVALID);
    if (
      local + 30 > start ||
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== method ||
      view.getUint16(local + 26, true) !== nameLength ||
      local + 30 + nameLength + view.getUint16(local + 28, true) + compressed > start ||
      bytes.subarray(local + 30, local + 30 + nameLength).some(
        (byte, index) => byte !== bytes[offset + 46 + index],
      ) ||
      (!(flags & 8) &&
        (view.getUint32(local + 18, true) !== compressed ||
          view.getUint32(local + 22, true) !== uncompressed))
    )
      throw new Error(INVALID);
    // JSZip can otherwise replace the validated name with a Unicode path.
    for (let extra = offset + 46 + nameLength; extra < offset + 46 + nameLength + extraLength;) {
      if (extra + 4 > offset + 46 + nameLength + extraLength) throw new Error(INVALID);
      const id = view.getUint16(extra, true), length = view.getUint16(extra + 2, true);
      if (id === 0x7075 || extra + 4 + length > offset + 46 + nameLength + extraLength)
        throw new Error(INVALID);
      extra += 4 + length;
    }
    const name = String.fromCharCode(
      ...bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (
      !(
        name === "manifest.json" ||
        /^maps\/[1-9]\d*\.json$/.test(name) ||
        /^assets\/[1-9]\d*\.(png|jpg|gif|webp)$/.test(name)
      ) ||
      names.has(name)
    )
      throw new Error(INVALID);
    if (name.startsWith("assets/") && uncompressed > MAX_IMAGE_BYTES)
      throw new Error("Image exceeds 10 MB");
    total += uncompressed;
    if (total > MAX_ARCHIVE_BYTES) throw new Error(TOO_LARGE);
    if (name.startsWith("assets/")) assetSizes.set(name, uncompressed);
    names.add(name);
    offset = next;
  }
  if (offset !== end || !names.has("manifest.json")) throw new Error(INVALID);
  return { bytes, assetSizes };
}

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
  const { bytes, assetSizes } = validateZip(contents);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    throw new Error(INVALID);
  }
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error(INVALID);
  let manifest: {
    format?: unknown;
    version?: unknown;
    type?: unknown;
    active?: unknown;
    maps?: unknown;
  };
  try {
    manifest = JSON.parse(await manifestFile.async("string"));
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
      const file = zip.file(path);
      if (!file) throw new Error(INVALID);
      source = file
        .async("base64")
        .then((data) => `data:image/${mediaTypes[match[1]]};base64,${data}`);
      assets.set(path, source);
    }
    return { ...node, children, image: { ...node.image, src: await source } };
  }
  const tabs: MapContent[] = [];
  let expandedSize = 0;
  for (const path of manifest.maps) {
    if (typeof path !== "string" || !/^maps\/[1-9]\d*\.json$/.test(path))
      throw new Error(INVALID);
    const file = zip.file(path);
    if (!file) throw new Error(INVALID);
    let text: string, data: Record<string, unknown>;
    try {
      text = await file.async("string");
    } catch {
      throw new Error(INVALID);
    }
    expandedSize += text.length;
    if (expandedSize > MAX_DOCUMENT_CHARS) throw new Error(TOO_LARGE);
    try {
      data = JSON.parse(text);
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
