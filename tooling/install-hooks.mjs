import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function resolveHooksPath(current, required) {
  if (current && current !== required) {
    throw new Error(`core.hooksPath ya está configurado como ${current}; no se reemplaza automáticamente.`);
  }
  return required;
}

function installHooks() {
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (resolve(gitRoot) !== root) throw new Error('El instalador debe ejecutarse desde la raíz de su propio clon.');
  let current = '';
  try {
    current = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  resolveHooksPath(current, '.husky/_');
  execFileSync(process.execPath, [resolve(root, 'node_modules/husky/bin.js')], {
    cwd: root, stdio: 'inherit',
  });
  process.stdout.write('Hooks de Husky habilitados para este clon.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) installHooks();
