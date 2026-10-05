import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const expected = ['policy', 'secrets', 'dependencies', 'quality', 'migration-replay', 'workflow-lint'];
export function failedRequiredJobs(jobs) {
  return expected.filter((name) => jobs[name]?.result !== 'success');
}

function main() {
  try {
    const jobs = JSON.parse(process.env.JOBS ?? '{}');
    const failed = failedRequiredJobs(jobs);
    if (failed.length) throw new Error(`Jobs no exitosos: ${failed.join(', ')}`);
    process.stdout.write('Todos los checks requeridos terminaron con éxito.\n');
  } catch (error) {
    process.stderr.write(`No se permite integrar: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
