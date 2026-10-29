import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProtectOfficialDiioIdentity1792700000000
  implements MigrationInterface
{
  name = 'ProtectOfficialDiioIdentity1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.prevent_diio_reassignment()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = pg_catalog, public
      AS $$
      BEGIN
        IF OLD.numero_oficial_diio IS NOT NULL
          AND NEW.numero_oficial_diio IS DISTINCT FROM OLD.numero_oficial_diio THEN
          RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'El DIIO oficial asignado no se puede cambiar ni retirar.';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER trg_animal_diio_immutable
      BEFORE UPDATE OF numero_oficial_diio ON public.animal
      FOR EACH ROW EXECUTE FUNCTION public.prevent_diio_reassignment();

      REVOKE DELETE ON TABLE public.animal FROM resdigital_app;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      GRANT DELETE ON TABLE public.animal TO resdigital_app;
      DROP TRIGGER IF EXISTS trg_animal_diio_immutable ON public.animal;
      DROP FUNCTION IF EXISTS public.prevent_diio_reassignment();
    `);
  }
}
