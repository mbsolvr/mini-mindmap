import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

test('workflows do not persist checkout credentials', async () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  for (const name of await readdir(directory)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const source = await readFile(new URL(name, directory), 'utf8');
    const actions = [...source.matchAll(/^\s*- uses: (\S+)(?:[^\n]*)/gm)];
    assert.ok(actions.length);
    for (const action of actions) {
      if (action[1].startsWith('actions/checkout@'))
        assert.match(source.slice(action.index + action[0].length), /^\n\s+with:\n\s+persist-credentials: false/);
    }
  }
});
