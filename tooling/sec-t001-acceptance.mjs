import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import pg from 'pg';

// Opt-in: creates only labelled test accounts/tenants, then removes them.
// Never run the general integration suites against the shared database.
process.loadEnvFile('.env');
if (process.env.SEC_T001_ALLOW_REMOTE_FIXTURES !== 'true') {
  throw new Error(
    'Se requiere SEC_T001_ALLOW_REMOTE_FIXTURES=true para las fixtures remotas.',
  );
}
const supabase = required('SUPABASE_URL').replace(/\/+$/, '');
const adminKey = required('SUPABASE_SERVICE_ROLE_KEY');
const publicKey = required('SUPABASE_ANON_KEY');
const databaseUrl = required('DATABASE_URL');
const api = process.env.SEC_T001_API_URL ?? 'http://localhost:39111';
const web = process.env.SEC_T001_WEB_URL ?? 'http://localhost:39110';
let dbUrl;
try {
  dbUrl = new URL(databaseUrl);
  decodeURIComponent(dbUrl.password);
} catch {
  // Never let Node render ERR_INVALID_URL.input with a connection secret.
  throw new Error(
    'DATABASE_URL inválida; revisar formato sin compartir su valor.',
  );
}
assert.equal(new URL(supabase).hostname, 'jchrtqgzvidlcezzhols.supabase.co');
assert.equal(
  decodeURIComponent(dbUrl.username),
  'resdigital_app.jchrtqgzvidlcezzhols',
);
for (const local of [api, web]) {
  assert.ok(
    ['localhost', '127.0.0.1'].includes(new URL(local).hostname),
    'Nest y Next deben ser locales.',
  );
}

const marker = `SEC-T001-${randomUUID()}`;
const accounts = [];
const tenants = [];
const checks = [];
const redactions = [
  adminKey,
  publicKey,
  databaseUrl,
  decodeURIComponent(dbUrl.password),
];
const client = new pg.Client({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10000,
  ssl: process.env.DATABASE_CA_CERT
    ? { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT }
    : { rejectUnauthorized: false },
});
let connected = false;
let browser;
let failure;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}.`);
  return value;
}

function record(name) {
  checks.push(name);
  console.log(`CUMPLE: ${name}`);
}

async function request(
  url,
  { token, admin = false, method = 'GET', body } = {},
) {
  const headers = { 'content-type': 'application/json' };
  if (url.startsWith(`${supabase}/`))
    headers.apikey = admin ? adminKey : publicKey;
  if (admin || token)
    headers.authorization = `Bearer ${admin ? adminKey : token}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

function expectStatus(result, status, description) {
  assert.equal(
    result.status,
    status,
    `${description}: HTTP ${result.status}, esperado ${status}`,
  );
}

