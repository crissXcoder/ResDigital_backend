import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixReproductiveEventRLS1789700000001 implements MigrationInterface {
  name = 'FixReproductiveEventRLS1789700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS evento_isolation_policy ON public.evento;
      CREATE POLICY evento_isolation_policy ON public.evento
        FOR ALL
        TO authenticated
        USING (tenant_id = COALESCE(current_setting('app.current_tenant_id', true), auth.jwt() ->> 'tenant_id')::uuid)
        WITH CHECK (tenant_id = COALESCE(current_setting('app.current_tenant_id', true), auth.jwt() ->> 'tenant_id')::uuid);

      DROP POLICY IF EXISTS evento_servicio_isolation_policy ON public.evento_servicio;
      CREATE POLICY evento_servicio_isolation_policy ON public.evento_servicio
        FOR ALL
        TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_servicio.evento_id 
            AND e.tenant_id = COALESCE(current_setting('app.current_tenant_id', true), auth.jwt() ->> 'tenant_id')::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_servicio.evento_id 
            AND e.tenant_id = COALESCE(current_setting('app.current_tenant_id', true), auth.jwt() ->> 'tenant_id')::uuid
        ));

      DROP POLICY IF EXISTS evento_diagnostico_isolation_policy ON public.evento_diagnostico;
      CREATE POLICY evento_diagnostico_isolation_policy ON public.evento_diagnostico
        FOR ALL
        TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_diagnostico.evento_id 
            AND e.tenant_id = COALESCE(current_setting('app.current_tenant_id', true), auth.jwt() ->> 'tenant_id')::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_diagnostico.evento_id 
            AND e.tenant_id = COALESCE(current_setting('app.current_tenant_id', true), auth.jwt() ->> 'tenant_id')::uuid
        ));

      DROP POLICY IF EXISTS evento_parto_isolation_policy ON public.evento_parto;
      CREATE POLICY evento_parto_isolation_policy ON public.evento_parto
        FOR ALL
        TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_parto.evento_id 
            AND e.tenant_id = COALESCE(current_setting('app.current_tenant_id', true), auth.jwt() ->> 'tenant_id')::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_parto.evento_id 
            AND e.tenant_id = COALESCE(current_setting('app.current_tenant_id', true), auth.jwt() ->> 'tenant_id')::uuid
        ));

      DROP POLICY IF EXISTS evento_secado_isolation_policy ON public.evento_secado;
      CREATE POLICY evento_secado_isolation_policy ON public.evento_secado
        FOR ALL
        TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_secado.evento_id 
            AND e.tenant_id = COALESCE(current_setting('app.current_tenant_id', true), auth.jwt() ->> 'tenant_id')::uuid
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.evento e 
          WHERE e.id = evento_secado.evento_id 
            AND e.tenant_id = COALESCE(current_setting('app.current_tenant_id', true), auth.jwt() ->> 'tenant_id')::uuid
        ));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to old policies
    await queryRunner.query(`
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

      DROP POLICY IF EXISTS evento_isolation_policy ON public.evento;
      CREATE POLICY evento_isolation_policy ON public.evento
        FOR ALL
        TO authenticated
        USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
        WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
    `);
  }
}
