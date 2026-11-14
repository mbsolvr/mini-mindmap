import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkParseBudget, MAX_PARSE_CONTAINERS } from '../src/parseBudget.ts';

test('JSON budget counts containers across entries and ignores punctuation in notes', () => {
  const budget = { count: MAX_PARSE_CONTAINERS - 2 };
  checkParseBudget(JSON.stringify({ notes: 'Brackets [ ] { }, quotes " and backslash \\' }), false, budget);
  assert.equal(budget.count, MAX_PARSE_CONTAINERS - 1);
  checkParseBudget('[]', false, budget);
  assert.equal(budget.count, MAX_PARSE_CONTAINERS);
  assert.throws(() => checkParseBudget('{}', false, budget), /structure/);
});

test('XML content and styles share a markup budget', () => {
  const budget = { count: MAX_PARSE_CONTAINERS - 2 };
  checkParseBudget('<title>Notes</title>', true, budget);
  assert.equal(budget.count, MAX_PARSE_CONTAINERS);
  assert.throws(() => checkParseBudget('<styles/>', true, budget), /structure/);
});
