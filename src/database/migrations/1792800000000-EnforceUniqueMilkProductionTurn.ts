import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceUniqueMilkProductionTurn1792800000000
  implements MigrationInterface
{
  name = 'EnforceUniqueMilkProductionTurn1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM public.evento e
          JOIN public.evento_produccion_leche d ON d.evento_id = e.id
          WHERE e.tipo = 'PRODUCCION_LECHE' AND e.revertido = false
          GROUP BY e.tenant_id, e.animal_id, e.fecha_evento, d.turno
          HAVING count(*) > 1
        ) THEN
          RAISE EXCEPTION 'Hay turnos de producción vigentes duplicados; resuélvalos antes de aplicar la migración.';
        END IF;
      END
      $$;

      ALTER TABLE public.evento
        ADD CONSTRAINT uq_evento_identity_projection
        UNIQUE (id, tenant_id, animal_id, fecha_evento, revertido);

      ALTER TABLE public.evento_produccion_leche
        ADD COLUMN tenant_id uuid,
        ADD COLUMN animal_id uuid,
        ADD COLUMN fecha_evento date,
        ADD COLUMN revertido boolean;

      UPDATE public.evento_produccion_leche d
      SET tenant_id = e.tenant_id,
          animal_id = e.animal_id,
          fecha_evento = e.fecha_evento,
          revertido = e.revertido
      FROM public.evento e
      WHERE e.id = d.evento_id;

      ALTER TABLE public.evento_produccion_leche
        ALTER COLUMN tenant_id SET NOT NULL,
        ALTER COLUMN animal_id SET NOT NULL,
        ALTER COLUMN fecha_evento SET NOT NULL,
        ALTER COLUMN revertido SET NOT NULL,
        ADD CONSTRAINT fk_produccion_evento_identity
          FOREIGN KEY (evento_id, tenant_id, animal_id, fecha_evento, revertido)
          REFERENCES public.evento (id, tenant_id, animal_id, fecha_evento, revertido)
          ON UPDATE CASCADE ON DELETE RESTRICT;

      CREATE FUNCTION public.set_produccion_event_projection()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = pg_catalog, public
      AS $$
      BEGIN
        SELECT e.tenant_id, e.animal_id, e.fecha_evento, e.revertido
          INTO NEW.tenant_id, NEW.animal_id, NEW.fecha_evento, NEW.revertido
        FROM public.evento e
        WHERE e.id = NEW.evento_id AND e.tipo = 'PRODUCCION_LECHE';
        IF NOT FOUND THEN
          RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'El evento de producción no existe.';
        END IF;
        RETURN NEW;
      END;
      $$;

      CREATE TRIGGER trg_produccion_event_projection
      BEFORE INSERT ON public.evento_produccion_leche
      FOR EACH ROW EXECUTE FUNCTION public.set_produccion_event_projection();

      CREATE UNIQUE INDEX uq_produccion_turno_vigente
        ON public.evento_produccion_leche (tenant_id, animal_id, fecha_evento, turno)
        WHERE revertido IS FALSE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS public.uq_produccion_turno_vigente;
      DROP TRIGGER IF EXISTS trg_produccion_event_projection ON public.evento_produccion_leche;
      DROP FUNCTION IF EXISTS public.set_produccion_event_projection();
      ALTER TABLE public.evento_produccion_leche
        DROP CONSTRAINT IF EXISTS fk_produccion_evento_identity,
        DROP COLUMN IF EXISTS tenant_id,
        DROP COLUMN IF EXISTS animal_id,
        DROP COLUMN IF EXISTS fecha_evento,
        DROP COLUMN IF EXISTS revertido;
      ALTER TABLE public.evento DROP CONSTRAINT IF EXISTS uq_evento_identity_projection;
    `);
  }
}
