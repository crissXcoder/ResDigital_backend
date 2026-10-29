import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FixPartoFiliacionPolicy1793200000000 implements MigrationInterface {
  name = 'FixPartoFiliacionPolicy1793200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS evento_parto_filiacion_tenant ON public.evento_parto;
      CREATE POLICY evento_parto_filiacion_tenant ON public.evento_parto
        AS RESTRICTIVE FOR ALL TO resdigital_app
        USING (
          (cria_animal_id IS NULL OR EXISTS (
            SELECT 1 FROM public.animal a JOIN public.evento e ON e.id = evento_parto.evento_id
            WHERE a.id = evento_parto.cria_animal_id AND a.tenant_id = e.tenant_id
          )) AND
          (cria_anterior_id IS NULL OR EXISTS (
            SELECT 1 FROM public.animal a JOIN public.evento e ON e.id = evento_parto.evento_id
            WHERE a.id = evento_parto.cria_anterior_id AND a.tenant_id = e.tenant_id
          ))
        )
        WITH CHECK (
          (cria_animal_id IS NULL OR EXISTS (
            SELECT 1 FROM public.animal a JOIN public.evento e ON e.id = evento_parto.evento_id
            WHERE a.id = evento_parto.cria_animal_id AND a.tenant_id = e.tenant_id
          )) AND
          (cria_anterior_id IS NULL OR EXISTS (
            SELECT 1 FROM public.animal a JOIN public.evento e ON e.id = evento_parto.evento_id
            WHERE a.id = evento_parto.cria_anterior_id AND a.tenant_id = e.tenant_id
          ))
        );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS evento_parto_filiacion_tenant ON public.evento_parto;
      CREATE POLICY evento_parto_filiacion_tenant ON public.evento_parto
        AS RESTRICTIVE FOR ALL TO resdigital_app
        USING (true)
        WITH CHECK (
          (cria_animal_id IS NULL OR EXISTS (
            SELECT 1 FROM public.animal a JOIN public.evento e ON e.id = evento_parto.evento_id
            WHERE a.id = evento_parto.cria_animal_id AND a.tenant_id = e.tenant_id
          )) AND
          (cria_anterior_id IS NULL OR EXISTS (
            SELECT 1 FROM public.animal a JOIN public.evento e ON e.id = evento_parto.evento_id
            WHERE a.id = evento_parto.cria_anterior_id AND a.tenant_id = e.tenant_id
          ))
        );
    `);
  }
}
