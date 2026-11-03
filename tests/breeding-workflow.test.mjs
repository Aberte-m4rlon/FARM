import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/breedingWorkflow.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { isBreedingDue, localDateKey } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);

test('compares a due date to the farm local calendar date', () => {
  assert.equal(localDateKey(new Date(2026, 9, 8)), '2026-10-08');
  assert.equal(isBreedingDue('Pregnant', '2026-10-08', '2026-10-08'), true);
  assert.equal(isBreedingDue('Pregnant', '2026-10-07', '2026-10-08'), true);
  assert.equal(isBreedingDue('Pregnant', '2026-10-09', '2026-10-08'), false);
});

test('only active pregnancy records with an expected date are due', () => {
  assert.equal(isBreedingDue('Kidded', '2026-10-07', '2026-10-08'), false);
  assert.equal(isBreedingDue('Failed', '2026-10-07', '2026-10-08'), false);
  assert.equal(isBreedingDue('Pregnant', null, '2026-10-08'), false);
  assert.equal(isBreedingDue('Pregnant', undefined, '2026-10-08'), false);
});
