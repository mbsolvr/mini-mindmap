import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { createArchive, readArchive } from "../src/archive.ts";
import { parseDocument } from "../src/model.ts";
import { MAX_PARSE_CONTAINERS } from "../src/parseBudget.ts";
import { readFile } from "node:fs/promises";

test("reference file opens and round trips", async () => {
  const fixture = await readFile(new URL("./fixtures/reference.minimap", import.meta.url));
  const expected = JSON.parse(await readFile(new URL("./fixtures/reference.json", import.meta.url), "utf8"));
  assert.deepEqual(parseDocument(await readArchive(fixture.toString("base64"))), expected);
  assert.deepEqual(parseDocument(await readArchive(await createArchive(JSON.stringify(expected)))), expected);
});

test("manifest metadata shares the map parsing budget without losing the exact boundary", async () => {
  for (const type of ["map", "workspace"]) {
    const zip = new JSZip();
    const manifest = { format: "mini-mindmap", version: 2, type, active: 0, maps: ["maps/1.json"],
      padding: Array(MAX_PARSE_CONTAINERS - (type === "workspace" ? 10 : 8)).fill({}) };
    zip.file("maps/1.json", JSON.stringify({ tree: { key: "root", text: "", children:
      ["a", "b"].map(key => ({ key, text: key, children: [] })) } }), { createFolders: false });
    zip.file("manifest.json", JSON.stringify(manifest));
    assert.equal(parseDocument(await readArchive(await zip.generateAsync({ type: "base64" }))).type, type);
    manifest.padding.push({});
    zip.file("manifest.json", JSON.stringify(manifest));
    await assert.rejects(readArchive(await zip.generateAsync({ type: "base64" })), /Invalid/);
  }
});

test("repeated edits and archive round trips preserve a large map", async () => {
  const tree = { key: "root", text: "root", children: Array.from({ length: 1000 }, (_, i) => ({ key: `n${i}`, text: `Topic ${i} 测试`, children: [] })) };
  let map = { format: "mini-mindmap", version: 2, type: "map", tree };
  for (let iteration = 0; iteration < 15; iteration++) {
    const index = (iteration * 67) % tree.children.length;
    map.tree.children[index].text = `Edited ${iteration} 中文`;
    map = parseDocument(await readArchive(await createArchive(JSON.stringify(map))));
    assert.equal(map.tree.children.length, 1000);
    for (let previous = 0; previous <= iteration; previous++) assert.equal(map.tree.children[(previous * 67) % 1000].text, `Edited ${previous} 中文`);
  }
});

test("large images survive saving and individual images are limited to 10 MB", async () => {
  const makeMap = size => ({ format: "mini-mindmap", version: 2, type: "map", tree: { key: "root", text: "image", children: [], image: { src: `data:image/png;base64,${Buffer.alloc(size, 42).toString("base64")}` } } });
  const original = makeMap(4 * 1024 * 1024);
  assert.deepEqual(parseDocument(await readArchive(await createArchive(JSON.stringify(original)))), original);
  await assert.rejects(createArchive(JSON.stringify(makeMap(10 * 1024 * 1024 + 1))), /10 MB/);
  const repeated = makeMap(4 * 1024 * 1024);
  repeated.tree.children = Array.from({ length: 4 }, (_, i) => ({ key: `n${i}`, text: "", children: [], image: repeated.tree.image }));
  assert.deepEqual(parseDocument(await readArchive(await createArchive(JSON.stringify(repeated)))), repeated);
});

test("workspace archive preserves maps, images, styles and connections", async () => {
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const tree = { key: "root", text: "中文", children: [{ key: "child", text: "picture", children: [], image: { src: image, caption: "caption" }, textStyle: { bold: true } }], relations: [{ relKey: "r", from: "root", to: "child", label: "link" }] };
  const original = { format: "mini-mindmap", version: 2, type: "workspace", active: 1, tabs: [{ tree }, { tree: { key: "other", text: "other", children: [], image: { src: image } } }] };
  const encoded = await createArchive(JSON.stringify(original));
  const zip = await JSZip.loadAsync(encoded, { base64: true });
  assert.deepEqual(Object.keys(zip.files).sort(), ["assets/1.png", "manifest.json", "maps/1.json", "maps/2.json"]);
  assert.match(await zip.file("maps/1.json").async("string"), /assets\/1.png/);
  assert.deepEqual(parseDocument(await readArchive(encoded)), original);
});

test("floating topics and notes survive archive round trips and share image assets", async () => {
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const original = { format: "mini-mindmap", version: 2, type: "map", tree: { key: "root", text: "Root", children: [] }, floatingTopics: [{ x: -150, y: 42, tree: { key: "free", text: "Independent", children: [{ key: "child", text: "image", children: [], image: { src: image } }] } }], floatingNotes: [{ key: "note", text: "Notes\n说明", x: 50, y: -22, textStyle: { bold: true, underline: true, size: 18, color: "#c45850" } }] };
  const archive = await createArchive(JSON.stringify(original));
  assert.deepEqual(parseDocument(await readArchive(archive)), original);
  assert.throws(() => parseDocument(JSON.stringify({ ...original, floatingNotes: [{ key: "root", text: "duplicate", x: 0, y: 0 }] })), /Invalid floating note/);
  assert.throws(() => parseDocument(JSON.stringify({ ...original, floatingTopics: [{ ...original.floatingTopics[0], x: 100001 }] })), /position/);
  assert.throws(() => parseDocument(JSON.stringify({ ...original, floatingNotes: [{ ...original.floatingNotes[0], textStyle: { size: 1000 } }] })), /style/);
});

