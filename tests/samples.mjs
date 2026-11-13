// Deterministic samples shared by contract and performance tests.
export const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR7AAAAAASUVORK5CYII=';
export function wideMap(count) {
  if (!Number.isInteger(count) || count < 1 || count > 5000) throw new RangeError('node count must be 1–5000');
  return { tree: { key: 'root', text: '中心 🌱', children: Array.from({ length: count - 1 }, (_, i) => ({ key: `n${i}`, text: `节点 ${i} & <test>`, children: [] })) } };
}
export function deepMap(depth) {
  let tree = { key: `d${depth}`, text: `level ${depth}`, children: [] };
  for (let i = depth - 1; i >= 0; i--) tree = { key: `d${i}`, text: `level ${i}`, children: [tree] };
  return { tree };
}
export function richWorkspace() {
  return { format: 'mini-mindmap', version: 2, type: 'workspace', active: 1, tabs: [
    { tree: { key: 'r1', text: '中文 🌱', tabTitle: 'Notes', layout: 'mindmap', template: 'default', children: [
      { key: 'a', text: 'https://example.com/a', children: [], side: 'left', image: { src: image, caption: '图' }, textStyle: { bold: true, color: '#c45850', size: 13 } },
      { key: 'b', text: '折叠\nline', collapsed: true, children: [{ key: 'c', text: 'hidden', children: [] }] }
    ], relations: [{ relKey: 'rel', from: 'c', to: 'f', label: '跨树' }] },
      floatingTopics: [{ x: -123.5, y: 456, tree: { key: 'f', text: 'independent', children: [] } }],
      floatingNotes: [{ key: 'note', x: 12, y: -42, text: '说明\nNote', textStyle: { underline: true, size: 10 } }] },
    { tree: { key: 'r2', text: 'Second', template: 'midnight', children: [{ key: 'p', text: '', children: [], image: { src: image } }] } }
  ] };
}
