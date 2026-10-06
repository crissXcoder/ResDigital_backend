import assert from 'node:assert/strict';
import test from 'node:test';
import { failedRequiredJobs, isMergeEligibleAuthor } from '../required-status.mjs';

test('merge eligibility permits only Cristhian, Karla and Ari as PR authors', () => {
  assert.equal(isMergeEligibleAuthor('crissXcoder'), true);
  assert.equal(isMergeEligibleAuthor('KarlaAnguloC'), true);
  assert.equal(isMergeEligibleAuthor('AriiH08'), true);
  assert.equal(isMergeEligibleAuthor('DannyOr94'), false);
  assert.equal(isMergeEligibleAuthor('other-user'), false);
});

test('required status rejects failed, skipped, cancelled and missing jobs', () => {
  const jobs = {
    policy: { result: 'success' },
    secrets: { result: 'failure' },
    dependencies: { result: 'skipped' },
    quality: { result: 'cancelled' },
  };
  assert.deepEqual(failedRequiredJobs(jobs), ['secrets', 'dependencies', 'quality', 'migration-replay', 'workflow-lint']);
});

test('required status passes only when every required job succeeds', () => {
  const jobs = Object.fromEntries(['policy', 'secrets', 'dependencies', 'quality', 'migration-replay', 'workflow-lint'].map((name) => [name, { result: 'success' }]));
  assert.deepEqual(failedRequiredJobs(jobs), []);
});
