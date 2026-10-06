import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Client } = pg;

export const CRITICAL_TABLES = [
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

function normalizePolicyRoles(roles) {
  if (Array.isArray(roles)) return roles;
  if (typeof roles !== 'string' || !roles.startsWith('{') || !roles.endsWith('}')) {
    return [];
  }
  return roles.slice(1, -1).split(',').filter(Boolean);
}

const EXPECTED_STORAGE_POLICIES = {
  animal_docs_select_tenant: 'SELECT',
  animal_docs_insert_tenant: 'INSERT',
  animal_docs_delete_tenant: 'DELETE',
};

const EXPECTED_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];

export function evaluateSecuritySnapshot(snapshot, expectedMigrations) {
  const failures = [];
  const add = (condition, name) => {
    if (!condition) failures.push(name);
  };

  const identity = snapshot.identity;
  add(
    identity?.current_user === 'resdigital_app' &&
      identity.rolsuper === false &&
      identity.rolbypassrls === false &&
      identity.has_memberships === false &&
      identity.can_create_public === false &&
      identity.owns_table === false &&
      identity.can_assume_authenticated === false,
    'runtime-role',
  );

  const tablesByName = new Map(
    (snapshot.tables ?? []).map((table) => [table.relname, table]),
  );
  add(
    CRITICAL_TABLES.every((name) => {
      const table = tablesByName.get(name);
      return (
        table?.rls_enabled === true &&
        table.rls_forced === true &&
        table.anon_privileges === false &&
        table.authenticated_privileges === false &&
        table.public_acl === false
      );
    }),
    'critical-table-rls-and-grants',
  );

  const policies = snapshot.policies ?? [];
  add(
    CRITICAL_TABLES.every((tableName) => {
      const tablePolicies = policies.filter(
        (policy) =>
          policy.schemaname === 'public' &&
          policy.tablename === tableName,
      );
      const runtimePolicies = tablePolicies.filter((policy) =>
        policy.roles?.includes('resdigital_app'),
      );
      return (
        runtimePolicies.length > 0 &&
        runtimePolicies.every((policy) => {
          const predicates =
            policy.cmd === 'INSERT'
              ? [policy.with_check]
              : policy.cmd === 'SELECT' || policy.cmd === 'DELETE'
                ? [policy.qual]
                : [policy.qual, policy.with_check];
          return (
            predicates.every((predicate) =>
              String(predicate ?? '').includes('tenant_id'),
            ) &&
            !policy.roles.some((role) =>
              ['public', 'anon', 'authenticated'].includes(role),
            )
          );
        })
      );
    }),
    'tenant-scoped-domain-policies',
  );

  const storagePolicies = snapshot.storagePolicies ?? [];
  const policiesByName = new Map(
    storagePolicies.map((policy) => [policy.policyname, policy]),
  );
  add(
    storagePolicies.length === 3 &&
      Object.entries(EXPECTED_STORAGE_POLICIES).every(([name, command]) => {
        const policy = policiesByName.get(name);
        const predicate = `${policy?.qual ?? ''} ${policy?.with_check ?? ''}`;
        return (
          policy?.cmd === command &&
          policy.roles?.length === 1 &&
          policy.roles[0] === 'authenticated' &&
          predicate.includes("bucket_id = 'animal_docs'") &&
          predicate.includes("auth.jwt() ->> 'tenant_id'") &&
          predicate.includes('name ~*') &&
          predicate.includes('(pdf|png|jpg)')
        );
      }),
    'private-storage-policies',
  );

  add(
    snapshot.migrationTableExists === true &&
      expectedMigrations.length > 0 &&
      expectedMigrations.every((name) =>
        snapshot.appliedMigrationNames?.includes(name),
      ),
    'migration-history',
  );

  const bucket = snapshot.bucket;
  add(
    bucket?.id === 'animal_docs' &&
      bucket.public === false &&
      Number(bucket.file_size_limit) === 10 * 1024 * 1024 &&
      Array.isArray(bucket.allowed_mime_types) &&
      [...bucket.allowed_mime_types].sort().join(',') === EXPECTED_MIMES.join(','),
    'animal-docs-bucket',
  );

  return failures;
}

async function expectedMigrationNames(root) {
  const directory = resolve(root, 'dist/database/migrations');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.js'));
  const names = [];
  for (const file of files) {
    const migration = await import(pathToFileURL(resolve(directory, file)).href);
    for (const value of Object.values(migration)) {
      if (typeof value !== 'function') continue;
      const instance = new value();
      if (typeof instance.name === 'string') names.push(instance.name);
    }
  }
  return names;
}

