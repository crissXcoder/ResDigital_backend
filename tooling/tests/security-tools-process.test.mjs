import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const source = resolve(fileURLToPath(new URL('../security-tools.mjs', import.meta.url)));

test('Gitleaks fails closed and removes an incomplete download without changing the Git index', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'resdigital-security-tools-'));
  t.after(() => {
    const target = realpathSync(directory);
    const allowed = realpathSync(tmpdir()) + sep;
    assert.ok(target.startsWith(allowed));
    assert.match(basename(target), /^resdigital-security-tools-/);
    rmSync(target, { recursive: true, force: true });
  });

  mkdirSync(join(directory, 'tooling'), { recursive: true });
  copyFileSync(source, join(directory, 'tooling', 'security-tools.mjs'));
  writeFileSync(join(directory, 'fixture.txt'), 'isolated staged fixture\n');
  writeFileSync(join(directory, 'network-failure.mjs'), `
    const responses = [
      new Response('incomplete archive', { status: 200 }),
      new Response('checksum service unavailable', { status: 503 }),
    ];
    globalThis.fetch = async () => responses.shift();
  `);
  writeFileSync(join(directory, 'global.gitconfig'), '');

  const git = (args) => spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  assert.equal(git(['init', '--quiet']).status, 0);
  assert.equal(git(['add', 'fixture.txt']).status, 0);
  const treeBefore = git(['write-tree']);
  assert.equal(treeBefore.status, 0, treeBefore.stderr);

  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(directory, 'global.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT']) delete env[key];
  const result = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(join(directory, 'network-failure.mjs')).href, join(directory, 'tooling', 'security-tools.mjs'), 'gitleaks-protect'],
    { cwd: directory, env, encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /checksums oficiales/);
  const cache = join(directory, '.git', '.codex-tools', '8.27.2');
  assert.ok(!existsSync(cache) || !readdirSync(cache).some((file) => file.endsWith('.archive')));
  const treeAfter = git(['write-tree']);
  assert.equal(treeAfter.status, 0, treeAfter.stderr);
  assert.equal(treeAfter.stdout, treeBefore.stdout);
});

test('Gitleaks rejects an archive and official checksum changed together', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'resdigital-security-pin-'));
  t.after(() => {
    const target = realpathSync(directory);
    const allowed = realpathSync(tmpdir()) + sep;
    assert.ok(target.startsWith(allowed));
    assert.match(basename(target), /^resdigital-security-pin-/);
    rmSync(target, { recursive: true, force: true });
  });

  mkdirSync(join(directory, 'tooling'), { recursive: true });
  copyFileSync(source, join(directory, 'tooling', 'security-tools.mjs'));
  writeFileSync(join(directory, 'fixture.txt'), 'isolated staged fixture\n');
  writeFileSync(join(directory, 'tampered-release.mjs'), `
    import { createHash } from 'node:crypto';
    const archive = process.platform === 'win32'
      ? 'gitleaks_8.27.2_windows_x64.zip'
      : 'gitleaks_8.27.2_linux_x64.tar.gz';
    const bytes = Buffer.from('tampered release archive');
    const sha = createHash('sha256').update(bytes).digest('hex');
    globalThis.fetch = async (url) => String(url).endsWith('checksums.txt')
      ? new Response(sha + '  ' + archive, { status: 200 })
      : new Response(bytes, { status: 200 });
  `);
  writeFileSync(join(directory, 'global.gitconfig'), '');

  const git = (args) => spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  assert.equal(git(['init', '--quiet']).status, 0);
  assert.equal(git(['add', 'fixture.txt']).status, 0);
  const treeBefore = git(['write-tree']);
  assert.equal(treeBefore.status, 0, treeBefore.stderr);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(directory, 'global.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT']) delete env[key];
  const result = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(join(directory, 'tampered-release.mjs')).href, join(directory, 'tooling', 'security-tools.mjs'), 'gitleaks-protect'],
    { cwd: directory, env, encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /hash fijado/);
  const cache = join(directory, '.git', '.codex-tools', '8.27.2');
  assert.ok(!existsSync(cache) || !readdirSync(cache).some((file) => file.endsWith('.archive')));
  const treeAfter = git(['write-tree']);
  assert.equal(treeAfter.status, 0, treeAfter.stderr);
  assert.equal(treeAfter.stdout, treeBefore.stdout);
});

test('actionlint rejects an archive and official checksum changed together', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'resdigital-actionlint-pin-'));
  t.after(() => {
    const target = realpathSync(directory);
    const allowed = realpathSync(tmpdir()) + sep;
    assert.ok(target.startsWith(allowed));
    assert.match(basename(target), /^resdigital-actionlint-pin-/);
    rmSync(target, { recursive: true, force: true });
  });

  mkdirSync(join(directory, 'tooling'), { recursive: true });
  mkdirSync(join(directory, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(directory, '.github', 'workflows', 'ci.yml'), 'name: isolated fixture\n');
  copyFileSync(source, join(directory, 'tooling', 'security-tools.mjs'));
  writeFileSync(join(directory, 'fixture.txt'), 'isolated staged fixture\n');
  writeFileSync(join(directory, 'tampered-release.mjs'), `
    import { createHash } from 'node:crypto';
    const archive = process.platform === 'win32'
      ? 'actionlint_1.7.12_windows_amd64.zip'
      : 'actionlint_1.7.12_linux_amd64.tar.gz';
    const bytes = Buffer.from('tampered release archive');
    const sha = createHash('sha256').update(bytes).digest('hex');
    globalThis.fetch = async (url) => String(url).endsWith('checksums.txt')
      ? new Response(sha + '  ' + archive, { status: 200 })
      : new Response(bytes, { status: 200 });
  `);
  writeFileSync(join(directory, 'global.gitconfig'), '');

  const git = (args) => spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  assert.equal(git(['init', '--quiet']).status, 0);
  assert.equal(git(['add', 'fixture.txt']).status, 0);
  const treeBefore = git(['write-tree']);
  assert.equal(treeBefore.status, 0, treeBefore.stderr);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(directory, 'global.gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT']) delete env[key];
  const result = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(join(directory, 'tampered-release.mjs')).href, join(directory, 'tooling', 'security-tools.mjs'), 'actionlint'],
    { cwd: directory, env, encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /hash fijado/);
  const cache = join(directory, '.git', '.codex-tools', '1.7.12');
  assert.ok(!existsSync(cache) || !readdirSync(cache).some((file) => file.endsWith('.archive')));
  const treeAfter = git(['write-tree']);
  assert.equal(treeAfter.status, 0, treeAfter.stderr);
  assert.equal(treeAfter.stdout, treeBefore.stdout);
});
