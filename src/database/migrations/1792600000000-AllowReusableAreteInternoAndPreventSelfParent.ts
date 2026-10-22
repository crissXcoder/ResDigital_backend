import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowReusableAreteInternoAndPreventSelfParent1792600000000
  implements MigrationInterface
{
  name = 'AllowReusableAreteInternoAndPreventSelfParent1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Eliminar la restricción UNIQUE incondicional previa sobre (tenant_id, arete_interno) si existe
    await queryRunner.query(`
      DO $$
      DECLARE
          r RECORD;
      BEGIN
          FOR r IN (
              SELECT conname
              FROM pg_constraint c
              JOIN pg_class t ON c.conrelid = t.oid
              WHERE t.relname = 'animal'
                AND c.contype = 'u'
                AND ARRAY(
                    SELECT a.attname::text
                    FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                    ORDER BY k.ord
                ) = ARRAY['tenant_id', 'arete_interno']
          ) LOOP
              EXECUTE 'ALTER TABLE public.animal DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
          END LOOP;

          IF EXISTS (
              SELECT 1
              FROM information_schema.table_constraints
              WHERE table_schema = 'public'
                AND table_name = 'animal'
                AND constraint_name = 'animal_tenant_id_arete_interno_key'
          ) THEN
              ALTER TABLE public.animal DROP CONSTRAINT animal_tenant_id_arete_interno_key;
          END IF;
      END $$;

      DROP INDEX IF EXISTS public.idx_animal_tenant_arete_unique;
      DROP INDEX IF EXISTS public.UQ_animal_tenant_id_arete_interno;
      DROP INDEX IF EXISTS public."UQ_397b1e68f25cf3b2b256636b43f";
    `);

    // 2. Crear índice único condicional (partial unique index):
    // Permite que un mismo arete_interno sea reutilizado a lo largo del tiempo una vez que
    // el animal anterior fue dado de baja (muerte, venta/salida, activo = false),
    // pero garantiza estrictamente que NUNCA coexistan dos animales activos con el mismo arete en la misma finca (tenant).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_animal_tenant_arete_activo_unique
        ON public.animal (tenant_id, arete_interno)
        WHERE activo IS TRUE;
    `);

    // 3. Restricciones de integridad a nivel de base de datos para impedir auto-parentesco:
    // Limpia datos legados donde un animal fue registrado como su propia madre o padre
    await queryRunner.query(`
      UPDATE public.animal SET madre_id = NULL WHERE madre_id = id;
      UPDATE public.animal SET padre_id = NULL WHERE padre_id = id;
    `);

    // Un animal nunca puede ser su propia madre ni su propio padre.
    await queryRunner.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (
              SELECT 1
              FROM information_schema.table_constraints
              WHERE table_schema = 'public'
                AND table_name = 'animal'
                AND constraint_name = 'chk_animal_madre_not_self'
          ) THEN
              ALTER TABLE public.animal
                ADD CONSTRAINT chk_animal_madre_not_self
                CHECK (madre_id IS NULL OR madre_id <> id);
          END IF;

          IF NOT EXISTS (
              SELECT 1
              FROM information_schema.table_constraints
              WHERE table_schema = 'public'
                AND table_name = 'animal'
                AND constraint_name = 'chk_animal_padre_not_self'
          ) THEN
              ALTER TABLE public.animal
                ADD CONSTRAINT chk_animal_padre_not_self
                CHECK (padre_id IS NULL OR padre_id <> id);
          END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Eliminar índice parcial de arete activo
    await queryRunner.query(`
      DROP INDEX IF EXISTS public.idx_animal_tenant_arete_activo_unique;
      ALTER TABLE public.animal DROP CONSTRAINT IF EXISTS chk_animal_madre_not_self;
      ALTER TABLE public.animal DROP CONSTRAINT IF EXISTS chk_animal_padre_not_self;
    `);

    // 2. Intentar restaurar constraint incondicional previo si no hay colisiones
    await queryRunner.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (
              SELECT 1
              FROM information_schema.table_constraints
              WHERE table_schema = 'public'
                AND table_name = 'animal'
                AND constraint_name = 'animal_tenant_id_arete_interno_key'
          ) THEN
              ALTER TABLE public.animal
                ADD CONSTRAINT animal_tenant_id_arete_interno_key
                UNIQUE (tenant_id, arete_interno);
          END IF;
      END $$;
    `);
  }
}
