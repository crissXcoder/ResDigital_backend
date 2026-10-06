import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReproductiveEventTables1789610000000
  implements MigrationInterface
{
  name = 'CreateReproductiveEventTables1789610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Asegurar tabla base evento (idempotente)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.evento (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE RESTRICT,
        animal_id UUID NOT NULL REFERENCES public.animal(id) ON DELETE RESTRICT,
        tipo TEXT NOT NULL,
        fecha_evento DATE NOT NULL,
        fecha_registro TIMESTAMPTZ NOT NULL DEFAULT now(),
        usuario_id UUID NOT NULL REFERENCES public.usuario(id) ON DELETE RESTRICT,
        revertido BOOLEAN NOT NULL DEFAULT false,
        evento_corrige_id UUID REFERENCES public.evento(id) ON DELETE RESTRICT,
        notas TEXT
      );
    `);

    // Asegurar ON DELETE RESTRICT en claves foráneas de evento
    await queryRunner.query(`
      ALTER TABLE public.evento DROP CONSTRAINT IF EXISTS evento_animal_id_fkey;
      ALTER TABLE public.evento ADD CONSTRAINT evento_animal_id_fkey
        FOREIGN KEY (animal_id) REFERENCES public.animal(id) ON DELETE RESTRICT;

      ALTER TABLE public.evento DROP CONSTRAINT IF EXISTS evento_evento_corrige_id_fkey;
      ALTER TABLE public.evento ADD CONSTRAINT evento_evento_corrige_id_fkey
        FOREIGN KEY (evento_corrige_id) REFERENCES public.evento(id) ON DELETE RESTRICT;
    `);

    // 2. Crear y configurar tablas de detalle de MOD-03 Reproductivo
    // 2.1 evento_servicio
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.evento_servicio (
        evento_id UUID PRIMARY KEY,
        tipo_servicio TEXT NOT NULL,
        toro_o_pajilla TEXT NOT NULL,
        responsable TEXT,
        palpacion_fecha DATE NOT NULL,
        secado_fecha DATE NOT NULL,
        aviso_parto_fecha DATE NOT NULL,
        aviso_parto_urgente_fecha DATE NOT NULL,
        fpp DATE NOT NULL
      );

      ALTER TABLE public.evento_servicio DROP CONSTRAINT IF EXISTS evento_servicio_evento_id_fkey;
      ALTER TABLE public.evento_servicio ADD CONSTRAINT evento_servicio_evento_id_fkey
        FOREIGN KEY (evento_id) REFERENCES public.evento(id) ON DELETE RESTRICT;

      ALTER TABLE public.evento_servicio DROP CONSTRAINT IF EXISTS evento_servicio_tipo_servicio_check;
      ALTER TABLE public.evento_servicio ADD CONSTRAINT evento_servicio_tipo_servicio_check
        CHECK (tipo_servicio IN ('Inseminación Artificial', 'Monta Natural'));
    `);

    // 2.2 evento_diagnostico
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.evento_diagnostico (
        evento_id UUID PRIMARY KEY,
        evento_servicio_id UUID NOT NULL,
        metodo TEXT NOT NULL,
        resultado TEXT NOT NULL
      );

      ALTER TABLE public.evento_diagnostico DROP CONSTRAINT IF EXISTS evento_diagnostico_evento_id_fkey;
      ALTER TABLE public.evento_diagnostico ADD CONSTRAINT evento_diagnostico_evento_id_fkey
        FOREIGN KEY (evento_id) REFERENCES public.evento(id) ON DELETE RESTRICT;

      ALTER TABLE public.evento_diagnostico DROP CONSTRAINT IF EXISTS evento_diagnostico_evento_servicio_id_fkey;
      ALTER TABLE public.evento_diagnostico ADD CONSTRAINT evento_diagnostico_evento_servicio_id_fkey
        FOREIGN KEY (evento_servicio_id) REFERENCES public.evento(id) ON DELETE RESTRICT;

      ALTER TABLE public.evento_diagnostico DROP CONSTRAINT IF EXISTS evento_diagnostico_metodo_check;
      ALTER TABLE public.evento_diagnostico ADD CONSTRAINT evento_diagnostico_metodo_check
        CHECK (metodo IN ('Palpación', 'Ecografía', 'PAG'));

      ALTER TABLE public.evento_diagnostico DROP CONSTRAINT IF EXISTS evento_diagnostico_resultado_check;
      ALTER TABLE public.evento_diagnostico ADD CONSTRAINT evento_diagnostico_resultado_check
        CHECK (resultado IN ('Preñada', 'Vacía'));
    `);

    // 2.3 evento_parto
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.evento_parto (
        evento_id UUID PRIMARY KEY,
        evento_servicio_id UUID,
        cria_animal_id UUID,
        facilidad_parto TEXT,
        observaciones TEXT
      );

      ALTER TABLE public.evento_parto DROP CONSTRAINT IF EXISTS evento_parto_evento_id_fkey;
      ALTER TABLE public.evento_parto ADD CONSTRAINT evento_parto_evento_id_fkey
        FOREIGN KEY (evento_id) REFERENCES public.evento(id) ON DELETE RESTRICT;

      ALTER TABLE public.evento_parto DROP CONSTRAINT IF EXISTS evento_parto_evento_servicio_id_fkey;
      ALTER TABLE public.evento_parto ADD CONSTRAINT evento_parto_evento_servicio_id_fkey
        FOREIGN KEY (evento_servicio_id) REFERENCES public.evento(id) ON DELETE RESTRICT;

      ALTER TABLE public.evento_parto DROP CONSTRAINT IF EXISTS evento_parto_cria_animal_id_fkey;
      ALTER TABLE public.evento_parto ADD CONSTRAINT evento_parto_cria_animal_id_fkey
        FOREIGN KEY (cria_animal_id) REFERENCES public.animal(id) ON DELETE RESTRICT;
    `);

    // 2.4 evento_secado
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.evento_secado (
        evento_id UUID PRIMARY KEY
      );

      ALTER TABLE public.evento_secado DROP CONSTRAINT IF EXISTS evento_secado_evento_id_fkey;
      ALTER TABLE public.evento_secado ADD CONSTRAINT evento_secado_evento_id_fkey
        FOREIGN KEY (evento_id) REFERENCES public.evento(id) ON DELETE RESTRICT;
    `);

    // 3. Índices de Rendimiento para Consultas y Dashboard
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_evento_animal_fecha 
        ON public.evento(animal_id, fecha_evento);

      CREATE INDEX IF NOT EXISTS idx_evento_servicio_palpacion 
        ON public.evento_servicio(palpacion_fecha);

      CREATE INDEX IF NOT EXISTS idx_evento_servicio_secado 
        ON public.evento_servicio(secado_fecha);

      CREATE INDEX IF NOT EXISTS idx_evento_servicio_aviso_parto 
        ON public.evento_servicio(aviso_parto_fecha);

      CREATE INDEX IF NOT EXISTS idx_evento_servicio_fpp 
        ON public.evento_servicio(fpp);

      CREATE INDEX IF NOT EXISTS idx_evento_diagnostico_servicio 
        ON public.evento_diagnostico(evento_servicio_id);

      CREATE INDEX IF NOT EXISTS idx_evento_parto_servicio 
        ON public.evento_parto(evento_servicio_id);
    `);

    // 4. RLS y Políticas de Aislamiento
    await queryRunner.query(`
      ALTER TABLE public.evento ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.evento FORCE ROW LEVEL SECURITY;

      ALTER TABLE public.evento_servicio ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.evento_servicio FORCE ROW LEVEL SECURITY;

      ALTER TABLE public.evento_diagnostico ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.evento_diagnostico FORCE ROW LEVEL SECURITY;

      ALTER TABLE public.evento_parto ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.evento_parto FORCE ROW LEVEL SECURITY;

      ALTER TABLE public.evento_secado ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.evento_secado FORCE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS evento_isolation_policy ON public.evento;
      CREATE POLICY evento_isolation_policy ON public.evento
        FOR ALL
        TO authenticated
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
        WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

      DROP POLICY IF EXISTS evento_servicio_isolation_policy ON public.evento_servicio;
      CREATE POLICY evento_servicio_isolation_policy ON public.evento_servicio
        FOR ALL
        TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_servicio.evento_id 
            AND e.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_servicio.evento_id 
            AND e.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        ));

      DROP POLICY IF EXISTS evento_diagnostico_isolation_policy ON public.evento_diagnostico;
      CREATE POLICY evento_diagnostico_isolation_policy ON public.evento_diagnostico
        FOR ALL
        TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_diagnostico.evento_id 
            AND e.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_diagnostico.evento_id 
            AND e.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        ));

      DROP POLICY IF EXISTS evento_parto_isolation_policy ON public.evento_parto;
      CREATE POLICY evento_parto_isolation_policy ON public.evento_parto
        FOR ALL
        TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_parto.evento_id 
            AND e.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_parto.evento_id 
            AND e.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        ));

      DROP POLICY IF EXISTS evento_secado_isolation_policy ON public.evento_secado;
      CREATE POLICY evento_secado_isolation_policy ON public.evento_secado
        FOR ALL
        TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_secado.evento_id 
            AND e.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_secado.evento_id 
            AND e.tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        ));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Eliminar políticas
    await queryRunner.query(`
      DROP POLICY IF EXISTS evento_secado_isolation_policy ON public.evento_secado;
      DROP POLICY IF EXISTS evento_parto_isolation_policy ON public.evento_parto;
      DROP POLICY IF EXISTS evento_diagnostico_isolation_policy ON public.evento_diagnostico;
      DROP POLICY IF EXISTS evento_servicio_isolation_policy ON public.evento_servicio;
      DROP POLICY IF EXISTS evento_isolation_policy ON public.evento;
    `);

    // 2. Eliminar índices
    await queryRunner.query(`
      DROP INDEX IF EXISTS public.idx_evento_parto_servicio;
      DROP INDEX IF EXISTS public.idx_evento_diagnostico_servicio;
      DROP INDEX IF EXISTS public.idx_evento_servicio_fpp;
      DROP INDEX IF EXISTS public.idx_evento_servicio_aviso_parto;
      DROP INDEX IF EXISTS public.idx_evento_servicio_secado;
      DROP INDEX IF EXISTS public.idx_evento_servicio_palpacion;
      DROP INDEX IF EXISTS public.idx_evento_animal_fecha;
    `);

    // 3. Eliminar tablas
    await queryRunner.query(`
      DROP TABLE IF EXISTS public.evento_secado;
      DROP TABLE IF EXISTS public.evento_parto;
      DROP TABLE IF EXISTS public.evento_diagnostico;
      DROP TABLE IF EXISTS public.evento_servicio;
      DROP TABLE IF EXISTS public.evento;
    `);
  }
}
