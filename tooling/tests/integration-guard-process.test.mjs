import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

test('Vitest rechaza una base local con nombre de prueba sin Docker etiquetado por el runner', () => {
  const env = {
    ...process.env,
    ALLOW_DB_INTEGRATION_TESTS: 'true',
    DATABASE_URL:
      'postgresql://resdigital_app@127.0.0.1:54321/resdigital_test_deadbeef',
    TEST_ADMIN_DATABASE_URL:
      'postgresql://resdigital_test_admin@127.0.0.1:54321/resdigital_test_deadbeef',
    RES_DIGITAL_TEST_DOCKER_CONTAINER:
      'resdigital-integration-forged-test',
    RES_DIGITAL_TEST_DOCKER_TOKEN: 'a'.repeat(64),
  };
  const result = spawnSync(
    process.execPath,
    [
      resolve('node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      'vitest.config.integration.ts',
    ],
    { cwd: process.cwd(), env, encoding: 'utf8', timeout: 30000 },
  );

  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(
    result.stderr + result.stdout,
    /No se pudo verificar el contenedor PostgreSQL efímero|no coincide con el contenedor Docker efímero/,
  );
});
