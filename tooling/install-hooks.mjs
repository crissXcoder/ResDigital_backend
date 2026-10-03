import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const current = execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
if (current && current !== '.husky/_') throw new Error(`core.hooksPath ya está configurado como ${current}; no se reemplaza automáticamente.`);
execFileSync('git', ['config', '--local', 'core.hooksPath', '.husky/_'], { cwd: root, stdio: 'inherit' });
process.stdout.write('Hooks de Husky habilitados para este clon.\n');
