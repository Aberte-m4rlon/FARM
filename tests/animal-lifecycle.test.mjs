import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/animalLifecycle.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const lifecycleModule = { exports: {} };
new Function('module', 'exports', compiled)(lifecycleModule, lifecycleModule.exports);
const { isAnimalActive, isAnimalDeceased } = lifecycleModule.exports;

test('the active animal check handles normalized and legacy lifecycle values consistently', () => {
  assert.equal(isAnimalActive({ status: null }), true);
  assert.equal(isAnimalActive({ status: 'Active' }), true);
  assert.equal(isAnimalActive({ status: 'active' }), true);
  assert.equal(isAnimalActive({ status: 'SOLD' }), false);
  assert.equal(isAnimalActive({ status: 'deceased' }), false);
  assert.equal(isAnimalActive({ status: 'Transferred' }), false);
  assert.equal(isAnimalActive({ status: 'Archived' }), false);
  assert.equal(isAnimalActive({ status: 'Active', archived: true }), false);
  assert.equal(isAnimalActive({ status: 'Active', is_sold: true }), false);
});

test('deceased status matching is case-insensitive', () => {
  assert.equal(isAnimalDeceased({ status: 'Deceased' }), true);
  assert.equal(isAnimalDeceased({ status: 'DECEASED' }), true);
  assert.equal(isAnimalDeceased({ status: 'Active' }), false);
});
