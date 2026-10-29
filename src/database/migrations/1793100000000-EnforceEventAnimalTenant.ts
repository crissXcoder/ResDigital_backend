import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceEventAnimalTenant1793100000000 implements MigrationInterface {
  name = 'EnforceEventAnimalTenant1793100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM public.evento e
          LEFT JOIN public.animal a ON a.id = e.animal_id AND a.tenant_id = e.tenant_id
          WHERE a.id IS NULL
        ) THEN
          RAISE EXCEPTION 'Existen eventos con animales de otra finca o inexistentes; reconciliar antes de migrar';
        END IF;
      END $$;
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM public.evento_parto p
          JOIN public.evento e ON e.id = p.evento_id
          LEFT JOIN public.animal c ON c.id = p.cria_animal_id
          LEFT JOIN public.animal a ON a.id = p.cria_anterior_id
          WHERE c.tenant_id IS DISTINCT FROM e.tenant_id AND p.cria_animal_id IS NOT NULL
             OR a.tenant_id IS DISTINCT FROM e.tenant_id AND p.cria_anterior_id IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'Existen referencias de filiación entre fincas; reconciliar antes de migrar';
        END IF;
      END $$;
      ALTER TABLE public.animal ADD CONSTRAINT animal_id_tenant_key UNIQUE (id, tenant_id);
      ALTER TABLE public.evento ADD CONSTRAINT evento_animal_tenant_fk
        FOREIGN KEY (animal_id, tenant_id) REFERENCES public.animal(id, tenant_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT;
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

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY evento_parto_filiacion_tenant ON public.evento_parto;
      ALTER TABLE public.evento DROP CONSTRAINT evento_animal_tenant_fk;
      ALTER TABLE public.animal DROP CONSTRAINT animal_id_tenant_key;
    `);
  }
}
