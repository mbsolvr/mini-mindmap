import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createXmind, readXmind } from '../src/xmind.ts';
import { createArchive, readArchive } from '../src/archive.ts';
import { richWorkspace, image, wideMap, deepMap } from './samples.mjs';

async function encode(sheets, resources = {}, options = {}) {
  const zip = new JSZip();
  zip.file('content.json', JSON.stringify(sheets));
  for (const [path, data] of Object.entries(resources)) zip.file(path, data, { createFolders: false });
  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE', ...options });
}

test('100 sheets import and save normally; a 101st sheet is rejected', async () => {
  const sheets = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, rootTopic: { id: 'root', title: `Sheet ${i}` } }));
  const { workspace } = await readXmind(await encode(sheets));
  assert.equal(workspace.tabs.length, 100);
  assert.deepEqual(JSON.parse(await readArchive(await createArchive(JSON.stringify(workspace)))), workspace);
  sheets.push({ id: 'extra', rootTopic: { id: 'root', title: 'Extra' } });
  await assert.rejects(readXmind(await encode(sheets)), /100 tabs/);
});

test('10 connections round trip; an 11th connection is rejected on import and export', async () => {
  const sheet = { rootTopic: { id: 'root', title: 'Root', children: { attached:
    Array.from({ length: 11 }, (_, i) => ({ id: `n${i}`, title: `Topic ${i}` })) } },
    relationships: Array.from({ length: 10 }, (_, i) => ({ id: `rel${i}`, end1Id: 'root', end2Id: `n${i}`, title: '' })) };
  const { workspace } = await readXmind(await encode([sheet]));
  assert.equal(workspace.tabs[0].tree.relations.length, 10);
  assert.deepEqual((await readXmind((await createXmind(workspace)).contents)).workspace, workspace);
  sheet.relationships.push({ id: 'extra', end1Id: 'root', end2Id: 'n10', title: '' });
  await assert.rejects(readXmind(await encode([sheet])), /10 connections/);
  workspace.tabs[0].tree.relations.push({ relKey: 'extra', from: 'root', to: 'n10', label: '' });
  await assert.rejects(createXmind(workspace), /10 connections/);
  await assert.rejects(createArchive(JSON.stringify(workspace)), /10 connections/);
});

test('independent topics retain their full 100-level depth on round trip', async () => {
  const workspace = { format: 'mini-mindmap', version: 2, type: 'workspace', active: 0,
    tabs: [{ tree: { key: 'root', text: 'Root', children: [] }, floatingTopics: [{ x: 200, y: 0, tree: deepMap(100).tree }] }] };
  assert.deepEqual((await readXmind((await createXmind(workspace)).contents)).workspace, workspace);
});

test('export keeps web links and reports unsupported file links as limited', async () => {
  const workspace = { format: 'mini-mindmap', version: 2, type: 'workspace', active: 0,
    tabs: [{ tree: { key: 'root', text: 'Notes', link: { url: 'file:///tmp/notes.md' }, children: [
      { key: 'http', text: 'HTTP', children: [], link: { url: 'http://example.com', label: 'Example' } },
      { key: 'https', text: 'HTTPS', children: [], link: { url: 'https://example.com' } },
    ] } }] };
  const exported = await createXmind(workspace);
  assert.equal(exported.limited, true);
  const zip = await JSZip.loadAsync(exported.contents, { base64: true });
  assert.equal(JSON.parse(await zip.file('content.json').async('string'))[0].rootTopic.href, undefined);
  const { workspace: restored } = await readXmind(exported.contents);
  assert.equal(restored.tabs[0].tree.link, undefined);
  assert.deepEqual(restored.tabs[0].tree.children, workspace.tabs[0].tree.children);
  assert.equal(workspace.tabs[0].tree.link.url, 'file:///tmp/notes.md');
});

test('all sheets, shared images and native fields survive XMind and minimap round trips', async () => {
  const workspace = richWorkspace();
  Object.assign(workspace.tabs[0].tree, { collapsed: false, notes: '备注\nplain text', labels: ['tag', '中文'] });
  workspace.tabs[0].tree.children[0].link = { url: 'https://example.com/', label: 'Example' };
  workspace.tabs[0].tree.relations[0].controls = { start: { x: 20, y: -40 }, end: { x: -60, y: 10 } };
  const original = structuredClone(workspace);
  const { contents, limited } = await createXmind(workspace);
  assert.equal(limited, true, 'custom curves need a visible interoperability warning');
  const zip = await JSZip.loadAsync(contents, { base64: true, checkCRC32: true });
  assert.equal(Object.keys(zip.files).filter(path => path.startsWith('resources/')).length, 1);
  const sheets = JSON.parse(await zip.file('content.json').async('string'));
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].rootTopic.image, undefined);
  assert.equal(sheets[0].rootTopic.children.attached.find(topic => topic.id === 'a').image.src, 'xap:resources/1.png');
  assert.equal(sheets[0].relationships[0].end2Id, 'f');
  assert.deepEqual((await readXmind(contents)).workspace, original);
  const native = await createArchive(JSON.stringify((await readXmind(contents)).workspace));
  assert.deepEqual(JSON.parse(await readArchive(native)), original);
  assert.deepEqual(workspace, original, 'export must not mutate the workspace');
});

