import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRITICAL_TABLES,
  evaluateSecuritySnapshot,
} from '../security-verify.mjs';

const expectedStorage = [
  ['animal_docs_select_tenant', 'SELECT', 'qual'],
  ['animal_docs_insert_tenant', 'INSERT', 'with_check'],
  ['animal_docs_delete_tenant', 'DELETE', 'qual'],
].map(([policyname, cmd, predicateField]) => ({
  policyname,
  cmd,
  roles: ['authenticated'],
  [predicateField]: "bucket_id = 'animal_docs' AND split_part(name, '/', 1) = (auth.jwt() ->> 'tenant_id') AND name ~* '(pdf|png|jpg)'",
}));

function safeSnapshot() {
  return {
    identity: {
      current_user: 'resdigital_app',
      rolsuper: false,
      rolbypassrls: false,
      has_memberships: false,
      can_create_public: false,
      owns_table: false,
      can_assume_authenticated: false,
    },
    tables: CRITICAL_TABLES.map((relname) => ({
      relname,
      rls_enabled: true,
      rls_forced: true,
      anon_privileges: false,
      authenticated_privileges: false,
      public_acl: false,
    })),
    policies: CRITICAL_TABLES.map((tablename) => ({
      schemaname: 'public',
      tablename,
      policyname: `${tablename}_tenant_policy`,
      cmd: 'ALL',
      roles: ['resdigital_app'],
      qual: "tenant_id = (auth.jwt() ->> 'tenant_id')",
      with_check: "tenant_id = (auth.jwt() ->> 'tenant_id')",
    })),
    storagePolicies: [...expectedStorage],
    migrationTableExists: true,
    appliedMigrationNames: ['MigrationOne'],
    bucket: {
      id: 'animal_docs',
      public: false,
      file_size_limit: 10 * 1024 * 1024,
      allowed_mime_types: ['application/pdf', 'image/jpeg', 'image/png'],
    },
  };
}

test('accepts a fully hardened security snapshot', () => {
  assert.deepEqual(evaluateSecuritySnapshot(safeSnapshot(), ['MigrationOne']), []);
});

test('fails closed for elevated runtime role, missing RLS, and client grants', () => {
  const snapshot = safeSnapshot();
  snapshot.identity.rolbypassrls = true;
  snapshot.tables[0].rls_forced = false;
  snapshot.tables[1].anon_privileges = true;
  assert.deepEqual(evaluateSecuritySnapshot(snapshot, ['MigrationOne']), [
    'runtime-role',
    'critical-table-rls-and-grants',
  ]);
});

test('fails closed for broad tenant policies and missing Storage policies', () => {
  const snapshot = safeSnapshot();
  snapshot.policies[0].qual = 'true';
  snapshot.storagePolicies.pop();
  assert.deepEqual(evaluateSecuritySnapshot(snapshot, ['MigrationOne']), [
    'tenant-scoped-domain-policies',
    'private-storage-policies',
  ]);
});

test('fails closed for pending migrations and unsafe bucket configuration', () => {
  const snapshot = safeSnapshot();
  snapshot.bucket.public = true;
  snapshot.bucket.file_size_limit = 1024;
  snapshot.bucket.allowed_mime_types = ['image/*'];
  assert.deepEqual(evaluateSecuritySnapshot(snapshot, ['MigrationOne', 'MigrationTwo']), [
    'migration-history',
    'animal-docs-bucket',
  ]);
});
