import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const conventionalTitle = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))?!?: .{8,120}$/;
export function hasOnlyFullShaPinnedActions(content) {
  const actions = [...content.matchAll(/^\s+uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
  return actions.every((action) => /^[^@]+@[0-9a-f]{40}$/.test(action));
}
export function validatePullRequest(event) {
  const pr = event?.pull_request;
  if (!pr || typeof pr.title !== 'string' || typeof pr.body !== 'string') return ['El evento no contiene un pull request válido.'];
  const errors = [];
  if (!conventionalTitle.test(pr.title)) errors.push('Usá un título Conventional Commits: tipo(scope): resumen.');
  if (!/^## Tarea y objetivo\s*$/m.test(pr.body)) errors.push('El PR debe completar «Tarea y objetivo».');
  if (!/^## Criterios de aceptación\s*$/m.test(pr.body)) errors.push('El PR debe describir criterios verificables.');
  if (!/(?:CORE|AUTH|SEC|QA|SAN|HATO|REPRO|DASH|POT|LECHE|REP)-T\d{3,4}/i.test(pr.body) && !/^Infraestructura:\s+\S.{4,}$/m.test(pr.body)) errors.push('Indicá un ID de tarea o una justificación después de «Infraestructura:».');
  const criteria = pr.body.split(/^## Criterios de aceptación\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  if (!criteria.split(/\r?\n/).some((line) => /^\s*-\s+\S.{5,}$/.test(line) && !line.includes('Criterio verificable'))) errors.push('El PR debe listar al menos un criterio de aceptación concreto.');
  return errors;
}
export function validateTag(tag, version) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) return 'El tag debe usar v<major>.<minor>.<patch>.';
  return tag === `v${version}` ? null : 'El tag debe coincidir con package.json.';
}
function git(args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function checkWorkflows() {
  const directory = resolve(root, '.github/workflows');
  const files = readdirSync(directory).filter((name) => /\.ya?ml$/.test(name));
  if (!files.length) throw new Error('No hay workflows para validar.');
  for (const file of files) {
    const content = readFileSync(resolve(directory, file), 'utf8');
    if (/pull_request_target/i.test(content)) throw new Error(`${file}: no se permite pull_request_target.`);
    if (!hasOnlyFullShaPinnedActions(content)) throw new Error(`${file}: cada Action debe fijarse a un SHA completo.`);
    if (!/^permissions:\r?\n  contents: read$/m.test(content) && !/^permissions:\r?\n(?:  [a-z_]+: [a-z]+\r?\n?)+/m.test(content)) throw new Error(`${file}: faltan permisos explícitos y acotados.`);
  }
}
function rejectMigrationEdits(event) {
  if (!event.pull_request) return;
  const { base, head } = event.pull_request;
  if (!/^[0-9a-f]{40}$/.test(base?.sha ?? '') || !/^[0-9a-f]{40}$/.test(head?.sha ?? '')) throw new Error('Faltan commits base/head para proteger migraciones.');
  const changed = git(['diff', '--name-status', '--find-renames', `${base.sha}...${head.sha}`]);
  if (changed.split(/\r?\n/).some(isForbiddenMigrationChange)) throw new Error('No se editan, renombran ni eliminan migraciones existentes; agregá una migración correctiva.');
}
export function isForbiddenMigrationChange(line) {
  const [status, ...paths] = line.split('\t');
  return status !== 'A' && paths.some((file) => file.startsWith('src/database/migrations/'));
}
function validateRelease() {
  const tag = process.env.RELEASE_TAG;
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const error = validateTag(tag, manifest.version);
  if (error) throw new Error(error);
  const commit = git(['rev-parse', `refs/tags/${tag}^{commit}`]);
  git(['merge-base', '--is-ancestor', commit, 'origin/main']);
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('GITHUB_REPOSITORY ausente o inválido.');
  const checks = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/commits/${commit}/check-runs`], { cwd: root, encoding: 'utf8' })).check_runs;
  const name = repository.endsWith('/frontend') ? 'Frontend required' : 'Backend required';
  if (!checks.some((check) => check.name === name && check.status === 'completed' && check.conclusion === 'success')) throw new Error(`Falta check exitoso ${name} en ${commit}.`);
}
function main() {
  try {
    if (process.argv.includes('--verify-workflows')) checkWorkflows();
    else if (process.argv.includes('--release')) validateRelease();
    else {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      rejectMigrationEdits(event);
      if (event.pull_request) {
        const errors = validatePullRequest(event);
        if (errors.length) throw new Error(errors.join('\n'));
      } else if (event.ref !== 'refs/heads/main' && event.ref !== 'refs/heads/dev') throw new Error('El push debe corresponder a main o dev.');
      if (event.before && !/^0+$/.test(event.before)) git(['diff', '--check', `${event.before}..${event.after}`]);
    }
    process.stdout.write('Política Git verificada.\n');
  } catch (error) { process.stderr.write(`Política Git bloqueó la operación: ${error.message}\n`); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