async function readSnapshot(root) {
  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!databaseUrl || !supabaseUrl || !serviceRoleKey) {
    throw new Error('required-config');
  }

  const database = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('supabase')
      ? process.env.DATABASE_CA_CERT
        ? { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT }
        : { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
  });
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let stage = 'database connection';
  let connected = false;
  try {
    await database.connect();
    connected = true;
    stage = 'database role and table catalogs';
    await database.query('BEGIN READ ONLY');
    const { rows: [identity] } = await database.query(`
          SELECT current_user::text AS current_user,
            role.rolsuper,
            role.rolbypassrls,
            EXISTS (SELECT 1 FROM pg_auth_members member WHERE member.member = role.oid) AS has_memberships,
            has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
            EXISTS (
              SELECT 1 FROM pg_class relation
              JOIN pg_namespace schema ON schema.oid = relation.relnamespace
              WHERE schema.nspname = 'public' AND relation.relowner = role.oid
            ) AS owns_table,
            pg_has_role(current_user, 'authenticated', 'MEMBER') AS can_assume_authenticated
          FROM pg_roles role WHERE role.rolname = current_user;
        `);
    const { rows: tables } = await database.query(
          `SELECT relation.relname,
            relation.relrowsecurity AS rls_enabled,
            relation.relforcerowsecurity AS rls_forced,
            has_table_privilege('anon', relation.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_privileges,
            has_table_privilege('authenticated', relation.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authenticated_privileges,
            EXISTS (
              SELECT 1 FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) grant_entry
              WHERE grant_entry.grantee = 0
                AND grant_entry.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
            ) AS public_acl
          FROM pg_class relation JOIN pg_namespace schema ON schema.oid = relation.relnamespace
          WHERE schema.nspname = 'public' AND relation.relname = ANY($1::text[]);`,
          [CRITICAL_TABLES],
        );
    const { rows: policies } = await database.query(
          `SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
           FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[]);`,
          [CRITICAL_TABLES],
        );
    const { rows: [migrationTable] } = await database.query(
          `SELECT to_regclass('public.migrations') IS NOT NULL AS exists;`,
        );

    stage = 'Storage policy catalog';
    const { rows: storagePolicies } = await database.query(`
      SELECT policyname, cmd, roles, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) LIKE '%animal_docs%';
    `);
    for (const policy of [...policies, ...storagePolicies]) {
      policy.roles = normalizePolicyRoles(policy.roles);
    }

    const migrationTableExists = migrationTable.exists;
    let appliedMigrationNames = [];
    if (migrationTableExists) {
      stage = 'migration history catalog';
      try {
        const { rows } = await database.query(
          'SELECT name FROM public.migrations ORDER BY timestamp, name;',
        );
        appliedMigrationNames = rows.map((row) => row.name);
      } catch {
        const { data, error } = await supabase
          .from('migrations')
          .select('name')
          .order('timestamp', { ascending: true });
        if (error || !data) throw new Error('migration history catalog');
        appliedMigrationNames = data.map((row) => row.name);
      }
    }

    stage = 'Supabase Storage bucket metadata';
    const { data: bucket, error } = await supabase.storage.getBucket('animal_docs');
    if (error || !bucket) throw new Error('storage-config');

    stage = 'compiled migration metadata';
    return {
      identity,
      tables,
      policies,
      storagePolicies,
      migrationTableExists,
      appliedMigrationNames,
      bucket,
      expectedMigrations: await expectedMigrationNames(root),
    };
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'unknown';
    throw new Error(`${stage}:${code}`);
  } finally {
    if (connected) {
      await database.query('ROLLBACK').catch(() => {});
      await database.end();
    }
  }
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  try {
    process.loadEnvFile(resolve(root, '.env'));
    const snapshot = await readSnapshot(root);
    const failures = evaluateSecuritySnapshot(
      snapshot,
      snapshot.expectedMigrations,
    );
    if (failures.length > 0) {
      for (const failure of failures) console.error(`FAIL ${failure}`);
      const pendingMigrations = snapshot.expectedMigrations.filter(
        (name) => !snapshot.appliedMigrationNames.includes(name),
      );
      for (const migration of pendingMigrations) {
        console.error(`FAIL unapplied migration: ${migration}`);
      }
      console.error('SECURITY VERIFY: FAIL');
      process.exitCode = 1;
      return;
    }

    console.log('PASS runtime role and elevated attributes');
    console.log(`PASS forced RLS and no client grants (${CRITICAL_TABLES.length} tables)`);
    console.log('PASS tenant-scoped domain and Storage policies');
    console.log(`PASS migration history (${snapshot.expectedMigrations.length} code migrations applied)`);
    console.log('PASS private animal_docs bucket (10 MiB; PDF/PNG/JPEG)');
    console.log('SECURITY VERIFY: PASS');
  } catch (error) {
    const failure = error?.message === 'required-config'
      ? 'required configuration is unavailable'
      : error?.message === 'storage-config'
        ? 'Supabase Storage bucket metadata is inaccessible'
        : error?.message?.startsWith('database connection:')
          ? `database connection is unavailable (${error.message.split(':')[1]})`
        : error?.message?.startsWith('database role and table catalogs:')
          ? 'database role or table security catalog is inaccessible'
          : error?.message?.startsWith('Storage policy catalog:')
            ? 'Storage policy catalog is inaccessible'
            : error?.message?.startsWith('migration history catalog:')
              ? 'migration history catalog is inaccessible'
              : error?.message?.startsWith('Supabase Storage bucket metadata:')
                ? 'Supabase Storage bucket metadata is inaccessible'
                : error?.message?.startsWith('compiled migration metadata:')
                  ? 'compiled migration metadata is inaccessible; run the build first'
                  : 'a required read-only security catalog is inaccessible';
    const safeCode =
      typeof error?.code === 'string' && /^[A-Z0-9_-]+$/.test(error.code)
        ? ` (${error.code})`
        : '';
    console.error(`FAIL ${failure}${safeCode}`);
    console.error('SECURITY VERIFY: FAIL');
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