test('imports external JSON with multiple sheets, floating topics, styles, links and summaries', async () => {
  const rootTopic = { id: 'r', title: '中心 🌱', structureClass: 'org.xmind.ui.logic.right',
    children: { attached: [
      { id: 'a', title: 'A', branch: 'folded', href: 'https://example.com', notes: { plain: { content: '备注' } }, labels: ['tag'], image: { src: 'xap:resources/图.png' },
        style: { properties: { 'fo:font-weight': '700', 'fo:font-size': '18pt', 'fo:color': '#123456', 'fo:text-decoration': 'underline', 'fo:font-style': 'italic' } } },
      { id: 'b', title: 'B', image: { src: 'xap:resources/no-extension' } } ], summary: [{ id: 's', title: '概要', children: { attached: [{ id: 'sc', title: 'detail' }] } }],
      detached: [{ id: 'f', title: 'Floating', position: { x: -123.5, y: 42 } }] },
    summaries: [{ id: 'sum', topicId: 's', range: '(0,1)' }] };
  const contents = await encode([{ id: 'one', title: 'First sheet', rootTopic, relationships: [{ id: 'rel', end1Id: 'a', end2Id: 'f', title: 'connect' }] },
    { id: 'two', title: 'Second sheet', rootTopic: { id: 'r', title: 'Second' } }], {
      'resources/图.png': Buffer.from(image.split(',')[1], 'base64'),
      'resources/no-extension': Buffer.from(image.split(',')[1], 'base64'),
    });
  const { workspace, limited } = await readXmind(contents);
  assert.equal(limited, false);
  assert.equal(workspace.tabs.length, 2);
  const map = workspace.tabs[0], node = map.tree.children[0];
  assert.equal(map.tree.tabTitle, 'First sheet');
  assert.equal(map.tree.layout, 'logic');
  assert.deepEqual(map.tree.summaries, [{ key: 's', topics: ['a', 'b'] }]);
  assert.equal(map.tree.children[2].children[0].text, 'detail');
  assert.deepEqual(node.textStyle, { bold: true, italic: true, underline: true, size: 18, color: '#123456' });
  assert.equal(node.image.src, image);
  assert.equal(map.tree.children[1].image.src, image);
  assert.equal(node.notes, '备注');
  assert.deepEqual(node.labels, ['tag']);
  assert.deepEqual(map.floatingTopics[0], { x: -123.5, y: 42, tree: { key: 'f', text: 'Floating', children: [], side: 'left' } });
  assert.deepEqual((await readXmind((await createXmind(workspace)).contents)).workspace, workspace);
});

test('exports standard summary ranges and preserves arbitrary native summary membership and child order', async () => {
  const node = key => ({ key, text: key, children: [] });
  const map = { tree: { ...node('r'), layout: 'logic', children: [node('s'), node('a'), node('b')], summaries: [{ key: 's', topics: ['a', 'b'] }] } };
  const workspace = { format: 'mini-mindmap', version: 2, type: 'workspace', active: 0, tabs: [map] };
  const exported = await createXmind(workspace);
  assert.equal(exported.limited, false);
  const zip = await JSZip.loadAsync(exported.contents, { base64: true });
  const [sheet] = JSON.parse(await zip.file('content.json').async('string'));
  assert.equal(sheet.rootTopic.summaries[0].range, '(0,1)');
  assert.equal(sheet.rootTopic.children.summary[0].id, 's');
  assert.deepEqual((await readXmind(exported.contents)).workspace, workspace);
  map.floatingTopics = [{ x: 0, y: 0, tree: node('f') }];
  map.tree.summaries[0].topics = ['a', 'f'];
  const crossTree = await createXmind(workspace);
  assert.equal(crossTree.limited, true);
  assert.deepEqual((await readXmind(crossTree.contents)).workspace, workspace);
});

test('compressed text is compact and 5000 topics import without changing their IDs', async () => {
  const workspace = { format: 'mini-mindmap', version: 2, type: 'workspace', active: 0, tabs: [wideMap(5000)] };
  const { contents } = await createXmind(workspace);
  assert.ok(Buffer.from(contents, 'base64').length < JSON.stringify(workspace).length / 2);
  assert.deepEqual((await readXmind(contents)).workspace, workspace);
});

test('unbalanced maps use XMind branch ordering and restore native child order', async () => {
  const node = (key, side) => ({ key, text: key, children: [], ...(side ? { side } : {}) });
  const workspace = { format: 'mini-mindmap', version: 2, type: 'workspace', active: 0,
    tabs: [{ tree: { ...node('r'), children: [node('left', 'left'), node('right', 'right')] } }] };
  const { contents } = await createXmind(workspace);
  const zip = await JSZip.loadAsync(contents, { base64: true });
  const sheets = JSON.parse(await zip.file('content.json').async('string'));
  assert.deepEqual(sheets[0].rootTopic.children.attached.map(topic => topic.id), ['right', 'left']);
  assert.equal(sheets[0].rootTopic.extensions[0].content[0].content, '1');
  assert.deepEqual((await readXmind(contents)).workspace, workspace);
  delete sheets[0]['mini-mindmap'];
  delete sheets[0].rootTopic['mini-mindmap'];
  for (const child of sheets[0].rootTopic.children.attached) { delete child['mini-mindmap']; delete child.position; }
  const imported = await readXmind(await encode(sheets));
  assert.deepEqual(imported.workspace.tabs[0].tree.children.map(topic => topic.side), ['right', 'left']);
});

