import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TraceAnimalReactivation1793000000000 implements MigrationInterface {
  name = 'TraceAnimalReactivation1793000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE public.evento_reactivacion (
        evento_id uuid PRIMARY KEY REFERENCES public.evento(id) ON DELETE RESTRICT,
        evento_baja_id uuid NOT NULL UNIQUE REFERENCES public.evento_baja(evento_id) ON DELETE RESTRICT,
        modalidad text NOT NULL CHECK (modalidad IN ('RETORNO', 'CORRECCION')),
        motivo text NOT NULL CHECK (length(trim(motivo)) BETWEEN 3 AND 500),
        arete_anterior text NOT NULL,
        arete_nuevo text NOT NULL
      );
      ALTER TABLE public.evento_reactivacion ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.evento_reactivacion FORCE ROW LEVEL SECURITY;
      CREATE POLICY evento_reactivacion_tenant_policy ON public.evento_reactivacion
        FOR ALL TO resdigital_app
        USING (EXISTS (
          SELECT 1 FROM public.evento e
          WHERE e.id = evento_reactivacion.evento_id
            AND e.tenant_id = COALESCE(NULLIF(current_setting('app.current_tenant_id', true), ''), auth.jwt() ->> 'tenant_id')::uuid
            AND e.tipo = 'REACTIVACION'
            AND EXISTS (
              SELECT 1 FROM public.evento b
              WHERE b.id = evento_reactivacion.evento_baja_id
                AND b.animal_id = e.animal_id AND b.tenant_id = e.tenant_id AND b.tipo = 'BAJA'
            )
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e
          WHERE e.id = evento_reactivacion.evento_id
            AND e.tenant_id = COALESCE(NULLIF(current_setting('app.current_tenant_id', true), ''), auth.jwt() ->> 'tenant_id')::uuid
            AND e.tipo = 'REACTIVACION'
            AND EXISTS (
              SELECT 1 FROM public.evento b
              WHERE b.id = evento_reactivacion.evento_baja_id
                AND b.animal_id = e.animal_id AND b.tenant_id = e.tenant_id AND b.tipo = 'BAJA'
            )
        ));
      REVOKE ALL ON public.evento_reactivacion FROM PUBLIC, anon, authenticated;
      GRANT SELECT, INSERT ON public.evento_reactivacion TO resdigital_app;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE public.evento_reactivacion`);
  }
}