async function createAccount(role, tenantId) {
  const password = randomBytes(36).toString('base64url');
  redactions.push(password);
  const email = `sec-t001-${randomUUID()}@example.com`;
  const result = await request(`${supabase}/auth/v1/admin/users`, {
    admin: true,
    method: 'POST',
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre_completo: marker, nombre_finca: marker },
      ...(tenantId ? { app_metadata: { tenant_id: tenantId, rol: role } } : {}),
    },
  });
  expectStatus(
    result,
    200,
    'Crear cuenta de prueba confirmada, sin enviar correo',
  );
  const created = result.data?.user ?? result.data;
  assert.equal(created.email, email);
  assert.equal(created.user_metadata?.nombre_completo, marker);
  assert.equal(typeof created.id, 'string');
  const account = { id: created.id, email, password, role };
  accounts.push(account);
  let profile = await request(
    `${supabase}/rest/v1/usuario?id=eq.${account.id}&select=id,tenant_id,rol`,
    { admin: true },
  );
  expectStatus(profile, 200, 'Consultar únicamente perfil de fixture');
  assert.equal(profile.data.length, 1);
  account.tenantId = profile.data[0].tenant_id;
  if (account.tenantId !== tenantId) {
    const finca = await request(
      `${supabase}/rest/v1/tenant?id=eq.${account.tenantId}&select=id,nombre_finca`,
      { admin: true },
    );
    expectStatus(finca, 200, 'Comprobar finca creada por trigger');
    assert.equal(finca.data[0]?.nombre_finca, marker);
    tenants.push(account.tenantId);
  }
  if (tenantId) {
    // GoTrue may insert Auth before assigning app_metadata. Prepare test-only
    // memberships through the protected admin channel, never through a user JWT.
    expectStatus(
      await request(
        `${supabase}/rest/v1/usuario?id=eq.${account.id}&nombre_completo=eq.${marker}`,
        {
          admin: true,
          method: 'PATCH',
          body: { tenant_id: tenantId, rol: role },
        },
      ),
      204,
      'Asignar únicamente pertenencia/rol de fixture creada por esta ejecución',
    );
    profile = await request(
      `${supabase}/rest/v1/usuario?id=eq.${account.id}&select=id,tenant_id,rol`,
      { admin: true },
    );
    expectStatus(profile, 200, 'Verificar pertenencia de fixture');
    assert.equal(profile.data[0]?.tenant_id, tenantId);
    account.tenantId = tenantId;
  }
  assert.equal(profile.data[0]?.rol, role);
  const login = await request(`${supabase}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    body: { email, password },
  });
  expectStatus(login, 200, `Login Auth real: ${role}`);
  account.token = login.data.access_token;
  assert.equal(typeof account.token, 'string');
  redactions.push(account.token, login.data.refresh_token);
  const claims = decodeJwt(account.token);
  assert.equal(decodeProtectedHeader(account.token).alg, 'ES256');
  assert.equal(claims.rol, role, 'El hook emitió rol real');
  assert.equal(
    claims.tenant_id,
    account.tenantId,
    'El hook emitió tenant real',
  );
  assert.equal(claims.sub, account.id);
  return account;
}

async function scoped(account, action) {
  await client.query('BEGIN');
  try {
    await client.query(
      "SELECT set_config('request.jwt.claims',$1,true), set_config('app.current_tenant_id',$2,true)",
      [
        JSON.stringify({
          sub: account.id,
          rol: account.role,
          tenant_id: account.tenantId,
        }),
        account.tenantId,
      ],
    );
    return await action();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function cleanup() {
  const errors = [];
  // Auth can persist a user before its HTTP response reaches the test runner.
  try {
    for (let page = 1; ; page += 1) {
      const listed = await request(
        `${supabase}/auth/v1/admin/users?page=${page}&per_page=100`,
        { admin: true },
      );
      expectStatus(listed, 200, 'Recuperar exclusivamente cuentas marcadas');
      const users = listed.data.users;
      assert.ok(Array.isArray(users));
      for (const user of users) {
        if (
          user.user_metadata?.nombre_completo === marker &&
          user.email?.startsWith('sec-t001-') &&
          user.email.endsWith('@example.com') &&
          !accounts.some((account) => account.id === user.id)
        )
          accounts.push({ id: user.id });
      }
      if (users.length < 100) break;
    }
  } catch {
    errors.push('localización de cuentas de esta ejecución');
  }
  // Recover trigger-created tenants even if profile verification failed midway.
  try {
    const labelled = await request(
      `${supabase}/rest/v1/tenant?nombre_finca=eq.${marker}&select=id,nombre_finca`,
      { admin: true },
    );
    expectStatus(
      labelled,
      200,
      'Localizar únicamente fincas de esta ejecución',
    );
    for (const tenant of labelled.data) {
      assert.equal(tenant.nombre_finca, marker);
      if (!tenants.includes(tenant.id)) tenants.push(tenant.id);
    }
  } catch {
    errors.push('localización de fincas de esta ejecución');
  }
  // IDs belong exclusively to fixtures of this run; no unbounded DELETE.
  for (const id of tenants) {
    try {
      expectStatus(
        await request(`${supabase}/rest/v1/potrero?tenant_id=eq.${id}`, {
          admin: true,
          method: 'DELETE',
        }),
        204,
        'Limpiar potreros de finca de prueba',
      );
    } catch {
      errors.push('potreros');
    }
  }
  for (const account of [...accounts].reverse()) {
    try {
      const removed = await request(
        `${supabase}/auth/v1/admin/users/${account.id}`,
        { admin: true, method: 'DELETE' },
      );
      assert.ok([200, 404].includes(removed.status));
      expectStatus(
        await request(`${supabase}/auth/v1/admin/users/${account.id}`, {
          admin: true,
        }),
        404,
        'Cuenta de prueba eliminada',
      );
      const remaining = await request(
        `${supabase}/rest/v1/usuario?id=eq.${account.id}&select=id`,
        { admin: true },
      );
      expectStatus(remaining, 200, 'Verificar limpieza del perfil');
      assert.equal(remaining.data.length, 0);
    } catch {
      errors.push('cuentas/perfiles');
    }
  }
  for (const id of tenants) {
    try {
      expectStatus(
        await request(`${supabase}/rest/v1/tenant?id=eq.${id}`, {
          admin: true,
          method: 'DELETE',
        }),
        204,
        'Limpiar finca de prueba',
      );
      const remaining = await request(
        `${supabase}/rest/v1/tenant?id=eq.${id}&select=id`,
        { admin: true },
      );
      expectStatus(remaining, 200, 'Verificar limpieza de finca');
      assert.equal(remaining.data.length, 0);
    } catch {
      errors.push('fincas');
    }
  }
  if (errors.length)
    throw new Error(
      `Limpieza incompleta de fixtures ${marker}: ${errors.join(', ')}`,
    );
  record('Fixtures Auth, perfiles, potreros y fincas eliminadas y verificadas');
}

try {
  await client.connect();
  connected = true;
  const {
    rows: [identity],
  } = await client.query(
    `SELECT session_user::text AS session_role,current_user::text AS current_role,rolsuper,rolbypassrls,rolinherit,has_schema_privilege(current_user,'public','CREATE') AS can_create FROM pg_roles WHERE rolname=current_user`,
  );
  assert.deepEqual(identity, {
    session_role: 'resdigital_app',
    current_role: 'resdigital_app',
    rolsuper: false,
    rolbypassrls: false,
    rolinherit: false,
    can_create: false,
  });
  record('Conexión runtime real resdigital_app sin privilegios elevados');
  expectStatus(
    await request(`${api}/auth/perfil`),
    401,
    'Nest sin JWT falla cerrado',
  );
  const ownerA = await createAccount('propietario');
  const ownerB = await createAccount('propietario');
  const adminA = await createAccount('administrador', ownerA.tenantId);
  const peonA = await createAccount('peon', ownerA.tenantId);
  const vetA = await createAccount('veterinario', ownerA.tenantId);
  record(
    'Alta aislada/trigger y login Auth real; hook ES256 de cuatro roles y dos fincas',
  );

  const tables = [
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
  ];
  for (const account of [ownerA, adminA, peonA, vetA]) {
    for (const table of tables) {
      const result = await request(
        `${supabase}/rest/v1/${table}?select=*&limit=1`,
        { token: account.token },
      );
      assert.ok(
        [401, 403].includes(result.status),
        `Data API debe denegar ${account.role}/${table}: HTTP ${result.status}`,
      );
      assert.equal(
        result.data?.code,
        '42501',
        'Denegación SQL, no error de esquema ni validación',
      );
    }
    const abuse = await request(
      `${supabase}/rest/v1/usuario?id=eq.${peonA.id}`,
      {
        token: account.token,
        method: 'PATCH',
        body: { rol: 'propietario' },
      },
    );
    assert.ok([401, 403].includes(abuse.status), 'PATCH directo prohibido');
    assert.equal(abuse.data?.code, '42501');
  }
  for (const table of tables) {
    const result = await request(
      `${supabase}/rest/v1/${table}?select=*&limit=1`,
    );
    assert.ok([401, 403].includes(result.status));
    assert.equal(result.data?.code, '42501');
  }
  const stored = await request(
    `${supabase}/rest/v1/usuario?id=eq.${peonA.id}&select=rol`,
    { admin: true },
  );
  expectStatus(stored, 200, 'Verificar rol tras abuso');
  assert.equal(stored.data[0]?.rol, 'peon');
  record(
    'Data API remota: 17 tablas bloqueadas para anon y cuatro JWT reales; PATCH denegado y peón sin cambios',
  );

  for (const account of accounts) {
    const profile = await request(`${api}/auth/perfil`, {
      token: account.token,
    });
    expectStatus(profile, 200, `Perfil Nest de ${account.role}`);
    assert.equal(profile.data.userId, account.id);
    assert.equal(profile.data.tenantId, account.tenantId);
    assert.equal(profile.data.rol, account.role);
    assert.equal(profile.data.nombreCompleto, marker);
  }
  const potrero = {
    nombre: marker,
    areaHa: 1,
    capacidadRecomendadaUaHa: 1,
    diasDescansoRecomendados: 15,
  };
  const createdA = await request(`${api}/potreros`, {
    token: ownerA.token,
    method: 'POST',
    body: potrero,
  });
  expectStatus(createdA, 201, 'Propietario crea potrero por Nest');
  const createdB = await request(`${api}/potreros`, {
    token: ownerB.token,
    method: 'POST',
    body: potrero,
  });
  expectStatus(createdB, 201, 'Segunda finca crea potrero por Nest');
  assert.equal(createdA.data.tenantId, ownerA.tenantId);
  assert.equal(createdB.data.tenantId, ownerB.tenantId);
  const potreroId = createdA.data.id;
  expectStatus(
    await request(`${api}/potreros/${potreroId}`, {
      token: adminA.token,
      method: 'PATCH',
      body: { notas: marker },
    }),
    200,
    'Administrador modifica recurso propio',
  );
  for (const account of [peonA, vetA]) {
    expectStatus(
      await request(`${api}/potreros`, {
        token: account.token,
        method: 'POST',
        body: potrero,
      }),
      403,
      `${account.role} no crea potrero`,
    );
    expectStatus(
      await request(`${api}/potreros/${potreroId}`, {
        token: account.token,
        method: 'PATCH',
        body: { notas: 'ABUSO SEC-T001' },
      }),
      403,
      `${account.role} no modifica potrero`,
    );
  }
  expectStatus(
    await request(`${api}/potreros/${potreroId}`, { token: ownerB.token }),
    404,
    'Finca B no consulta recurso de A',
  );
  expectStatus(
    await request(`${api}/potreros/${potreroId}`, {
      token: ownerB.token,
      method: 'PATCH',
      body: { notas: 'ABUSO ENTRE FINCAS' },
    }),
    404,
    'Finca B no modifica recurso de A',
  );
  const concurrent = await Promise.all(
    Array.from({ length: 12 }, (_, index) => {
      const account = index % 2 ? ownerA : ownerB;
      return request(`${api}/potreros`, { token: account.token }).then(
        (result) => {
          expectStatus(result, 200, 'Lectura concurrente Nest');
          assert.equal(result.data.length, 1);
          assert.ok(
            result.data.every((row) => row.tenantId === account.tenantId),
          );
        },
      );
    }),
  );
  assert.equal(concurrent.length, 12);
  record(
    'Nest real: perfil de cuatro roles, escritura permitida/prohibida, acceso cruzado denegado y pool concurrente aislado',
  );

  await scoped(ownerA, async () => {
    const visible = await client.query('SELECT id FROM public.potrero');
    assert.deepEqual(
      visible.rows.map((row) => row.id),
      [potreroId],
    );
    const denied = await client.query(
      'UPDATE public.potrero SET notas=$1 WHERE id=$2',
      ['ABUSO RLS', createdB.data.id],
    );
    assert.equal(denied.rowCount, 0);
    await assert.rejects(
      client.query(
        'INSERT INTO public.potrero (tenant_id,nombre,area_ha,capacidad_recomendada_ua_ha,dias_descanso_recomendados) VALUES ($1,$2,1,1,1)',
        [ownerB.tenantId, marker],
      ),
      (error) => error.code === '42501',
    );
  });
  assert.equal(
    (await client.query('SELECT id FROM public.potrero')).rowCount,
    0,
  );
  record(
    'RLS con credencial runtime real: lectura propia, UPDATE/INSERT cruzados denegados y contexto eliminado tras rollback',
  );

  if (process.env.SEC_T001_BROWSER === 'true') {
    const requireFrontend = createRequire(
      new URL('../../frontend/package.json', import.meta.url),
    );
    const { chromium, expect } = requireFrontend('@playwright/test');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(`${web}/potreros`);
    await expect(page).toHaveURL(/\/login/);
    await page.locator('#correo').fill(ownerA.email);
    await page.locator('#password').fill(randomBytes(30).toString('hex'));
    await page
      .getByRole('button', { name: 'Iniciar Sesión', exact: true })
      .click();
    await expect(
      page.getByRole('alert').filter({
        hasText: 'Correo o contraseña incorrectos.',
      }),
    ).toBeVisible({ timeout: 30000 });
    await page.locator('#password').fill(ownerA.password);
    await page
      .getByRole('button', { name: 'Iniciar Sesión', exact: true })
      .click();
    await expect(page).toHaveURL(/\/potreros/, { timeout: 60000 });
    const refreshed = page.waitForResponse(
      (response) =>
        response.url() === `${api}/potreros` &&
        response.request().method() === 'GET',
      { timeout: 60000 },
    );
    await page.reload();
    const response = await refreshed;
    assert.equal(response.status(), 200);
    const browserRows = await response.json();
    assert.equal(browserRows.length, 1);
    assert.equal(browserRows[0].id, potreroId);
    await expect(page.getByText(marker, { exact: true }).first()).toBeVisible({
      timeout: 30000,
    });
    const evidence = required('SEC_T001_EVIDENCE_DIR');
    await page.screenshot({
      path: resolve(evidence, 'sec-t001-potreros-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByText(marker, { exact: true }).first()).toBeVisible();
    await page.screenshot({
      path: resolve(evidence, 'sec-t001-potreros-mobile.png'),
      fullPage: true,
    });
    record(
      'Chromium real: ruta protegida, error de login, login Supabase, lectura Nest de finca propia y vistas desktop/375px',
    );
    await context.close();
  }
} catch (error) {
  failure = error;
} finally {
  const finalErrors = [];
  if (browser) {
    try {
      await browser.close();
    } catch {
      finalErrors.push('No se pudo cerrar Chromium');
    }
  }
  try {
    await cleanup();
  } catch (error) {
    finalErrors.push(error.message);
  }
  if (connected) {
    try {
      await client.end();
    } catch {
      finalErrors.push('No se pudo cerrar PostgreSQL');
    }
  }
  if (failure || finalErrors.length) {
    let message = [failure?.message, ...finalErrors].filter(Boolean).join('\n');
    for (const secret of redactions.filter(Boolean))
      message = message.replaceAll(secret, '[REDACTADO]');
    console.error(`NO CUMPLE: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify({
        status: 'cumple',
        checks,
        browserVerified: process.env.SEC_T001_BROWSER === 'true',
        cleanupVerified: true,
      }),
    );
  }
}
