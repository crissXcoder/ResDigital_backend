import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEventoBajaTable1791340000000
  implements MigrationInterface
{
  name = 'CreateEventoBajaTable1791340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Crear tabla de detalle para eventos de baja de animal (HATO-T005 / MOD-01)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.evento_baja (
        evento_id UUID PRIMARY KEY REFERENCES public.evento(id) ON DELETE RESTRICT,
        tipo_baja TEXT NOT NULL,
        motivo TEXT,
        precio_venta_crc NUMERIC(12, 2),
        peso_final_kg NUMERIC(6, 1)
      );
    `);

    // 2. Índice para acelerar búsquedas de auditoría por tipo de baja
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_evento_baja_tipo
        ON public.evento_baja (tipo_baja);
    `);

    // 3. Permisos explícitos según el estándar de aislamiento del proyecto
    await queryRunner.query(`
      REVOKE ALL PRIVILEGES ON TABLE public.evento_baja
        FROM PUBLIC, anon, authenticated;

      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.evento_baja
        TO authenticated;

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resdigital_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.evento_baja
            TO resdigital_app;
        END IF;
      END
      $$;
    `);

    // 4. Habilitar y forzar Row Level Security
    await queryRunner.query(`
      ALTER TABLE public.evento_baja ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.evento_baja FORCE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS evento_baja_isolation_policy ON public.evento_baja;
      CREATE POLICY evento_baja_isolation_policy ON public.evento_baja
        AS PERMISSIVE
        FOR ALL
        TO authenticated, resdigital_app
        USING (EXISTS (
          SELECT 1 FROM public.evento e
          WHERE e.id = evento_baja.evento_id
            AND e.tenant_id = COALESCE(
              NULLIF(current_setting('app.current_tenant_id', true), ''),
              auth.jwt() ->> 'tenant_id'
            )::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e
          WHERE e.id = evento_baja.evento_id
            AND e.tenant_id = COALESCE(
              NULLIF(current_setting('app.current_tenant_id', true), ''),
              auth.jwt() ->> 'tenant_id'
            )::uuid
        ));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS evento_baja_isolation_policy ON public.evento_baja;
      DROP TABLE IF EXISTS public.evento_baja;
    `);
  }
}
