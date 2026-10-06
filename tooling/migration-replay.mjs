import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image =
  'postgres:15.14-bookworm@sha256:496f07cd16dff6406cee521a66b37080be917ea063f017336affdfcb1c61f90e';
const postgrestImage =
  'postgrest/postgrest@sha256:bea1c76a856fa39d1e542d25911cf95d02fe2bf971992d033044ff209f1504b8';
if (process.env.GITHUB_ACTIONS !== 'true')
  throw new Error(
    'La repetición de migraciones solo corre en runner efímero de GitHub Actions.',
  );
if (process.env.DATABASE_URL)
  throw new Error(
    'DATABASE_URL heredada presente; se detiene para evitar tocar una BD ajena.',
  );
const container = `resdigital-migrations-${randomUUID()}`;
const postgrest = `resdigital-postgrest-${randomUUID()}`;
const network = `resdigital-replay-${randomUUID()}`;
const password = randomBytes(32).toString('hex');
const appPassword = randomBytes(32).toString('hex');
const apiPassword = randomBytes(32).toString('hex');
const jwtSecret = randomBytes(32).toString('hex');
let started = false;
let postgrestStarted = false;
let networkStarted = false;
function docker(args) {
  return execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
try {
  docker(['network', 'create', network]);
  networkStarted = true;
  docker([
    'run',
    '--detach',
    '--rm',
    '--network',
    network,
    '--name',
    container,
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_DB=resdigital_ci',
    '--env',
    'POSTGRES_USER=resdigital_ci',
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    image,
  ]);
  started = true;
  const port = docker(['port', container, '5432/tcp']).trim().split(':').at(-1);
  if (!/^\d+$/.test(port ?? ''))
    throw new Error('No se pudo determinar el puerto efímero de PostgreSQL.');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const probe = spawnSync(
      'docker',
      [
        'exec',
        container,
        'pg_isready',
        '-U',
        'resdigital_ci',
        '-d',
        'resdigital_ci',
      ],
      { cwd: root, stdio: 'ignore' },
    );
    if (probe.status === 0) break;
    if (probe.error) throw probe.error;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  const ready = spawnSync(
    'docker',
    [
      'exec',
      container,
      'pg_isready',
      '-U',
      'resdigital_ci',
      '-d',
      'resdigital_ci',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  if (ready.status !== 0)
    throw new Error('PostgreSQL no quedó listo en 90 segundos.');
  const bootstrap = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      `app_password=${appPassword}`,
      '-v',
      `api_password=${apiPassword}`,
      '-U',
      'resdigital_ci',
      '-d',
      'resdigital_ci',
    ],
    {
      cwd: root,
      input: readFileSync(
        resolve(root, 'src/database/scripts/bootstrap-local.sql'),
      ),
      encoding: 'utf8',
    },
  );
  if (bootstrap.status !== 0)
    throw new Error(
      `No se pudo aplicar bootstrap-local.sql: ${(bootstrap.stderr ?? '').slice(-2000)}`,
    );
  const env = {
    ...process.env,
    DATABASE_URL: [
      'postgresql://resdigital_ci:',
      password,
      '@127.0.0.1:',
      port,
      '/resdigital_ci',
    ].join(''),
  };
  delete env.GITHUB_ENV;
  const cli = resolve(root, 'node_modules/typeorm/cli.js');
  const dataSource = resolve(root, 'src/database/data-source.ts');
  const run = spawnSync(
    process.execPath,
    [
      '--env-file-if-exists=.env',
      '--import',
      'tsx',
      cli,
      'migration:run',
      '--dataSource',
      dataSource,
    ],
    { cwd: root, env, stdio: 'inherit' },
  );
  if (run.status !== 0)
    throw new Error('TypeORM no pudo ejecutar todas las migraciones.');
  const verify = spawnSync(
    process.execPath,
    [
      '--env-file-if-exists=.env',
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "import dataSource from './src/database/data-source.ts'; try { await dataSource.initialize(); if (await dataSource.showMigrations()) throw new Error('Quedaron migraciones pendientes.'); console.log(`Replay confirmado: ${dataSource.migrations.length} migraciones cargadas y ninguna pendiente.`); } finally { if (dataSource.isInitialized) await dataSource.destroy(); }",
    ],
    { cwd: root, env, encoding: 'utf8' },
  );
  if (verify.status !== 0)
    throw new Error(
      `TypeORM no pudo verificar el estado final de migraciones: ${(verify.stderr ?? '').slice(-2000)}`,
    );
  process.stdout.write(verify.stdout);
  const build = spawnSync(
    process.execPath,
    [resolve(root, 'node_modules/@nestjs/cli/bin/nest.js'), 'build'],
    { cwd: root, env, stdio: 'inherit' },
  );
  if (build.status !== 0)
    throw new Error('Nest no pudo compilar la aplicación para verificar OpenAPI.');
  const appUrl = [
    'postgresql://resdigital_app:',
    appPassword,
    '@127.0.0.1:',
    port,
    '/resdigital_ci',
  ].join('');
  const openapiCheck = spawnSync(
    process.execPath,
    [resolve(root, 'tooling/export-openapi.mjs'), '--check'],
    {
      cwd: root,
      env: {
        ...env,
        DATABASE_URL: appUrl,
        NODE_ENV: 'test',
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: randomBytes(32).toString('hex'),
        SUPABASE_ANON_KEY: randomBytes(32).toString('hex'),
      },
      encoding: 'utf8',
    },
  );
  if (openapiCheck.status !== 0)
    throw new Error(
      `El contrato OpenAPI no coincide con los controladores: ${(openapiCheck.stderr ?? openapiCheck.stdout ?? '').slice(-2000)}`,
    );
  process.stdout.write(openapiCheck.stdout);
  const postgrestPort = docker([
    'run',
    '--detach',
    '--rm',
    '--network',
    network,
    '--name',
    postgrest,
    '--publish',
    '127.0.0.1::3000',
    '--env',
    [
      'PGRST_DB_URI=postgresql://authenticator:',
      apiPassword,
      `@${container}:5432`,
      '/resdigital_ci',
    ].join(''),
    '--env',
    'PGRST_DB_SCHEMAS=public',
    '--env',
    'PGRST_DB_ANON_ROLE=anon',
    '--env',
    `PGRST_JWT_SECRET=${jwtSecret}`,
    '--env',
    'PGRST_SERVER_PORT=3000',
    postgrestImage,
  ]).trim();
  postgrestStarted = true;
  const apiHostPort = docker(['port', postgrest, '3000/tcp'])
    .trim()
    .split(':')
    .at(-1);
  if (!/^\d+$/.test(apiHostPort ?? ''))
    throw new Error('No se pudo determinar el puerto efímero de PostgREST.');
  const apiUrl = `http://127.0.0.1:${apiHostPort}`;
  const apiDeadline = Date.now() + 60_000;
  let apiReady = false;
  let lastApiError;
  let lastApiResponse;
  while (Date.now() < apiDeadline) {
    try {
      const response = await fetch(`${apiUrl}/`);
      if (response.ok) {
        apiReady = true;
        break;
      }
      lastApiResponse = `${response.status} ${response.statusText}: ${(await response.text()).slice(0, 300)}`;
    } catch (error) {
      lastApiError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  if (!apiReady) {
    const logs = docker(['logs', postgrest]);
    const diagnosis = logs
      .split('\n')
      .map((line) =>
        line
          .replace(/postgres(?:ql)?:\/\/\S+/gi, '[connection string redacted]')
          .replaceAll(apiPassword, '[password redacted]')
          .replaceAll(jwtSecret, '[secret redacted]'),
      )
      .slice(-12)
      .join('\n');
    throw new Error(
      `PostgREST no quedó listo: ${diagnosis || lastApiResponse || lastApiError?.message || 'sin respuesta HTTP válida'}`,
    );
  }
  const smoke = spawnSync(
    process.execPath,
    [resolve(root, 'tooling/rls-security-smoke.mjs')],
    {
      cwd: root,
      env: {
        ...env,
        RLS_ADMIN_DATABASE_URL: env.DATABASE_URL,
        RLS_APP_DATABASE_URL: [
          'postgresql://resdigital_app:',
          appPassword,
          '@127.0.0.1:',
          port,
          '/resdigital_ci',
        ].join(''),
        RLS_POSTGREST_URL: apiUrl,
        RLS_JWT_SECRET: jwtSecret,
      },
      encoding: 'utf8',
    },
  );
  if (smoke.status !== 0)
    throw new Error(
      `Falló el smoke RLS local: ${(smoke.stderr ?? smoke.stdout ?? '').slice(-2500)}`,
    );
  process.stdout.write(smoke.stdout);
} finally {
  if (postgrestStarted)
    execFileSync('docker', ['rm', '--force', postgrest], {
      cwd: root,
      stdio: 'ignore',
    });
  if (started)
    execFileSync('docker', ['rm', '--force', container], {
      cwd: root,
      stdio: 'ignore',
    });
  if (networkStarted)
    execFileSync('docker', ['network', 'rm', network], {
      cwd: root,
      stdio: 'ignore',
    });
}
