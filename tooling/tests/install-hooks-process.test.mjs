import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const backend = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === 'backend';
const expected = backend ? '.husky/_' : '.githooks';

function fixture(run, initialize = true) {
  const directory = mkdtempSync(join(tmpdir(), 'resdigital-hooks-'));
  const config = join(directory, 'global.gitconfig');
  writeFileSync(config, '');
  const env = { ...process.env, HUSKY: '1', GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT']) delete env[key];
  const git = (args) => execFileSync('git', args, { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const install = () => spawnSync(process.execPath, [join(directory, 'tooling/install-hooks.mjs')], { cwd: directory, env, encoding: 'utf8' });
  try {
    mkdirSync(join(directory, 'tooling'));
    copyFileSync(join(root, 'tooling/install-hooks.mjs'), join(directory, 'tooling/install-hooks.mjs'));
    if (backend) {
      mkdirSync(join(directory, 'node_modules'));
      const husky = realpathSync(process.env.HUSKY_PACKAGE_PATH ?? join(root, 'node_modules/husky'));
      mkdirSync(join(directory, 'node_modules/husky'));
      for (const file of readdirSync(husky, { withFileTypes: true })) {
        if (file.isFile()) copyFileSync(join(husky, file.name), join(directory, 'node_modules/husky', file.name));
      }
    }
    if (initialize) git(['init', '--quiet']);
    run({ directory, config, git, install });
  } finally {
    const target = realpathSync(directory);
    assert.ok(target.startsWith(realpathSync(tmpdir()) + sep) && target.includes('resdigital-hooks-'));
    rmSync(target, { recursive: true, force: true });
  }
}

test('fresh clone installs hooks and repeated installation preserves index', () => fixture(({ directory, git, install }) => {
  const before = git(['write-tree']);
  const first = install();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(git(['config', '--local', '--get', 'core.hooksPath']), expected);
  if (backend) assert.equal(existsSync(join(directory, '.husky/_/h')), true);
  const second = install();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(git(['write-tree']), before);
}));

test('installer refuses an existing local custom path', () => fixture(({ git, install }) => {
  git(['config', '--local', 'core.hooksPath', 'custom-hooks']);
  assert.notEqual(install().status, 0);
  assert.equal(git(['config', '--get', 'core.hooksPath']), 'custom-hooks');
}));

test('installer refuses a global custom path when local config is absent', () => fixture(({ config, git, install }) => {
  writeFileSync(config, '[core]\n\thooksPath = custom-global-hooks\n');
  assert.notEqual(install().status, 0);
  assert.equal(git(['config', '--get', 'core.hooksPath']), 'custom-global-hooks');
}));

test('Git errors propagate rather than installing outside a repository', () => fixture(({ directory, install }) => {
  assert.notEqual(install().status, 0);
  assert.equal(existsSync(join(directory, '.git')), false);
}, false));
