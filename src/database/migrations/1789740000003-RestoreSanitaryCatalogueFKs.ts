import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repone las FK e índices de `tenant_id` en los catálogos sanitarios.
 *
 * Es la pareja obligatoria de la corrección hecha en
 * CreateSanitaryCatalogues1726451077000, que tuvo que dejar de declarar la FK
 * en línea porque su timestamp ordena antes de la migración que crea
 * `public.tenant`.
 *
 * Esta migración converge los dos escenarios en el mismo esquema final:
 *
 *  - Base limpia: las tablas se crearon sin FK, acá se agregan.
 *  - Base ya migrada: Potreros1789665361014 había eliminado esas FK y esos
 *    índices y nunca los repuso, así que acá vuelven.
 */

const RESTAURACIONES = [
  {
    tabla: 'catalogo_medicamento',
    constraint: 'catalogo_medicamento_tenant_id_fkey',
    indice: 'idx_catalogo_medicamento_tenant_id',
  },
  {
    tabla: 'catalogo_padecimiento',
    constraint: 'catalogo_padecimiento_tenant_id_fkey',
    indice: 'idx_catalogo_padecimiento_tenant_id',
  },
];

export class RestoreSanitaryCatalogueFKs1789740000003 implements MigrationInterface {
  name = 'RestoreSanitaryCatalogueFKs1789740000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { tabla, constraint, indice } of RESTAURACIONES) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${constraint}') THEN
            ALTER TABLE public.${tabla}
              ADD CONSTRAINT ${constraint}
              FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE RESTRICT;
          END IF;
        END $$;
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS ${indice} ON public.${tabla}(tenant_id);
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { tabla, constraint, indice } of RESTAURACIONES) {
      await queryRunner.query(`DROP INDEX IF EXISTS public.${indice};`);
      await queryRunner.query(
        `ALTER TABLE public.${tabla} DROP CONSTRAINT IF EXISTS ${constraint};`,
      );
    }
  }
}
