import { assertEphemeralDockerIntegrationDatabase } from './src/test-utils/integration-tenant.js';

/** Rechaza conexiones compartidas antes de importar las suites que escriben. */
export default function setup(): void {
  assertEphemeralDockerIntegrationDatabase(
    process.env.DATABASE_URL,
    process.env.TEST_ADMIN_DATABASE_URL,
    process.env.RES_DIGITAL_TEST_DOCKER_CONTAINER,
    process.env.RES_DIGITAL_TEST_DOCKER_TOKEN,
  );
}
