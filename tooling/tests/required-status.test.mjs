import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { failedRequiredJobs } from '../required-status.mjs';

test('required status depends on CI jobs rather than the pull request author', () => {
  const jobs = Object.fromEntries(['policy', 'secrets', 'dependencies', 'quality', 'migration-replay', 'workflow-lint'].map((name) => [name, { result: 'success' }]));
  for (const author of ['crissXcoder', 'DannyOr94', 'dependabot[bot]', 'other-user']) {
    for (const result of ['success', 'failure', 'skipped', 'cancelled', undefined]) {
      const run = spawnSync(process.execPath, [fileURLToPath(new URL('../required-status.mjs', import.meta.url))], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', PR_AUTHOR: author, JOBS: JSON.stringify({ ...jobs, quality: result ? { result } : undefined }) },
      });
      assert.equal(run.error, undefined);
      assert.equal(run.status, result === 'success' ? 0 : 1, `${author}: ${result}: ${run.stderr}`);
    }
  }
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