test("archive rejects corrupt, unsupported and missing resources", async () => {
  const doc = { format: "mini-mindmap", version: 2, type: "map", tree: { key: "a", text: "root", children: [], image: { src: "data:image/png;base64,AAAA" } } };
  const encoded = await createArchive(JSON.stringify(doc));
  const bytes = Buffer.from(encoded, "base64");
  const marker = bytes.indexOf(Buffer.from("mini-mindmap"));
  assert.ok(marker >= 0);
  bytes[marker] ^= 1;
  await assert.rejects(readArchive(bytes.toString("base64")));
  const zip = await JSZip.loadAsync(encoded, { base64: true });
  zip.remove("assets/1.png");
  await assert.rejects(readArchive(await zip.generateAsync({ type: "base64", compression: "STORE" })));
  await assert.rejects(readArchive(encoded.slice(0, -24)));
  const compressed = new JSZip();
  compressed.file("manifest.json", "{}".repeat(300));
  await assert.rejects(readArchive(await compressed.generateAsync({ type: "base64", compression: "DEFLATE" })));
  const traversal = new JSZip();
  traversal.file("../manifest.json", "{}", { createFolders: false });
  await assert.rejects(readArchive(await traversal.generateAsync({ type: "base64", compression: "STORE" })));
  const future = await JSZip.loadAsync(encoded, { base64: true });
  future.file("manifest.json", JSON.stringify({ format: "mini-mindmap", version: 5, type: "map", active: 0, maps: ["maps/1.json"] }));
  await assert.rejects(readArchive(await future.generateAsync({ type: "base64", compression: "STORE" })));
});

test("archive rejects mismatched local names and Unicode name overrides", async () => {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({ format: "mini-mindmap", version: 2, type: "map", active: 0, maps: ["maps/10.json"] }));
  zip.file("maps/10.json", JSON.stringify({ tree: { key: "root", text: "", children: [], image: { src: "assets/1.png" } } }), { createFolders: false });
  zip.file("assets/1.png", Buffer.alloc(1024, 42), { createFolders: false });
  const original = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  assert.equal(parseDocument(await readArchive(original.toString("base64"))).tree.image.src.length > 1024, true);
  const streamed = await zip.generateAsync({ type: "base64", compression: "STORE", streamFiles: true });
  assert.equal(parseDocument(await readArchive(streamed)).tree.image.src.length > 1024, true);
  const forged = Buffer.from(original);
  const end = forged.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let offset = forged.readUInt32LE(end + 16);
  for (let i = 0; i < forged.readUInt16LE(end + 10); i++) {
    const nameLength = forged.readUInt16LE(offset + 28);
    const name = forged.toString("ascii", offset + 46, offset + 46 + nameLength);
    if (name === "maps/10.json") forged.write("assets/1.png", offset + 46, "ascii");
    if (name === "assets/1.png") forged.write("maps/10.json", offset + 46, "ascii");
    offset += 46 + nameLength + forged.readUInt16LE(offset + 30) + forged.readUInt16LE(offset + 32);
  }
  await assert.rejects(readArchive(forged.toString("base64")), /Invalid/);

  const central = original.readUInt32LE(end + 16);
  const extraAt = central + 46 + original.readUInt16LE(central + 28);
  const extra = Buffer.from([0x75, 0x70, 1, 0, 0]);
  const unicode = Buffer.concat([original.subarray(0, extraAt), extra, original.subarray(extraAt)]);
  unicode.writeUInt16LE(original.readUInt16LE(central + 30) + extra.length, central + 30);
  unicode.writeUInt32LE(original.readUInt32LE(end + 12) + extra.length, end + extra.length + 12);
  await assert.rejects(readArchive(unicode.toString("base64")), /Invalid/);
});

test("archive rejects excessive entry counts and expanded image references", async () => {
  const encoded = await createArchive(JSON.stringify({ format: "mini-mindmap", version: 2, type: "map", tree: { key: "root", text: "root", children: [] } }));
  const bytes = Buffer.from(encoded, "base64");
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  bytes.writeUInt16LE(10001, end + 8);
  bytes.writeUInt16LE(10001, end + 10);
  await assert.rejects(readArchive(bytes.toString("base64")), /10000 entry/);

  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify({ format: "mini-mindmap", version: 2, type: "map", active: 0, maps: ["maps/1.json"] }));
  zip.file("maps/1.json", JSON.stringify({ tree: { key: "root", text: "root", children: Array.from({ length: 193 }, (_, i) => ({ key: String(i), text: "", children: [], image: { src: "assets/1.png" } })) } }), { createFolders: false });
  zip.file("assets/1.png", Buffer.alloc(1024 * 1024), { createFolders: false });
  await assert.rejects(readArchive(await zip.generateAsync({ type: "base64", compression: "STORE" })), /256 MB/);
});
