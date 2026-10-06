import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSanitaryCatalogues1726451077000 implements MigrationInterface {
  name = 'CreateSanitaryCatalogues1726451077000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // NOTA DE ORDEN (corrección de idempotencia, no cambia el estado de ninguna
    // base ya migrada): el timestamp de esta migración (1726451077000) ordena
    // ANTES de CreateAuthAndTenantTables1789398090023, que es la que crea
    // public.tenant. Con la FK declarada en línea, una base limpia fallaba acá.
    // No se puede re-timestampar sin romper las bases ya migradas, así que la
    // FK se saca de acá y la repone RestoreSanitaryCatalogueFKs1789740000003.
    // En la base compartida esas FK ya habían sido eliminadas por
    // Potreros1789665361014 y nunca repuestas, así que la migración nueva deja
    // ambos escenarios en el mismo estado final.

    // 1. Crear tabla catalogo_medicamento
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.catalogo_medicamento (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        nombre_comercial TEXT NOT NULL,
        principio_activo TEXT,
        via_administracion TEXT,
        dias_retiro_leche_default INT NOT NULL DEFAULT 0,
        dias_retiro_carne_default INT NOT NULL DEFAULT 0
      );
    `);

    // Índice para consultas filtradas por tenant
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_catalogo_medicamento_tenant_id
        ON public.catalogo_medicamento(tenant_id);
    `);

    // 2. Crear tabla catalogo_padecimiento
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.catalogo_padecimiento (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        nombre TEXT NOT NULL,
        categoria TEXT,
        medicamento_sugerido_id UUID REFERENCES public.catalogo_medicamento(id) ON DELETE SET NULL
      );
    `);

    // Índice para consultas filtradas por tenant
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_catalogo_padecimiento_tenant_id
        ON public.catalogo_padecimiento(tenant_id);
    `);

    // 3. Activar y forzar Row Level Security en ambas tablas
    await queryRunner.query(`
      ALTER TABLE public.catalogo_medicamento ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.catalogo_medicamento FORCE ROW LEVEL SECURITY;

      ALTER TABLE public.catalogo_padecimiento ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.catalogo_padecimiento FORCE ROW LEVEL SECURITY;
    `);

    // 4. Políticas de aislamiento multi-tenant (mismo patrón que tenant/usuario)
    await queryRunner.query(`
      DROP POLICY IF EXISTS catalogo_medicamento_isolation_policy ON public.catalogo_medicamento;
    `);
    await queryRunner.query(`
      CREATE POLICY catalogo_medicamento_isolation_policy
        ON public.catalogo_medicamento
        FOR ALL
        TO authenticated
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
        WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
    `);

    await queryRunner.query(`
      DROP POLICY IF EXISTS catalogo_padecimiento_isolation_policy ON public.catalogo_padecimiento;
    `);
    await queryRunner.query(`
      CREATE POLICY catalogo_padecimiento_isolation_policy
        ON public.catalogo_padecimiento
        FOR ALL
        TO authenticated
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
        WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Eliminar políticas RLS
    await queryRunner.query(`
      DROP POLICY IF EXISTS catalogo_padecimiento_isolation_policy ON public.catalogo_padecimiento;
      DROP POLICY IF EXISTS catalogo_medicamento_isolation_policy ON public.catalogo_medicamento;
    `);

    // 2. Desactivar RLS
    await queryRunner.query(`
      ALTER TABLE public.catalogo_padecimiento NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.catalogo_padecimiento DISABLE ROW LEVEL SECURITY;

      ALTER TABLE public.catalogo_medicamento NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.catalogo_medicamento DISABLE ROW LEVEL SECURITY;
    `);

    // 3. Eliminar índices
    await queryRunner.query(`
      DROP INDEX IF EXISTS public.idx_catalogo_padecimiento_tenant_id;
      DROP INDEX IF EXISTS public.idx_catalogo_medicamento_tenant_id;
    `);

    // 4. Eliminar tablas (padecimiento primero por la FK a medicamento)
    await queryRunner.query(`
      DROP TABLE IF EXISTS public.catalogo_padecimiento;
      DROP TABLE IF EXISTS public.catalogo_medicamento;
    `);
  }
}
