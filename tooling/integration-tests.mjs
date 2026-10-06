import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sólo aprovisiona un contenedor propio enlazado a loopback. No carga .env.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image =
  'postgres:15.14-bookworm@sha256:496f07cd16dff6406cee521a66b37080be917ea063f017336affdfcb1c61f90e';
const id = randomBytes(12).toString('hex');
const integrationToken = randomBytes(32).toString('hex');
const database = 'resdigital_test_' + id;
const container = 'resdigital-integration-' + id;
const password = randomBytes(32).toString('hex');
const appPassword = randomBytes(32).toString('hex');
const apiPassword = randomBytes(32).toString('hex');
let started = false;
const docker = (args) =>
  execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
function run(args, env, quiet = false) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (quiet && result.status !== 0)
    process.stderr.write((result.stderr || result.stdout || '').slice(-4000));
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      'Falló la etapa: ' + args.filter((arg) => !arg.includes('://')).join(' '),
    );
  return quiet ? result.stdout || '' : '';
}
try {
  docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--label',
    'io.resdigital.integration-token=' + integrationToken,
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_DB=' + database,
    '--env',
    'POSTGRES_USER=resdigital_test_admin',
    '--env',
    'POSTGRES_PASSWORD=' + password,
    image,
  ]);
  started = true;
  const port = docker(['port', container, '5432/tcp']).trim().split(':').at(-1);
  if (!/^\d+$/.test(port ?? ''))
    throw new Error('Puerto efímero de PostgreSQL inválido.');
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    const probe = spawnSync(
      'docker',
      [
        'exec',
        container,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'resdigital_test_admin',
        '-d',
        database,
      ],
      { stdio: 'ignore' },
    );
    if (probe.error) throw probe.error;
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  if (!ready) throw new Error('PostgreSQL no quedó listo en 90 segundos.');
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
      'app_password=' + appPassword,
      '-v',
      'api_password=' + apiPassword,
      '-U',
      'resdigital_test_admin',
      '-d',
      database,
    ],
    {
      input: readFileSync(
        resolve(root, 'src/database/scripts/bootstrap-local.sql'),
      ),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  if (bootstrap.status !== 0)
    throw new Error(
      'Falló bootstrap local: ' +
        bootstrap.stderr
          .replaceAll(appPassword, '[redactado]')
          .replaceAll(apiPassword, '[redactado]'),
    );
  const adminUrl =
    'postgresql://resdigital_test_admin:' +
    password +
    '@127.0.0.1:' +
    port +
    '/' +
    database;
  const appUrl =
    'postgresql://resdigital_app:' +
    appPassword +
    '@127.0.0.1:' +
    port +
    '/' +
    database;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: adminUrl,
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: randomBytes(32).toString('hex'),
    SUPABASE_ANON_KEY: randomBytes(32).toString('hex'),
    RES_DIGITAL_TEST_DOCKER_CONTAINER: container,
    RES_DIGITAL_TEST_DOCKER_TOKEN: integrationToken,
  };
  delete env.DATABASE_CA_CERT;
  // TypeScript compila imports de interfaces; TypeORM carga las migraciones JS reales.
  run([resolve(root, 'node_modules/@nestjs/cli/bin/nest.js'), 'build'], env);
  run(
    [
      resolve(root, 'node_modules/typeorm/cli.js'),
      'migration:run',
      '--dataSource',
      'dist/database/data-source.js',
    ],
    env,
    true,
  );
  const migrationStatus = run(
    [
      resolve(root, 'node_modules/typeorm/cli.js'),
      'migration:show',
      '--dataSource',
      'dist/database/data-source.js',
    ],
    env,
    true,
  );
  const appliedMigrations = migrationStatus.match(/^\[X\]\s+.+$/gm) ?? [];
  const pendingMigrations = migrationStatus.match(/^\[\s\]\s+.+$/gm) ?? [];
  if (appliedMigrations.length === 0 || pendingMigrations.length > 0) {
    throw new Error(
      'Replay incompleto: ' +
        appliedMigrations.length +
        ' migraciones aplicadas y ' +
        pendingMigrations.length +
        ' pendientes.',
    );
  }
  console.log(
    'Replay confirmado: ' +
      appliedMigrations.length +
      ' migraciones aplicadas; cero pendientes.',
  );
  run(
    [
      resolve(root, 'tooling/export-openapi.mjs'),
      '--sync-frontend',
    ],
    { ...env, DATABASE_URL: appUrl },
  );
  const seed = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'resdigital_test_admin',
      '-d',
      database,
    ],
    {
      input:
        "INSERT INTO catalogo_raza (id, nombre, dias_gestacion) VALUES ('" +
        randomUUID() +
        "', 'QA Raza Global', 280);",
      encoding: 'utf8',
    },
  );
  if (seed.status !== 0)
    throw new Error('Falló la fixture explícita de catálogo.');
  const testEnv = {
    ...env,
    DATABASE_URL: appUrl,
    TEST_ADMIN_DATABASE_URL: adminUrl,
  };
  run(
    [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      'vitest.config.integration.ts',
    ],
    testEnv,
  );
  const cleanup = docker([
    'exec',
    container,
    'psql',
    '-At',
    '-U',
    'resdigital_test_admin',
    '-d',
    database,
    '-c',
    'SELECT (SELECT count(*) FROM tenant) + (SELECT count(*) FROM auth.users) + (SELECT count(*) FROM animal) + (SELECT count(*) FROM potrero) + (SELECT count(*) FROM evento)',
  ]);
  if (cleanup.trim() !== '0')
    throw new Error(
      'Las suites dejaron fixtures de tenants, usuarios o dominio sin limpiar.',
    );
  console.log(
    'Cleanup SQL confirmado: cero tenants, usuarios, animales, potreros y eventos.',
  );
  run([resolve(root, 'node_modules/vitest/vitest.mjs'), 'run'], testEnv);
  run(
    [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      'vitest.config.e2e.ts',
    ],
    testEnv,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(
    [password, appPassword, apiPassword].reduce(
      (redacted, secret) => redacted.replaceAll(secret, '[redactado]'),
      message,
    ),
  );
} finally {
  if (started) {
    docker(['rm', '--force', container]);
    const remaining = docker([
      'ps',
      '--all',
      '--filter',
      'name=^/' + container + '$',
      '--format',
      '{{.Names}}',
    ]).trim();
    if (remaining)
      throw new Error('El contenedor de integración no se eliminó.');
    console.log(
      'Cleanup Docker confirmado: contenedor y BD descartable eliminados.',
    );
  }
}
