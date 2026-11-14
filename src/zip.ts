import JSZip from "jszip";
import { MAX_IMAGE_BYTES } from "./limits.ts";

const INVALID = "Invalid or unsupported minimap file";
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_ENTRIES = 10000;
export const TOO_LARGE = "Map file exceeds the 256 MB or 10000 entry limit";

// Validate the ZIP directory before decoding any entry. XMind also permits DEFLATE.
export function validateZip(
  contents: string,
  xmind = false,
): {
  bytes: Uint8Array;
  assetSizes: Map<string, number>;
  checksums: Map<string, number>;
} {
  const invalid = xmind ? "Invalid or unsupported XMind file" : INVALID;
  if (contents.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4)
    throw new Error(TOO_LARGE);
  let binary: string;
  try {
    binary = atob(contents);
  } catch {
    throw new Error(invalid);
  }
  if (binary.length > MAX_ARCHIVE_BYTES) throw new Error(TOO_LARGE);
  if (binary.length < 22) throw new Error(invalid);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  let end = bytes.length - 22;
  const min = Math.max(0, bytes.length - 22 - 65535);
  while (end >= min && view.getUint32(end, true) !== 0x06054b50) end--;
  if (
    end < min ||
    end + 22 + view.getUint16(end + 20, true) !== bytes.length ||
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true)
  )
    throw new Error(invalid);
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true);
  if (count > MAX_ENTRIES) throw new Error(TOO_LARGE);
  if (!count || view.getUint16(end + 8, true) !== count || start + size !== end)
    throw new Error(invalid);
  const names = new Set<string>();
  const assetSizes = new Map<string, number>();
  const checksums = new Map<string, number>();
  let offset = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error(invalid);
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
      nameLength > (xmind ? 1024 : 100) ||
      flags & 1 ||
      (method !== 0 && !(xmind && method === 8)) ||
      (method === 0 && compressed !== uncompressed)
    )
      throw new Error(invalid);
    if (
      local + 30 > start ||
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== method ||
      view.getUint16(local + 26, true) !== nameLength ||
      local + 30 + nameLength + view.getUint16(local + 28, true) + compressed >
        start ||
      bytes
        .subarray(local + 30, local + 30 + nameLength)
        .some((byte, index) => byte !== bytes[offset + 46 + index]) ||
      (!(flags & 8) &&
        (view.getUint32(local + 14, true) !==
          view.getUint32(offset + 16, true) ||
          view.getUint32(local + 18, true) !== compressed ||
          view.getUint32(local + 22, true) !== uncompressed))
    )
      throw new Error(invalid);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    // JSZip must not replace the validated name with a different Unicode path.
    for (
      let extra = offset + 46 + nameLength;
      extra < offset + 46 + nameLength + extraLength;
    ) {
      if (extra + 4 > offset + 46 + nameLength + extraLength)
        throw new Error(invalid);
      const id = view.getUint16(extra, true),
        length = view.getUint16(extra + 2, true);
      if (
        extra + 4 + length > offset + 46 + nameLength + extraLength ||
        (id === 0x7075 &&
          (!xmind ||
            length < 5 ||
            new TextDecoder("utf-8", { fatal: true }).decode(
              bytes.subarray(extra + 9, extra + 4 + length),
            ) !== name))
      )
        throw new Error(invalid);
      extra += 4 + length;
    }
    if (
      (xmind
        ? !name ||
          (name.startsWith("/") && name !== "/content.xml") ||
          name.includes("\\") ||
          name.includes("\0") ||
          name.split("/").some((part) => part === ".." || part === ".")
        : !(
            name === "manifest.json" ||
            /^maps\/[1-9]\d*\.json$/.test(name) ||
            /^assets\/[1-9]\d*\.(png|jpg|gif|webp)$/.test(name)
          )) ||
      names.has(name)
    )
      throw new Error(invalid);
    if (!xmind && name.startsWith("assets/") && uncompressed > MAX_IMAGE_BYTES)
      throw new Error("Image exceeds 10 MB");
    total += uncompressed;
    if (total > MAX_ARCHIVE_BYTES) throw new Error(TOO_LARGE);
    assetSizes.set(name, uncompressed);
    checksums.set(name, view.getUint32(offset + 16, true));
    names.add(name);
    offset = next;
  }
  if (offset !== end || (!xmind && !names.has("manifest.json")))
    throw new Error(invalid);
  return { bytes, assetSizes, checksums };
}

// CRC and output limits are checked while inflating, including forged ZIP sizes.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export async function openZip(contents: string, xmind = false) {
  const INVALID = xmind
    ? "Invalid or unsupported XMind file"
    : "Invalid or unsupported minimap file";
  const { bytes, assetSizes: sizes, checksums } = validateZip(contents, xmind);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error(INVALID);
  }
  let totalRead = 0;
  const cache = new Map<string, Promise<Uint8Array>>();
  function read(path: string, limit = MAX_ARCHIVE_BYTES): Promise<Uint8Array> {
    const size = sizes.get(path),
      file = zip.file(path);
    if (size === undefined || !file) throw new Error(INVALID);
    if (size > limit)
      throw new Error(
        limit === MAX_IMAGE_BYTES ? "Image exceeds 10 MB" : TOO_LARGE,
      );
    let promise = cache.get(path);
    if (!promise) {
      promise = new Promise((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        let length = 0,
          crc = 0xffffffff;
        // JSZip's declarations omit this documented streaming API.
        const stream = (
          file as JSZip.JSZipObject & {
            internalStream(
              type: "uint8array",
            ): JSZip.JSZipStreamHelper<Uint8Array>;
          }
        ).internalStream("uint8array");
        stream.on("data", (chunk: Uint8Array) => {
          length += chunk.length;
          totalRead += chunk.length;
          if (length > size || totalRead > MAX_ARCHIVE_BYTES) {
            stream.pause();
            reject(new Error(TOO_LARGE));
            return;
          }
          for (const byte of chunk)
            crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
          chunks.push(chunk);
        });
        stream.on("error", () => reject(new Error(INVALID)));
        stream.on("end", () => {
          if (
            length !== size ||
            (crc ^ 0xffffffff) >>> 0 !== checksums.get(path)
          ) {
            reject(new Error(INVALID));
            return;
          }
          const result = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
          }
          resolve(result);
        });
        stream.resume();
      });
      cache.set(path, promise);
    }
    return promise;
  }
  return { zip, assetSizes: sizes, read };
}
