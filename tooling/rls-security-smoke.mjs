import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import pg from 'pg';

const { Client } = pg;
const admin = new Client({
  connectionString: process.env.RLS_ADMIN_DATABASE_URL,
});
const app = new Client({ connectionString: process.env.RLS_APP_DATABASE_URL });
let adminConnected = false;
let appConnected = false;
const apiUrl = process.env.RLS_POSTGREST_URL;
const jwtSecret = process.env.RLS_JWT_SECRET;
const roles = ['propietario', 'administrador', 'peon', 'veterinario'];
const tenantId = randomUUID();
const tenantBId = randomUUID();
const userId = randomUUID();
const userBId = randomUUID();
const email = `${userId}@example.test`;
const emailB = `${userBId}@example.test`;

function requireEnv(value, name) {
  if (!value) throw new Error(`Falta ${name} para el smoke test aislado.`);
  return value;
}

async function tokenFor(rol) {
  return new SignJWT({ role: 'authenticated', tenant_id: tenantId, rol })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('3m')
    .sign(new TextEncoder().encode(jwtSecret));
}

try {
  requireEnv(apiUrl, 'RLS_POSTGREST_URL');
  requireEnv(jwtSecret, 'RLS_JWT_SECRET');
  await admin.connect();
  adminConnected = true;
  await app.connect();
  appConnected = true;

  const {
    rows: [identity],
  } = await app.query(`
    SELECT session_user::text AS session_role,
      current_user::text AS current_role,
      app_role.rolsuper AS is_superuser,
      app_role.rolbypassrls AS bypasses_rls,
      EXISTS (
        SELECT 1 FROM pg_auth_members membership
        WHERE membership.member = app_role.oid
      ) AS has_role_memberships,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
      EXISTS (
        SELECT 1 FROM pg_class relation
        JOIN pg_namespace ns ON ns.oid = relation.relnamespace
        WHERE ns.nspname = 'public' AND relation.relowner = app_role.oid
      ) AS owns_public_table
    FROM pg_roles app_role WHERE app_role.rolname = current_user;
  `);
  assert.deepEqual(identity, {
    session_role: 'resdigital_app',
    current_role: 'resdigital_app',
    is_superuser: false,
    bypasses_rls: false,
    has_role_memberships: false,
    can_create_public: false,
    owns_public_table: false,
  });

  const { rows: domainRows } = await app.query(
    `
    SELECT relation.relname,
      relation.relrowsecurity AS rls_enabled,
      relation.relforcerowsecurity AS rls_forced,
      pg_has_role('resdigital_app', 'authenticated', 'MEMBER') AS can_assume_authenticated,
      has_table_privilege('authenticated', relation.oid, 'SELECT') AS authenticated_can_select,
      has_table_privilege('authenticated', relation.oid, 'INSERT') AS authenticated_can_insert,
      has_table_privilege('authenticated', relation.oid, 'UPDATE') AS authenticated_can_update,
      has_table_privilege('authenticated', relation.oid, 'DELETE') AS authenticated_can_delete
    FROM pg_class relation
    JOIN pg_namespace ns ON ns.oid = relation.relnamespace
    WHERE ns.nspname = 'public' AND relation.relname = ANY($1::text[])
    ORDER BY relation.relname;
  `,
    [
      [
        'animal',
        'catalogo_raza',
        'catalogo_medicamento',
        'catalogo_padecimiento',
        'documento_animal',
        'evento',
        'evento_auth',
        'evento_diagnostico',
        'evento_parto',
        'evento_secado',
        'evento_servicio',
        'invitacion',
        'pesaje',
        'potrero',
        'tenant',
        'tratamiento_sanitario',
        'usuario',
      ],
    ],
  );
  assert.equal(domainRows.length, 17);
  for (const table of domainRows) {
    assert.equal(table.rls_enabled, true, `${table.relname} tiene RLS`);
    assert.equal(table.rls_forced, true, `${table.relname} fuerza RLS`);
    assert.equal(table.can_assume_authenticated, false);
    for (const permission of ['select', 'insert', 'update', 'delete']) {
      assert.equal(table[`authenticated_can_${permission}`], false);
    }
  }

  await assert.rejects(
    app.query('SET ROLE authenticated'),
    (error) => error.code === '42501',
  );

  await admin.query(
    'INSERT INTO public.tenant (id, nombre_finca) VALUES ($1, $2)',
    [tenantId, `SEC-T001 ${userId}`],
  );
  await admin.query(
    'INSERT INTO public.tenant (id, nombre_finca) VALUES ($1, $2)',
    [tenantBId, `SEC-T001 ${userBId}`],
  );
  await admin.query(
    'INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)',
    [userId, email, userBId, emailB],
  );
  await admin.query(
    `INSERT INTO public.usuario (id, tenant_id, nombre_completo, correo, rol)
     VALUES ($1, $2, 'SEC-T001 fixture A', $3, 'peon'),
            ($4, $5, 'SEC-T001 fixture B', $6, 'propietario')`,
    [userId, tenantId, email, userBId, tenantBId, emailB],
  );

  for (const rol of roles) {
    const authorization = `Bearer ${await tokenFor(rol)}`;
    const read = await fetch(
      `${apiUrl}/usuario?select=id,rol&id=eq.${userId}`,
      { headers: { authorization } },
    );
    assert.equal(read.ok, false, `GET directo bloqueado para ${rol}`);

    const update = await fetch(`${apiUrl}/usuario?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        authorization,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ rol: 'propietario' }),
    });
    assert.equal(update.ok, false, `PATCH directo bloqueado para ${rol}`);
  }

  const {
    rows: [storedUser],
  } = await admin.query('SELECT rol::text FROM public.usuario WHERE id = $1', [
    userId,
  ]);
  assert.equal(
    storedUser.rol,
    'peon',
    'el rol queda sin cambios tras los PATCH directos',
  );

  await app.query('BEGIN');
  await app.query('SELECT set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({ sub: userId, tenant_id: tenantId, rol: 'propietario' }),
  ]);
  await app.query('SELECT set_config($1, $2, true)', [
    'app.current_tenant_id',
    tenantId,
  ]);
  const { rows: visibleUsers } = await app.query(
    'SELECT id FROM public.usuario ORDER BY id',
  );
  assert.deepEqual(
    visibleUsers.map((row) => row.id),
    [userId],
  );
  const crossTenantUpdate = await app.query(
    "UPDATE public.usuario SET rol = 'peon' WHERE id = $1",
    [userBId],
  );
  assert.equal(
    crossTenantUpdate.rowCount,
    0,
    'la finca A no puede escribir la fila de B',
  );
  await app.query('COMMIT');

  const { rows: unscopedUsers } = await app.query(
    'SELECT id FROM public.usuario',
  );
  assert.equal(
    unscopedUsers.length,
    0,
    'el contexto RLS no se filtra a la transacción siguiente',
  );

  await admin.query(`
    CREATE TABLE public.sec_t001_default_acl (id BIGSERIAL PRIMARY KEY);
    CREATE FUNCTION public.sec_t001_default_acl_fn() RETURNS integer
      LANGUAGE sql AS 'SELECT 1';
  `);
  const {
    rows: [defaults],
  } = await admin.query(`
    SELECT
      has_table_privilege('anon', 'public.sec_t001_default_acl', 'SELECT') AS anon_table,
      has_table_privilege('authenticated', 'public.sec_t001_default_acl', 'SELECT') AS authenticated_table,
      has_sequence_privilege('anon', 'public.sec_t001_default_acl_id_seq', 'USAGE') AS anon_sequence,
      has_sequence_privilege('authenticated', 'public.sec_t001_default_acl_id_seq', 'USAGE') AS authenticated_sequence,
      has_function_privilege('anon', 'public.sec_t001_default_acl_fn()', 'EXECUTE') AS anon_function,
      has_function_privilege('authenticated', 'public.sec_t001_default_acl_fn()', 'EXECUTE') AS authenticated_function,
      EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
        WHERE relation.relname = 'sec_t001_default_acl' AND acl.grantee = 0
      ) AS public_table,
      EXISTS (
        SELECT 1 FROM pg_class sequence
        CROSS JOIN LATERAL aclexplode(COALESCE(sequence.relacl, acldefault('S', sequence.relowner))) acl
        WHERE sequence.relname = 'sec_t001_default_acl_id_seq' AND acl.grantee = 0
      ) AS public_sequence,
      EXISTS (
        SELECT 1 FROM pg_proc routine
        CROSS JOIN LATERAL aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) acl
        WHERE routine.proname = 'sec_t001_default_acl_fn' AND acl.grantee = 0
      ) AS public_function
    FROM pg_class relation
    WHERE relation.relname = 'sec_t001_default_acl';
  `);
  for (const [privilege, granted] of Object.entries(defaults)) {
    assert.equal(granted, false, `el default ${privilege} permanece revocado`);
  }

  console.log(
    'Smoke RLS confirmado: rol runtime, 17 tablas, cuatro JWT, PATCH denegado, tenants y defaults.',
  );
} finally {
  // The fixture stays in the disposable database; migration-replay destroys it.
  if (adminConnected) await admin.end();
  if (appConnected) await app.end();
}
