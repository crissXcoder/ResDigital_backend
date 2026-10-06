import test from 'node:test';
import assert from 'node:assert/strict';
import { hasOnlyFullShaPinnedActions, isForbiddenMigrationChange, validatePullRequest, validateTag, requiredCheckName, requiredCheckPassed } from '../git-policy.mjs';
import { resolveScanRange } from '../security-tools.mjs';
const base = '1'.repeat(40);
const head = '2'.repeat(40);

test('release check follows package identity after repository renames', () => {
  assert.equal(requiredCheckName('frontend'), 'Frontend required');
  assert.equal(requiredCheckName('backend'), 'Backend required');
  assert.throws(() => requiredCheckName('other'), /paquete/);
});

test('release refuses a spoofed check and a newer failed rerun', () => {
  const success = { id: 10, name: 'Backend required', status: 'completed', conclusion: 'success', app: { id: 15368 } };
  assert.equal(requiredCheckPassed([success], 'Backend required'), true);
  assert.equal(requiredCheckPassed([{ ...success, app: { id: 1 } }], 'Backend required'), false);
  assert.equal(requiredCheckPassed([success, { ...success, id: 11, conclusion: 'failure' }], 'Backend required'), false);
  assert.equal(requiredCheckPassed([{ ...success, conclusion: 'skipped' }], 'Backend required'), false);
  assert.equal(requiredCheckPassed([], 'Backend required'), false);
});
test('accepts an infrastructure PR with verifiable criteria', () => assert.deepEqual(validatePullRequest({ pull_request: { title: 'chore(ci): protect ResDigital branches', body: '## Tarea y objetivo\nInfraestructura: controles CI\n\n## Criterios de aceptación\n- El gate falla al faltar checks.' } }), []));
test('rejects missing structure and task context', () => assert.equal(validatePullRequest({ pull_request: { title: 'Dev', body: 'Cambio' } }).length, 5));
test('requires release tag to match manifest', () => assert.match(validateTag('v1.2.4', '1.2.3'), /package\.json/));
test('rejects non-release tags', () => assert.match(validateTag('dev', '0.0.1'), /v<major>/));
test('requires full action SHAs even when version comments are present', () => {
  assert.equal(hasOnlyFullShaPinnedActions('      uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # v5'), true);
  assert.equal(hasOnlyFullShaPinnedActions('      uses: actions/checkout@v5 # floating tag'), false);
});
test('permits new migration but blocks editing, deleting and renaming an existing one', () => {
  assert.equal(isForbiddenMigrationChange('A\tsrc/database/migrations/20261003000000-New.ts'), false);
  assert.equal(isForbiddenMigrationChange('M\tsrc/database/migrations/Old.ts'), true);
  assert.equal(isForbiddenMigrationChange('D\tsrc/database/migrations/Old.ts'), true);
  assert.equal(isForbiddenMigrationChange('R100\tsrc/database/migrations/Old.ts\tsrc/database/migrations/Renamed.ts'), true);
  assert.equal(isForbiddenMigrationChange('M\tsrc/features/animals/service.ts'), false);
});
test('PR secret scan uses complete base-to-head commit range', () => assert.equal(resolveScanRange({ pull_request: { base: { sha: base }, head: { sha: head } } }, 'pull_request'), `${base}..${head}`));
test('push scan fails closed without a valid previous commit', () => {
  assert.equal(resolveScanRange({ before: base, after: head }, 'push'), `${base}..${head}`);
  assert.throws(() => resolveScanRange({ before: '0'.repeat(40), after: head }, 'push'), /rango Git verificable/);
});
test('manual scan requires two exact commits', () => {
  assert.equal(resolveScanRange({}, 'workflow_dispatch', [base, head]), `${base}..${head}`);
  assert.throws(() => resolveScanRange({}, 'workflow_dispatch'), /rango Git verificable/);
});
