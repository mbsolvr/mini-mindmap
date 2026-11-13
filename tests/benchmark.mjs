import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { createArchive, readArchive } from '../src/archive.ts';
import { parseDocument, updateNode } from '../src/model.ts';
import { wideMap, richWorkspace } from './samples.mjs';

const iterations = Number(process.env.MINIMAP_BENCH_ITERATIONS || 7);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) throw Error('MINIMAP_BENCH_ITERATIONS must be 1–100');
async function measure(fn) {
  await fn();
  const values = [];
  for (let i = 0; i < iterations; i++) { const start = performance.now(); await fn(); values.push(performance.now() - start); }
  values.sort((a, b) => a - b);
  return { median_ms: +values[Math.floor(values.length / 2)].toFixed(2), max_ms: +values.at(-1).toFixed(2) };
}
const results = [];
for (const count of [100, 1000, 5000]) {
  const map = wideMap(count), input = JSON.stringify({ format: 'mini-mindmap', version: 2, type: 'map', ...map });
  const archive = await createArchive(input);
  results.push({ scenario: `wide-${count}`, nodes: count, archive_bytes: Buffer.byteLength(archive, 'base64'),
    edit: await measure(() => updateNode(map.tree, `n${count - 2}`, node => ({ ...node, text: 'changed' }))),
    encode: await measure(() => createArchive(input)), decode: await measure(async () => parseDocument(await readArchive(archive))) });
}
const workspace = JSON.stringify(richWorkspace());
const workspaceArchive = await createArchive(workspace);
results.push({ scenario: 'rich-workspace', encode: await measure(() => createArchive(workspace)), decode: await measure(async () => parseDocument(await readArchive(workspaceArchive))) });
const report = { schema: 1, timestamp: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, iterations, rss_mib: +(process.memoryUsage().rss / 1048576).toFixed(1), results };
if (process.argv.length > 2) {
  if (process.argv.length !== 4 || process.argv[2] !== '--baseline') throw Error('Usage: node tests/benchmark.mjs [--baseline report.json]');
  const baseline = JSON.parse(await readFile(process.argv[3], 'utf8'));
  if (baseline.schema !== 1 || !Array.isArray(baseline.results)) throw Error('Invalid benchmark baseline');
  report.comparison = results.map(current => {
    const old = baseline.results.find(item => item.scenario === current.scenario);
    const ratios = {};
    for (const metric of ['edit', 'encode', 'decode']) if (current[metric] && old?.[metric]?.median_ms > 0) ratios[metric] = +(current[metric].median_ms / old[metric].median_ms).toFixed(2);
    return { scenario: current.scenario, median_ratio: ratios };
  });
}
console.log(JSON.stringify(report, null, 2));
