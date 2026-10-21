import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = {
  actionlint: { version: '1.7.12', archive: process.platform === 'win32' ? 'actionlint_1.7.12_windows_amd64.zip' : 'actionlint_1.7.12_linux_amd64.tar.gz', sha256: process.platform === 'win32' ? '6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9' : '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8', executable: process.platform === 'win32' ? 'actionlint.exe' : 'actionlint', url: 'https://github.com/rhysd/actionlint/releases/download/v1.7.12/', checksums: 'actionlint_1.7.12_checksums.txt' },
  gitleaks: { version: '8.27.2', archive: process.platform === 'win32' ? 'gitleaks_8.27.2_windows_x64.zip' : 'gitleaks_8.27.2_linux_x64.tar.gz', sha256: process.platform === 'win32' ? '3c6a58efa70e991d7816a8bd87d1db797818017fcb67cbf1861394b404a70a42' : '141c3b2dede46d8b3a53b47116da756bd223decc0374797559a6b50ecba5590c', executable: process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks', url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.27.2/', checksums: 'gitleaks_8.27.2_checksums.txt' },
};
export function resolveScanRange(event, eventName, dispatchCommits = []) {
  let base;
  let head;
  if (event?.pull_request) { base = event.pull_request.base?.sha; head = event.pull_request.head?.sha; }
  else if (eventName === 'push' && event?.before && !/^0+$/.test(event.before)) { base = event.before; head = event.after; }
  else if (eventName === 'workflow_dispatch' && dispatchCommits.length === 2) [base, head] = dispatchCommits;
  else throw new Error('El evento no contiene un rango Git verificable para escaneo.');
  if (!/^[0-9a-f]{40}$/.test(base ?? '') || !/^[0-9a-f]{40}$/.test(head ?? '')) throw new Error('Rango Git inválido para escaneo CI.');
  return `${base}..${head}`;
}
function cachePath(tool) { return resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim(), '.codex-tools', tool.version, tool.executable); }
function scannerEnvironment(binary) {
  const directory = dirname(binary);
  const globalConfig = resolve(directory, 'empty.gitconfig');
  if (!existsSync(globalConfig)) writeFileSync(globalConfig, '');
  return { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1', XDG_CONFIG_HOME: directory };
}
async function install(name) {
  const tool = tools[name];
  if (!tool || !['win32', 'linux'].includes(process.platform)) throw new Error('Plataforma sin binario verificado.');
  const destination = cachePath(tool);
  if (existsSync(destination)) return destination;
  mkdirSync(dirname(destination), { recursive: true });
  const archive = process.platform === 'win32' ? `${destination}.zip` : `${destination}.archive`;
  try {
    const response = await fetch(tool.url + tool.archive, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}.`);
    await pipeline(response.body, createWriteStream(archive));
    const shasums = await fetch(tool.url + tool.checksums, { redirect: 'follow' });
    if (!shasums.ok) throw new Error(`${name}: checksums oficiales no disponibles.`);
    const officialLine = (await shasums.text()).split(/\r?\n/).find((line) => line.trim().endsWith(tool.archive));
    const officialSha = officialLine?.trim().split(/\s+/)[0];
    const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
    if (!/^[0-9a-f]{64}$/.test(officialSha ?? '') || actual !== officialSha) {
      throw new Error(`${name}: SHA-256 no coincide con checksum oficial.`);
    }
    if (!/^[0-9a-f]{64}$/.test(tool.sha256) || actual !== tool.sha256) {
      throw new Error(`${name}: SHA-256 no coincide con hash fijado; binario rechazado.`);
    }
    if (process.platform === 'win32') {
      const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;
      const command = `Expand-Archive -LiteralPath ${quotePowerShell(archive)} -DestinationPath ${quotePowerShell(dirname(destination))} -Force`;
      execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'inherit' });
    } else {
      execFileSync('tar', ['-xf', basename(archive), '-C', dirname(destination), tool.executable], { cwd: dirname(destination), stdio: 'inherit' });
    }
  } finally {
    rmSync(archive, { force: true });
  }
  if (process.platform !== 'win32') execFileSync('chmod', ['700', destination]);
  return destination;
}
async function main() {
  const [command] = process.argv.slice(2);
  if (command === 'actionlint') {
    const files = readdirSync(resolve(root, '.github/workflows')).filter((file) => /\.ya?ml$/.test(file)).map((file) => `.github/workflows/${file}`);
    if (!files.length) throw new Error('No hay workflows para validar.');
    execFileSync(await install(command), files, { cwd: root, stdio: 'inherit' });
  }
  else if (command === 'gitleaks-protect') {
    const args = ['protect', '--staged', '--redact'];
    if (existsSync(resolve(root, '.gitleaks.toml'))) args.push('--config', '.gitleaks.toml');
    const binary = await install('gitleaks');
    execFileSync(binary, args, { cwd: root, env: scannerEnvironment(binary), stdio: 'inherit' });
  } else if (command === 'gitleaks-ci') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const commits = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? [execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: root, encoding: 'utf8' }).trim(), execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()] : [];
    const range = resolveScanRange(event, process.env.GITHUB_EVENT_NAME, commits);
    const binary = await install('gitleaks');
    execFileSync(binary, ['git', '--redact', `--log-opts=${range}`, '--exit-code=1', '.'], { cwd: root, env: scannerEnvironment(binary), stdio: 'inherit' });
  } else throw new Error('Comando esperado: actionlint | gitleaks-protect | gitleaks-ci.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { process.stderr.write(`Herramienta de seguridad bloqueó la operación: ${error.message}\n`); process.exitCode = 1; });