test('summary ranges account for summary titles that remain ordinary XMind topics', async () => {
  const node = key => ({ key, text: key, children: [] });
  const workspace = { format: 'mini-mindmap', version: 2, type: 'workspace', active: 0, tabs: [{
    tree: { ...node('r'), layout: 'logic', children: [node('cross-summary'), node('a'), node('b'), node('summary'), node('c')],
      summaries: [{ key: 'cross-summary', topics: ['c', 'floating'] }, { key: 'summary', topics: ['a', 'b'] }] },
    floatingTopics: [{ x: 0, y: 0, tree: node('floating') }],
  }] };
  const { contents } = await createXmind(workspace);
  const zip = await JSZip.loadAsync(contents, { base64: true });
  const [sheet] = JSON.parse(await zip.file('content.json').async('string'));
  assert.equal(sheet.rootTopic.summaries[0].range, '(1,2)');
  assert.deepEqual((await readXmind(contents)).workspace, workspace);
});

test('malformed or unsafe XMind data and missing resources fail before import', async () => {
  const root = { id: 'r', title: 'Root' };
  for (const sheets of [[], {}, [{ rootTopic: null }], [{ rootTopic: { ...root, children: { attached: [{ id: 'r' }] } } }],
    [{ rootTopic: { ...root, children: { attached: 'bad' } } }], [{ rootTopic: { ...root, image: { src: 'https://example.com/image.png' } } }],
    [{ rootTopic: { ...root, image: { src: 'xap:resources/missing.png' } } }],
    [{ rootTopic: root, relationships: [{ id: 'rel', end1Id: 'r', end2Id: 'missing' }] }]]) {
    await assert.rejects(readXmind(await encode(sheets)));
  }
  for (const path of ['../content.json', '/content.json', 'resources/../content.json', 'resources\\bad.png']) {
    const zip = new JSZip();
    zip.file(path, '[]', { createFolders: false });
    await assert.rejects(readXmind(await zip.generateAsync({ type: 'base64' })));
  }
  let nested = root;
  for (let i = 0; i < 102; i++) nested = { id: String(i), children: { attached: [nested] } };
  await assert.rejects(readXmind(await encode([{ rootTopic: nested }])), /100 levels/);
  const unsupported = await readXmind(await encode([{ rootTopic: { ...root, href: 'file:///etc/passwd', markers: [{}] } }]));
  assert.equal(unsupported.limited, true);
  assert.equal(unsupported.workspace.tabs[0].tree.link, undefined);
});

test('ZIP limits and CRC checks reject corrupt and forged compressed entries', async () => {
  const original = Buffer.from(await encode([{ rootTopic: { id: 'r', title: 'Root'.repeat(2000) } }]), 'base64');
  const end = original.length - 22, central = original.readUInt32LE(end + 16);
  const crc = Buffer.from(original);
  crc.writeUInt32LE(0, 14);
  crc.writeUInt32LE(0, central + 16);
  await assert.rejects(readXmind(crc.toString('base64')), /Invalid/);
  const bomb = Buffer.from(original);
  bomb.writeUInt32LE(1, 22);
  bomb.writeUInt32LE(1, central + 24);
  await assert.rejects(readXmind(bomb.toString('base64')), /256 MB/);
  const huge = Buffer.from(original);
  huge.writeUInt32LE(300 * 1024 * 1024, 22);
  huge.writeUInt32LE(300 * 1024 * 1024, central + 24);
  await assert.rejects(readXmind(huge.toString('base64')), /256 MB/);
  const tooMany = Buffer.from(original);
  tooMany.writeUInt16LE(10001, end + 8); tooMany.writeUInt16LE(10001, end + 10);
  await assert.rejects(readXmind(tooMany.toString('base64')), /10000 entry/);
});

test('shared image references cannot bypass the expanded document budget or per-image limit', async () => {
  const rootTopic = { id: 'r', title: '', children: { attached: Array.from({ length: 193 }, (_, index) => ({ id: `n${index}`, image: { src: 'xap:resources/shared.png' } })) } };
  const contents = await encode([{ rootTopic }], { 'resources/shared.png': Buffer.alloc(1024 * 1024) });
  await assert.rejects(readXmind(contents), /256 MB/);
  const largeImage = await encode([{ rootTopic: { id: 'r', image: { src: 'xap:attachments/large.png' } } }], { 'attachments/large.png': Buffer.alloc(10 * 1024 * 1024 + 1) });
  await assert.rejects(readXmind(largeImage), /Image exceeds 10 MB/);
});
