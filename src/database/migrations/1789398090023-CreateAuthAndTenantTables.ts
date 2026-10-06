import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthAndTenantTables1789398090023
  implements MigrationInterface
{
  name = 'CreateAuthAndTenantTables1789398090023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Crear tipo enum rol_usuario
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rol_usuario') THEN
          CREATE TYPE public.rol_usuario AS ENUM (
            'propietario',
            'administrador',
            'peon',
            'veterinario'
          );
        END IF;
      END
      $$;
    `);

    // 2. Crear tabla tenant
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.tenant (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre_finca TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // 3. Crear tabla usuario vinculada 1:1 a auth.users(id)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.usuario (
        id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE RESTRICT,
        nombre_completo TEXT NOT NULL,
        correo TEXT NOT NULL UNIQUE,
        rol public.rol_usuario NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Índices de rendimiento
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_usuario_tenant_id ON public.usuario(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_usuario_correo ON public.usuario(correo);
    `);

    // 4. Activar y forzar Row Level Security (RLS) en ambas tablas
    await queryRunner.query(`
      ALTER TABLE public.tenant ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.tenant FORCE ROW LEVEL SECURITY;

      ALTER TABLE public.usuario ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.usuario FORCE ROW LEVEL SECURITY;
    `);

    // 5. Políticas de aislamiento multi-tenant
    // Política para tenant: solo visible y modificable si su id coincide con el tenant_id del JWT
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation_policy ON public.tenant;
      CREATE POLICY tenant_isolation_policy ON public.tenant
        FOR ALL
        TO authenticated
        USING (id = (auth.jwt() ->> 'tenant_id')::uuid)
        WITH CHECK (id = (auth.jwt() ->> 'tenant_id')::uuid);
    `);

    // Política para usuario: solo puede ver y modificar filas de su propio tenant_id
    await queryRunner.query(`
      DROP POLICY IF EXISTS usuario_isolation_policy ON public.usuario;
      CREATE POLICY usuario_isolation_policy ON public.usuario
        FOR ALL
        TO authenticated
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
        WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
    `);

    // Política para permitir que el servicio de autenticación (supabase_auth_admin)
    // consulte usuario durante la ejecución del Custom Access Token Hook
    await queryRunner.query(`
      DROP POLICY IF EXISTS auth_admin_read_usuario_policy ON public.usuario;
      CREATE POLICY auth_admin_read_usuario_policy ON public.usuario
        AS PERMISSIVE
        FOR SELECT
        TO supabase_auth_admin
        USING (true);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Eliminar políticas RLS
    await queryRunner.query(`
      DROP POLICY IF EXISTS auth_admin_read_usuario_policy ON public.usuario;
      DROP POLICY IF EXISTS usuario_isolation_policy ON public.usuario;
      DROP POLICY IF EXISTS tenant_isolation_policy ON public.tenant;
    `);

    // 2. Desactivar RLS
    await queryRunner.query(`
      ALTER TABLE public.usuario NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.usuario DISABLE ROW LEVEL SECURITY;

      ALTER TABLE public.tenant NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.tenant DISABLE ROW LEVEL SECURITY;
    `);

    // 3. Eliminar índices
    await queryRunner.query(`
      DROP INDEX IF EXISTS public.idx_usuario_correo;
      DROP INDEX IF EXISTS public.idx_usuario_tenant_id;
    `);

    // 4. Eliminar tablas
    await queryRunner.query(`
      DROP TABLE IF EXISTS public.usuario;
      DROP TABLE IF EXISTS public.tenant;
    `);

    // 5. Eliminar tipo enum
    await queryRunner.query(`
      DROP TYPE IF EXISTS public.rol_usuario;
    `);
  }
}
