import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cierra dos hallazgos de auditoría de seguridad (RLS deshabilitado):
 *
 * 1. `migrations` (tabla interna de TypeORM): nunca se consulta vía API/PostgREST,
 *    así que no necesita ninguna política permisiva — solo bloquear el acceso
 *    por defecto a `anon`/`authenticated`. La CLI de migraciones sigue funcionando
 *    porque conecta con el rol dueño de la tabla, no a través de PostgREST.
 *
 * 2. `catalogo_raza`: pasa a ser un catálogo HÍBRIDO global + por tenant.
 *    `tenant_id IS NULL` = raza global (visible para todas las fincas, ej. las
 *    6 razas base de Reglas-de-Negocio-Ganaderas.md). `tenant_id = <finca>` =
 *    raza propia de esa finca (criolla/regional), visible solo para ella.
 *    Se agrega `UNIQUE (nombre)` porque las 11 filas existentes ya tienen
 *    nombres distintos, y porque la migración SeedRazas que sigue a esta
 *    depende de un `ON CONFLICT (nombre)`.
 */
export class SecureCatalogoRazaAndMigrations1789710000000 implements MigrationInterface {
  name = 'SecureCatalogoRazaAndMigrations1789710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. migrations: deny-all por defecto
    await queryRunner.query(`
      ALTER TABLE public.migrations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.migrations FORCE ROW LEVEL SECURITY;
    `);

    // 2. catalogo_raza: UNIQUE(nombre) + RLS híbrido
    // La guarda sobre pg_constraint es una corrección de idempotencia: sin ella
    // un segundo intento (o un replay en base limpia tras un fallo parcial)
    // aborta con "constraint already exists".
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'catalogo_raza_nombre_key'
        ) THEN
          ALTER TABLE public.catalogo_raza
            ADD CONSTRAINT catalogo_raza_nombre_key UNIQUE (nombre);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE public.catalogo_raza ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.catalogo_raza FORCE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS catalogo_raza_select_policy ON public.catalogo_raza;
      CREATE POLICY catalogo_raza_select_policy ON public.catalogo_raza
        FOR SELECT
        TO authenticated
        USING (tenant_id IS NULL OR tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

      DROP POLICY IF EXISTS catalogo_raza_insert_policy ON public.catalogo_raza;
      CREATE POLICY catalogo_raza_insert_policy ON public.catalogo_raza
        FOR INSERT
        TO authenticated
        WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

      DROP POLICY IF EXISTS catalogo_raza_update_policy ON public.catalogo_raza;
      CREATE POLICY catalogo_raza_update_policy ON public.catalogo_raza
        FOR UPDATE
        TO authenticated
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
        WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

      DROP POLICY IF EXISTS catalogo_raza_delete_policy ON public.catalogo_raza;
      CREATE POLICY catalogo_raza_delete_policy ON public.catalogo_raza
        FOR DELETE
        TO authenticated
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS catalogo_raza_delete_policy ON public.catalogo_raza;
      DROP POLICY IF EXISTS catalogo_raza_update_policy ON public.catalogo_raza;
      DROP POLICY IF EXISTS catalogo_raza_insert_policy ON public.catalogo_raza;
      DROP POLICY IF EXISTS catalogo_raza_select_policy ON public.catalogo_raza;

      ALTER TABLE public.catalogo_raza NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.catalogo_raza DISABLE ROW LEVEL SECURITY;

      ALTER TABLE public.catalogo_raza
        DROP CONSTRAINT IF EXISTS catalogo_raza_nombre_key;
    `);

    await queryRunner.query(`
      ALTER TABLE public.migrations NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.migrations DISABLE ROW LEVEL SECURITY;
    `);
  }
}
