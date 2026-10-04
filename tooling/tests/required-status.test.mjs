import assert from 'node:assert/strict';
import test from 'node:test';
import { failedRequiredJobs } from '../required-status.mjs';

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
