import { MigrationInterface, QueryRunner } from 'typeorm';

const NOTA_MIGRACION = 'migrado desde pesaje';

/**
 * MILK-T001/T003: la producción de leche pasa a ser un evento PRODUCCION_LECHE
 * por turno + detalle `evento_produccion_leche`, con disposición según retiro.
 * Copia los litros de `pesaje` sin modificar la tabla de origen.
 */
export class CreateEventoProduccionLeche1791400000000 implements MigrationInterface {
  name = 'CreateEventoProduccionLeche1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE public.evento_produccion_leche (
        evento_id UUID PRIMARY KEY REFERENCES public.evento(id) ON DELETE RESTRICT,
        turno TEXT NOT NULL
          CONSTRAINT chk_evento_produccion_leche_turno CHECK (turno IN ('MANANA', 'TARDE')),
        litros NUMERIC(4,1) NOT NULL
          CONSTRAINT chk_evento_produccion_leche_litros CHECK (litros > 0 AND litros <= 60),
        disposicion TEXT NOT NULL
          CONSTRAINT chk_evento_produccion_leche_disposicion
          CHECK (disposicion IN ('COMERCIALIZABLE', 'DESCARTE')),
        tratamiento_evento_id UUID REFERENCES public.evento(id) ON DELETE RESTRICT,
        CONSTRAINT chk_evento_produccion_leche_descarte_tratamiento
          CHECK ((disposicion = 'DESCARTE') = (tratamiento_evento_id IS NOT NULL))
      );
      CREATE INDEX idx_evento_produccion_leche_tratamiento
        ON public.evento_produccion_leche(tratamiento_evento_id);
    `);

    await queryRunner.query(`
      REVOKE ALL PRIVILEGES ON TABLE public.evento_produccion_leche
        FROM PUBLIC, anon, authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.evento_produccion_leche
        TO resdigital_app;
      ALTER TABLE public.evento_produccion_leche ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.evento_produccion_leche FORCE ROW LEVEL SECURITY;
      CREATE POLICY "evento_produccion_leche_isolation_policy" ON public.evento_produccion_leche
        AS PERMISSIVE
        FOR ALL
        TO resdigital_app
        USING (EXISTS (
          SELECT 1 FROM public.evento e
          WHERE e.id = evento_produccion_leche.evento_id
            AND e.tenant_id = COALESCE(
              NULLIF(current_setting('app.current_tenant_id', true), ''),
              auth.jwt() ->> 'tenant_id'
            )::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e
          WHERE e.id = evento_produccion_leche.evento_id
            AND e.tenant_id = COALESCE(
              NULLIF(current_setting('app.current_tenant_id', true), ''),
              auth.jwt() ->> 'tenant_id'
            )::uuid
        ));
    `);

    await queryRunner.query(`
      CREATE TEMP TABLE _produccion_migrada AS
      SELECT
        gen_random_uuid() AS evento_id,
        p.tenant_id,
        p.animal_id,
        p.fecha,
        p.created_at,
        t.turno,
        t.litros
      FROM public.pesaje p
      CROSS JOIN LATERAL (
        VALUES ('MANANA', p.leche_manana_l), ('TARDE', p.leche_tarde_l)
      ) AS t(turno, litros)
      WHERE t.litros > 0;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM _produccion_migrada WHERE litros > 60) THEN
          RAISE EXCEPTION 'Hay pesajes con más de 60 litros por turno; revisar los datos antes de migrar';
        END IF;
        IF EXISTS (
          SELECT 1 FROM _produccion_migrada m
          WHERE NOT EXISTS (
            SELECT 1 FROM public.usuario u
            WHERE u.tenant_id = m.tenant_id AND u.rol = 'propietario'
          )
        ) THEN
          RAISE EXCEPTION 'Hay producción de leche en fincas sin propietario; no se puede asignar usuario_id al migrarla';
        END IF;
      END
      $$;
    `);

    await queryRunner.query(
      `
      INSERT INTO public.evento
        (id, tenant_id, animal_id, tipo, fecha_evento, fecha_registro, usuario_id, revertido, notas)
      SELECT
        m.evento_id,
        m.tenant_id,
        m.animal_id,
        'PRODUCCION_LECHE',
        m.fecha,
        m.created_at,
        (SELECT u.id FROM public.usuario u
          WHERE u.tenant_id = m.tenant_id AND u.rol = 'propietario'
          ORDER BY u.created_at ASC
          LIMIT 1),
        false,
        $1
      FROM _produccion_migrada m
    `,
      [NOTA_MIGRACION],
    );

    await queryRunner.query(`
      INSERT INTO public.evento_produccion_leche
        (evento_id, turno, litros, disposicion, tratamiento_evento_id)
      SELECT
        m.evento_id,
        m.turno,
        m.litros,
        CASE WHEN r.evento_id IS NULL THEN 'COMERCIALIZABLE' ELSE 'DESCARTE' END,
        r.evento_id
      FROM _produccion_migrada m
      LEFT JOIN LATERAL (
        SELECT et.evento_id
        FROM public.evento_tratamiento et
        JOIN public.evento e ON e.id = et.evento_id
        WHERE e.tenant_id = m.tenant_id
          AND e.animal_id = m.animal_id
          AND e.tipo = 'TRATAMIENTO'
          AND e.revertido = false
          AND e.fecha_evento <= m.fecha
          AND et.fecha_liberacion_leche > m.fecha
        ORDER BY et.fecha_liberacion_leche DESC, e.fecha_registro DESC
        LIMIT 1
      ) r ON true
    `);

    await queryRunner.query(`DROP TABLE _produccion_migrada`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.evento_produccion_leche`);
    await queryRunner.query(
      `
      DELETE FROM public.evento e
      WHERE e.tipo = 'PRODUCCION_LECHE'
        AND e.notas = $1
    `,
      [NOTA_MIGRACION],
    );
  }
}
