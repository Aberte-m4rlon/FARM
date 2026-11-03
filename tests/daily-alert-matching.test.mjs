import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/dailyAlertMatching.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { matchDailyAlertsWithReadState } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);

test('matches read state by alert title/type with a single indexed notification pass', () => {
  const alerts = [
    { id: 'one', type: 'Weight', title: 'Timbangin si Maya', description: '', priority: 'Normal', dueLabel: '', link: '' },
    { id: 'two', type: 'Vaccination', title: 'Bakuna ni Bituin', description: '', priority: 'Warning', dueLabel: '', link: '' },
  ];
  const notifications = [
    { id: 'n1', type: 'weight', title: 'Timbangin si Maya', read: true, is_read: false },
    { id: 'n2', type: 'Vaccination', title: 'Bakuna ni Bituin', read: false, is_read: true },
  ];

  const result = matchDailyAlertsWithReadState(alerts, notifications);
  assert.deepEqual(result.map((alert) => alert.isRead), [true, true]);
  assert.equal(result[0].matchingNotif.id, 'n1');
  assert.equal(result[1].matchingNotif.id, 'n2');
});

test('keeps large alert lists matchable without quadratic notification searches', () => {
  const alerts = Array.from({ length: 15_000 }, (_, index) => ({
    id: String(index), type: 'Weight', title: `Alert ${index}`, description: '', priority: 'Normal', dueLabel: '', link: '',
  }));
  const notifications = alerts.slice(14_000).map((alert, index) => ({
    id: `n${index}`, type: alert.type, title: alert.title, read: true, is_read: true,
  }));
  const result = matchDailyAlertsWithReadState(alerts, notifications);
  assert.equal(result.length, 15_000);
  assert.equal(result[0].isRead, false);
  assert.equal(result[14_999].isRead, true);
});
