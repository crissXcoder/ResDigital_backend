import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEventoMovimientoTable1791330000000
  implements MigrationInterface
{
  name = 'CreateEventoMovimientoTable1791330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Crear tabla de detalle para movimientos de potrero (MOD-05)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.evento_movimiento (
        evento_id UUID PRIMARY KEY REFERENCES public.evento(id) ON DELETE RESTRICT,
        potrero_origen_id UUID REFERENCES public.potrero(id) ON DELETE RESTRICT,
        potrero_destino_id UUID NOT NULL REFERENCES public.potrero(id) ON DELETE RESTRICT,
        motivo TEXT
      );
    `);

    // 2. Índices para acelerar búsquedas de auditoría por potrero
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_evento_movimiento_potrero_origen
        ON public.evento_movimiento (potrero_origen_id);

      CREATE INDEX IF NOT EXISTS idx_evento_movimiento_potrero_destino
        ON public.evento_movimiento (potrero_destino_id);
    `);

    // 3. Permisos explícitos según el estándar de aislamiento del proyecto
    await queryRunner.query(`
      REVOKE ALL PRIVILEGES ON TABLE public.evento_movimiento
        FROM PUBLIC, anon, authenticated;

      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.evento_movimiento
        TO authenticated;

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resdigital_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.evento_movimiento
            TO resdigital_app;
        END IF;
      END
      $$;
    `);

    // 4. Habilitar y forzar Row Level Security
    await queryRunner.query(`
      ALTER TABLE public.evento_movimiento ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.evento_movimiento FORCE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS evento_movimiento_isolation_policy ON public.evento_movimiento;
      CREATE POLICY evento_movimiento_isolation_policy ON public.evento_movimiento
        AS PERMISSIVE
        FOR ALL
        TO authenticated, resdigital_app
        USING (EXISTS (
          SELECT 1 FROM public.evento e
          WHERE e.id = evento_movimiento.evento_id
            AND e.tenant_id = COALESCE(
              NULLIF(current_setting('app.current_tenant_id', true), ''),
              auth.jwt() ->> 'tenant_id'
            )::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e
          WHERE e.id = evento_movimiento.evento_id
            AND e.tenant_id = COALESCE(
              NULLIF(current_setting('app.current_tenant_id', true), ''),
              auth.jwt() ->> 'tenant_id'
            )::uuid
        ));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS evento_movimiento_isolation_policy ON public.evento_movimiento;
      DROP TABLE IF EXISTS public.evento_movimiento;
    `);
  }
}
