import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DataSource, type DataSourceOptions } from 'typeorm';

/** Fixtures exclusivamente para PostgreSQL local descartable. */

export interface TenantsDePrueba {
  tenantA: string;
  tenantB: string;
}

export function crearTenantsDePrueba(): TenantsDePrueba {
  return { tenantA: randomUUID(), tenantB: randomUUID() };
}

/** Usuarios aleatorios: el setup admin crea auth.users y usuario por tenant. */
export function obtenerUsuariosDePrueba(): {
  usuarioA: string;
  usuarioB: string;
} {
  return { usuarioA: randomUUID(), usuarioB: randomUUID() };
}

export function assertLocalIntegrationDatabase(
  value: string | undefined,
): string {
  if (!value)
    throw new Error('Falta la conexión PostgreSQL local de integración.');
  const url = new URL(value);
  if (
    url.search ||
    url.hash ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !/^\/resdigital_test_[a-f0-9]+$/.test(url.pathname)
  ) {
    throw new Error(
      'Integración requiere PostgreSQL local descartable resdigital_test_<id>.',
    );
  }
  return value;
}

/** Verifica que Vitest solo pueda escribir en el contenedor creado por el runner de esta ejecución. */
export function assertEphemeralDockerIntegrationDatabase(
  runtimeUrl: string | undefined,
  adminUrl: string | undefined,
  containerName: string | undefined,
  token: string | undefined,
): void {
  const runtime = new URL(assertLocalIntegrationDatabase(runtimeUrl));
  const admin = new URL(assertLocalIntegrationDatabase(adminUrl));
  if (
    runtime.username !== 'resdigital_app' ||
    admin.username === runtime.username ||
    runtime.hostname !== '127.0.0.1' ||
    admin.hostname !== runtime.hostname ||
    runtime.port !== admin.port ||
    runtime.pathname !== admin.pathname ||
    !containerName?.startsWith('resdigital-integration-') ||
    !/^[a-f0-9]{64}$/.test(token ?? '')
  ) {
    throw new Error(
      'Usá pnpm test:integration para aprovisionar la BD Docker descartable.',
    );
  }

  let container: Array<{
    Config?: { Labels?: Record<string, string>; Image?: string };
    State?: { Running?: boolean };
    NetworkSettings?: {
      Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
    };
  }>;
  try {
    container = JSON.parse(
      execFileSync('docker', ['inspect', containerName], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ) as typeof container;
  } catch {
    throw new Error(
      'No se pudo verificar el contenedor PostgreSQL efímero de integración.',
    );
  }

  const instance = container[0];
  const publishedPort = instance?.NetworkSettings?.Ports?.['5432/tcp']?.[0];
  if (
    instance?.Config?.Labels?.['io.resdigital.integration-token'] !== token ||
    instance.State?.Running !== true ||
    publishedPort?.HostIp !== '127.0.0.1' ||
    publishedPort.HostPort !== runtime.port
  ) {
    throw new Error(
      'La base de integración no coincide con el contenedor Docker efímero verificado.',
    );
  }
}

export function crearAdminDataSource(
  entities: DataSourceOptions['entities'] = [],
): DataSource {
  return new DataSource({
    type: 'postgres',
    url: assertLocalIntegrationDatabase(process.env.TEST_ADMIN_DATABASE_URL),
    entities,
    migrations: [],
    synchronize: false,
    ssl: false,
  });
}

export async function insertarUsuario(
  dataSource: DataSource,
  tenantId: string,
  userId: string,
  rol = 'propietario',
): Promise<void> {
  const email = 'qa-' + userId + '@example.invalid';
  await dataSource.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [
    userId,
    email,
  ]);
  await dataSource.query(
    'INSERT INTO usuario (id, tenant_id, nombre_completo, correo, rol) VALUES ($1, $2, $3, $4, $5)',
    [userId, tenantId, 'QA Integración', email, rol],
  );
}

export async function insertarTenant(
  dataSource: DataSource,
  tenantId: string,
  nombre = `TEST Finca ${tenantId.slice(0, 8)}`,
): Promise<void> {
  await dataSource.query(
    `INSERT INTO tenant (id, nombre_finca, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO NOTHING;`,
    [tenantId, nombre],
  );
}

export async function insertarTenants(
  dataSource: DataSource,
  tenants: TenantsDePrueba,
): Promise<void> {
  await insertarTenant(
    dataSource,
    tenants.tenantA,
    `TEST Finca A ${tenants.tenantA.slice(0, 8)}`,
  );
  await insertarTenant(
    dataSource,
    tenants.tenantB,
    `TEST Finca B ${tenants.tenantB.slice(0, 8)}`,
  );
}

/**
 * Orden de borrado: de las tablas hoja hacia las raíces, respetando las FK.
 * Las tablas de detalle reproductivo no tienen `tenant_id` propio, así que se
 * acotan por su evento padre.
 */
const DETALLES_REPRODUCTIVOS = [
  'evento_servicio',
  'evento_diagnostico',
  'evento_parto',
  'evento_secado',
];

const TABLAS_CON_TENANT = [
  'pesaje',
  'documento_animal',
  'tratamiento_sanitario',
  'evento',
  'animal',
  'potrero',
  'catalogo_raza',
  'evento_auth',
  'invitacion',
];

async function tablaExiste(
  dataSource: DataSource,
  tabla: string,
): Promise<boolean> {
  const filas: Array<{ existe: string | null }> = await dataSource.query(
    `SELECT to_regclass($1)::text AS existe;`,
    [`public.${tabla}`],
  );
  return filas[0]?.existe != null;
}

export async function limpiarTenants(
  dataSource: DataSource,
  tenantIds: string[],
): Promise<void> {
  if (tenantIds.length === 0) return;

  for (const tabla of DETALLES_REPRODUCTIVOS) {
    if (!(await tablaExiste(dataSource, tabla))) continue;
    await dataSource.query(
      `DELETE FROM ${tabla}
       WHERE evento_id IN (SELECT id FROM evento WHERE tenant_id = ANY($1));`,
      [tenantIds],
    );
  }

  // Romper las autorreferencias de `animal` antes de borrar las filas.
  if (await tablaExiste(dataSource, 'animal')) {
    await dataSource.query(
      `UPDATE animal SET madre_id = NULL, padre_id = NULL, potrero_id = NULL
       WHERE tenant_id = ANY($1);`,
      [tenantIds],
    );
  }

  for (const tabla of TABLAS_CON_TENANT) {
    if (!(await tablaExiste(dataSource, tabla))) continue;
    await dataSource.query(`DELETE FROM ${tabla} WHERE tenant_id = ANY($1);`, [
      tenantIds,
    ]);
  }

  await dataSource.query(
    'DELETE FROM auth.users WHERE id IN (SELECT id FROM usuario WHERE tenant_id = ANY($1))',
    [tenantIds],
  );
  await dataSource.query(`DELETE FROM tenant WHERE id = ANY($1);`, [tenantIds]);
}
