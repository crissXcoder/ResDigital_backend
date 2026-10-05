import { MigrationInterface, QueryRunner } from 'typeorm';

const DOMAIN_TABLES = [
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
] as const;

const TENANT_PREDICATE = `tenant_id = COALESCE(
  NULLIF(current_setting('app.current_tenant_id', true), ''),
  auth.jwt() ->> 'tenant_id'
)::uuid`;

const POLICIES: ReadonlyArray<{
  table: string;
  name: string;
  predicate: string;
  command?: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
}> = [
  ...DOMAIN_TABLES.filter(
    (table) =>
      ![
        'animal',
        'catalogo_raza',
        'catalogo_medicamento',
        'catalogo_padecimiento',
        'evento',
        'evento_diagnostico',
        'evento_parto',
        'evento_secado',
        'evento_servicio',
        'tenant',
        'usuario',
      ].includes(table),
  ).map((table) => ({
    table,
    name: `tenant_isolation_${table}`,
    predicate: TENANT_PREDICATE,
  })),
  {
    table: 'animal',
    name: 'tenant_isolation_policy',
    predicate: TENANT_PREDICATE,
  },
  {
    table: 'catalogo_raza',
    name: 'catalogo_raza_select_policy',
    predicate: `tenant_id IS NULL OR ${TENANT_PREDICATE}`,
    command: 'SELECT',
  },
  {
    table: 'catalogo_raza',
    name: 'catalogo_raza_insert_policy',
    predicate: TENANT_PREDICATE,
    command: 'INSERT',
  },
  {
    table: 'catalogo_raza',
    name: 'catalogo_raza_update_policy',
    predicate: TENANT_PREDICATE,
    command: 'UPDATE',
  },
  {
    table: 'catalogo_raza',
    name: 'catalogo_raza_delete_policy',
    predicate: TENANT_PREDICATE,
    command: 'DELETE',
  },
  ...(['catalogo_medicamento', 'catalogo_padecimiento'] as const).map(
    (table) => ({
      table,
      name: `${table}_isolation_policy`,
      predicate: TENANT_PREDICATE,
    }),
  ),
  ...(['evento', 'evento_auth', 'invitacion'] as const).map((table) => ({
    table,
    name: `${table}_isolation_policy`,
    predicate:
      table === 'evento'
        ? TENANT_PREDICATE
        : "tenant_id = (auth.jwt() ->> 'tenant_id')::uuid",
  })),
  ...(
    [
      'evento_diagnostico',
      'evento_parto',
      'evento_secado',
      'evento_servicio',
    ] as const
  ).map((table) => ({
    table,
    name: `${table}_isolation_policy`,
    predicate: `EXISTS (
        SELECT 1 FROM public.evento e
        WHERE e.id = ${table}.evento_id
          AND e.tenant_id = COALESCE(
            NULLIF(current_setting('app.current_tenant_id', true), ''),
            auth.jwt() ->> 'tenant_id'
          )::uuid
      )`,
  })),
  {
    table: 'potrero',
    name: 'potrero_isolation_policy',
    predicate: TENANT_PREDICATE,
  },
  {
    table: 'tenant',
    name: 'tenant_isolation_policy',
    predicate: `id = (auth.jwt() ->> 'tenant_id')::uuid`,
  },
  {
    table: 'usuario',
    name: 'usuario_isolation_policy',
    predicate: TENANT_PREDICATE,
  },
];

/**
 * Limits direct Data API access to non-user roles and gives Nest a dedicated
 * non-owner, non-BYPASSRLS role with tenant-scoped policies.
 */
export class IsolateDomainAccessToAppRole1791160053418 implements MigrationInterface {
  name = 'IsolateDomainAccessToAppRole1791160053418';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resdigital_app') THEN
          CREATE ROLE resdigital_app LOGIN NOINHERIT
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
        IF EXISTS (
          SELECT 1 FROM pg_roles WHERE rolname = 'resdigital_app'
            AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
        ) THEN
          RAISE EXCEPTION 'resdigital_app tiene atributos privilegiados; se deniega la migración';
        END IF;
      END
      $$;
      -- Supabase postgres is not a superuser: validate restricted attributes
      -- instead of issuing ALTER ROLE NOSUPERUSER/NOREPLICATION.
      ALTER ROLE resdigital_app LOGIN NOINHERIT;
      DO $$
      DECLARE membership record;
      BEGIN
        FOR membership IN
          SELECT granted_role.rolname
          FROM pg_auth_members grant_record
          JOIN pg_roles granted_role ON granted_role.oid = grant_record.roleid
          WHERE grant_record.member = (SELECT oid FROM pg_roles WHERE rolname = 'resdigital_app')
        LOOP
          EXECUTE format('REVOKE %I FROM resdigital_app', membership.rolname);
        END LOOP;
      END
      $$;
      GRANT USAGE ON SCHEMA public, auth TO resdigital_app;
      GRANT EXECUTE ON FUNCTION auth.jwt() TO resdigital_app;
    `);

    for (const table of DOMAIN_TABLES) {
      await queryRunner.query(`
        REVOKE ALL PRIVILEGES ON TABLE public."${table}"
          FROM PUBLIC, anon, authenticated;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."${table}"
          TO resdigital_app;
        ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY;
      `);
    }

    for (const policy of POLICIES) {
      const command = policy.command ?? 'ALL';
      const using = command === 'INSERT' ? '' : `USING (${policy.predicate})`;
      const withCheck =
        command === 'SELECT' || command === 'DELETE'
          ? ''
          : `WITH CHECK (${policy.predicate})`;
      await queryRunner.query(`
        DROP POLICY IF EXISTS "${policy.name}" ON public."${policy.table}";
        CREATE POLICY "${policy.name}" ON public."${policy.table}"
          AS PERMISSIVE
          FOR ${command}
          TO resdigital_app
          ${using}
          ${withCheck};
      `);
    }

    // Preserve the Auth hook's direct grants while removing broad future
    // defaults for API roles. Migrations remain the only source of app grants.
    await queryRunner.query(`
      REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, resdigital_app;
      DO $$
      DECLARE creator_name text;
      BEGIN
        FOREACH creator_name IN ARRAY ARRAY['postgres', current_user] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = creator_name) THEN
            EXECUTE format(
              'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated',
              creator_name
            );
            EXECUTE format(
              'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated',
              creator_name
            );
            EXECUTE format(
              'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated',
              creator_name
            );
            EXECUTE format(
              'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated',
              creator_name
            );
          END IF;
        END LOOP;
      END
      $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    throw new Error(
      'SEC-T001 no admite reversión automática; use una migración correctiva para conservar las barreras de acceso y el historial.',
    );
  }
}
