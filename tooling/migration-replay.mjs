import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = 'postgres:15.14-bookworm@sha256:496f07cd16dff6406cee521a66b37080be917ea063f017336affdfcb1c61f90e';
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('La repetición de migraciones solo corre en runner efímero de GitHub Actions.');
if (process.env.DATABASE_URL) throw new Error('DATABASE_URL heredada presente; se detiene para evitar tocar una BD ajena.');
const container = `resdigital-migrations-${randomUUID()}`;
const password = randomBytes(32).toString('hex');
let started = false;
function docker(args) { return execFileSync('docker', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
try {
  docker(['run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_DB=resdigital_ci', '--env', 'POSTGRES_USER=resdigital_ci', '--env', `POSTGRES_PASSWORD=${password}`, image]);
  started = true;
  const port = docker(['port', container, '5432/tcp']).trim().split(':').at(-1);
  if (!/^\d+$/.test(port ?? '')) throw new Error('No se pudo determinar el puerto efímero de PostgreSQL.');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const probe = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'resdigital_ci', '-d', 'resdigital_ci'], { cwd: root, stdio: 'ignore' });
    if (probe.status === 0) break;
    if (probe.error) throw probe.error;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  const ready = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'resdigital_ci', '-d', 'resdigital_ci'], { cwd: root, stdio: 'ignore' });
  if (ready.status !== 0) throw new Error('PostgreSQL no quedó listo en 90 segundos.');
  const bootstrap = spawnSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'resdigital_ci', '-d', 'resdigital_ci'], { cwd: root, input: readFileSync(resolve(root, 'src/database/scripts/bootstrap-local.sql')), encoding: 'utf8' });
  if (bootstrap.status !== 0) throw new Error(`No se pudo aplicar bootstrap-local.sql: ${(bootstrap.stderr ?? '').slice(-2000)}`);
  const env = { ...process.env, DATABASE_URL: ['postgresql://resdigital_ci:', password, '@127.0.0.1:', port, '/resdigital_ci'].join('') };
  delete env.GITHUB_ENV;
  const cli = resolve(root, 'node_modules/typeorm/cli.js');
  const dataSource = resolve(root, 'src/database/data-source.ts');
  const run = spawnSync(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', cli, 'migration:run', '--dataSource', dataSource], { cwd: root, env, stdio: 'inherit' });
  if (run.status !== 0) throw new Error('TypeORM no pudo ejecutar todas las migraciones.');
  const verify = spawnSync(process.execPath, [
    '--env-file-if-exists=.env',
    '--import',
    'tsx',
    '--input-type=module',
    '-e',
    "import dataSource from './src/database/data-source.ts'; try { await dataSource.initialize(); if (await dataSource.showMigrations()) throw new Error('Quedaron migraciones pendientes.'); console.log(`Replay confirmado: ${dataSource.migrations.length} migraciones cargadas y ninguna pendiente.`); } finally { if (dataSource.isInitialized) await dataSource.destroy(); }",
  ], { cwd: root, env, encoding: 'utf8' });
  if (verify.status !== 0) throw new Error(`TypeORM no pudo verificar el estado final de migraciones: ${(verify.stderr ?? '').slice(-2000)}`);
  process.stdout.write(verify.stdout);
} finally {
  if (started) execFileSync('docker', ['rm', '--force', container], { cwd: root, stdio: 'ignore' });
}
