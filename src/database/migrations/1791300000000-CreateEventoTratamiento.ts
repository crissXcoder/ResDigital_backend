import { MigrationInterface, QueryRunner } from 'typeorm';

const NOTA_MIGRACION = 'migrado desde tratamiento_sanitario';

/**
 * SAN-T001: el tratamiento pasa a ser un evento TRATAMIENTO + detalle
 * `evento_tratamiento`. Copia `tratamiento_sanitario` conservando el id y
 * deja la tabla legada intacta para poder revertir.
 */
export class CreateEventoTratamiento1791300000000 implements MigrationInterface {
  name = 'CreateEventoTratamiento1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE public.evento_tratamiento (
        evento_id UUID PRIMARY KEY REFERENCES public.evento(id) ON DELETE RESTRICT,
        medicamento_id UUID REFERENCES public.catalogo_medicamento(id) ON DELETE RESTRICT,
        producto_nombre TEXT NOT NULL,
        padecimiento_id UUID REFERENCES public.catalogo_padecimiento(id) ON DELETE RESTRICT,
        diagnostico TEXT NOT NULL,
        dosis TEXT NOT NULL,
        via TEXT,
        veterinario TEXT,
        fecha_ultima_administracion DATE NOT NULL,
        dias_retiro_leche INTEGER NOT NULL
          CONSTRAINT chk_evento_tratamiento_retiro_leche CHECK (dias_retiro_leche BETWEEN 0 AND 365),
        dias_retiro_carne INTEGER NOT NULL
          CONSTRAINT chk_evento_tratamiento_retiro_carne CHECK (dias_retiro_carne BETWEEN 0 AND 365),
        fecha_liberacion_leche DATE NOT NULL,
        fecha_liberacion_carne DATE NOT NULL,
        documento_url TEXT
      );
      CREATE INDEX idx_evento_tratamiento_medicamento
        ON public.evento_tratamiento(medicamento_id);
    `);

    await queryRunner.query(`
      REVOKE ALL PRIVILEGES ON TABLE public.evento_tratamiento
        FROM PUBLIC, anon, authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.evento_tratamiento
        TO resdigital_app;
      ALTER TABLE public.evento_tratamiento ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.evento_tratamiento FORCE ROW LEVEL SECURITY;
      CREATE POLICY "evento_tratamiento_isolation_policy" ON public.evento_tratamiento
        AS PERMISSIVE
        FOR ALL
        TO resdigital_app
        USING (EXISTS (
          SELECT 1 FROM public.evento e
          WHERE e.id = evento_tratamiento.evento_id
            AND e.tenant_id = COALESCE(
              NULLIF(current_setting('app.current_tenant_id', true), ''),
              auth.jwt() ->> 'tenant_id'
            )::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e
          WHERE e.id = evento_tratamiento.evento_id
            AND e.tenant_id = COALESCE(
              NULLIF(current_setting('app.current_tenant_id', true), ''),
              auth.jwt() ->> 'tenant_id'
            )::uuid
        ));
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM public.tratamiento_sanitario t
          WHERE NOT EXISTS (
            SELECT 1 FROM public.usuario u
            WHERE u.tenant_id = t.tenant_id AND u.rol = 'propietario'
          )
        ) THEN
          RAISE EXCEPTION 'Hay tratamientos en fincas sin propietario; no se puede asignar usuario_id al migrarlos';
        END IF;
      END
      $$;
    `);

    await queryRunner.query(
      `
      INSERT INTO public.evento
        (id, tenant_id, animal_id, tipo, fecha_evento, fecha_registro, usuario_id, revertido, notas)
      SELECT
        t.id,
        t.tenant_id,
        t.animal_id,
        'TRATAMIENTO',
        t.fecha,
        t.created_at,
        (SELECT u.id FROM public.usuario u
          WHERE u.tenant_id = t.tenant_id AND u.rol = 'propietario'
          ORDER BY u.created_at ASC
          LIMIT 1),
        false,
        $1
      FROM public.tratamiento_sanitario t
    `,
      [NOTA_MIGRACION],
    );

    await queryRunner.query(`
      WITH base AS (
        SELECT
          t.*,
          CASE WHEN t.dias_retiro_leche = 0 AND t.dias_retiro_carne = 0
               THEN COALESCE(t.dias_retiro, 0) ELSE t.dias_retiro_leche END AS leche,
          CASE WHEN t.dias_retiro_leche = 0 AND t.dias_retiro_carne = 0
               THEN COALESCE(t.dias_retiro, 0) ELSE t.dias_retiro_carne END AS carne
        FROM public.tratamiento_sanitario t
      )
      INSERT INTO public.evento_tratamiento (
        evento_id, medicamento_id, producto_nombre, padecimiento_id, diagnostico,
        dosis, via, veterinario, fecha_ultima_administracion,
        dias_retiro_leche, dias_retiro_carne,
        fecha_liberacion_leche, fecha_liberacion_carne, documento_url
      )
      SELECT
        b.id,
        (SELECT m.id FROM public.catalogo_medicamento m
          WHERE m.tenant_id = b.tenant_id AND m.nombre_comercial = b.farmaco
          GROUP BY m.id
          HAVING (SELECT count(*) FROM public.catalogo_medicamento m2
                  WHERE m2.tenant_id = b.tenant_id AND m2.nombre_comercial = b.farmaco) = 1),
        b.farmaco,
        (SELECT p.id FROM public.catalogo_padecimiento p
          WHERE p.tenant_id = b.tenant_id AND p.nombre = b.diagnostico
          GROUP BY p.id
          HAVING (SELECT count(*) FROM public.catalogo_padecimiento p2
                  WHERE p2.tenant_id = b.tenant_id AND p2.nombre = b.diagnostico) = 1),
        b.diagnostico,
        b.dosis,
        b.via,
        b.veterinario,
        b.fecha,
        b.leche,
        b.carne,
        (b.fecha + b.leche * INTERVAL '1 day')::date,
        (b.fecha + b.carne * INTERVAL '1 day')::date,
        b.documento_url
      FROM base b
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.evento_tratamiento`);
    await queryRunner.query(
      `
      DELETE FROM public.evento e
      WHERE e.tipo = 'TRATAMIENTO'
        AND e.notas = $1
        AND EXISTS (SELECT 1 FROM public.tratamiento_sanitario t WHERE t.id = e.id)
    `,
      [NOTA_MIGRACION],
    );
  }
}
