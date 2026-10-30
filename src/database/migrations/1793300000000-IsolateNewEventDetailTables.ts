import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cierra el acceso Data API que reabrió la creación de tablas de detalle
 * posteriores a IsolateDomainAccessToAppRole.
 *
 * `evento_baja` y `evento_movimiento` concedieron DML a `authenticated` y
 * ataron la política a ese rol. `evento_tratamiento` y
 * `evento_produccion_leche` ya nacieron solo para `resdigital_app`; esta
 * migración las reafirma para que las cuatro queden en el mismo contrato.
 */
const DETAIL_TABLES = [
  'evento_baja',
  'evento_movimiento',
  'evento_produccion_leche',
  'evento_tratamiento',
] as const;

export class IsolateNewEventDetailTables1793300000000
  implements MigrationInterface
{
  name = 'IsolateNewEventDetailTables1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of DETAIL_TABLES) {
      await queryRunner.query(`
        REVOKE ALL PRIVILEGES ON TABLE public."${table}"
          FROM PUBLIC, anon, authenticated;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."${table}"
          TO resdigital_app;
        ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "${table}_isolation_policy" ON public."${table}";
        CREATE POLICY "${table}_isolation_policy" ON public."${table}"
          AS PERMISSIVE
          FOR ALL
          TO resdigital_app
          USING (EXISTS (
            SELECT 1 FROM public.evento e
            WHERE e.id = ${table}.evento_id
              AND e.tenant_id = COALESCE(
                NULLIF(current_setting('app.current_tenant_id', true), ''),
                auth.jwt() ->> 'tenant_id'
              )::uuid
          ))
          WITH CHECK (EXISTS (
            SELECT 1 FROM public.evento e
            WHERE e.id = ${table}.evento_id
              AND e.tenant_id = COALESCE(
                NULLIF(current_setting('app.current_tenant_id', true), ''),
                auth.jwt() ->> 'tenant_id'
              )::uuid
          ));
      `);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    throw new Error(
      'No se revierte el aislamiento de las tablas de detalle; use una migración correctiva para conservar las barreras de acceso.',
    );
  }
}
