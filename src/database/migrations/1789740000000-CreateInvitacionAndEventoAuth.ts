import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea `invitacion` y `evento_auth`, dos tablas que el código de MOD-00 escribe
 * desde siempre pero que ninguna migración creaba.
 *
 * Consecuencias del faltante, que esta migración cierra:
 *
 * 1. `InvitationsService` hacía `INSERT INTO public.invitacion ... ON CONFLICT`
 *    dentro de un try/catch que degradaba a un Map en memoria. Las invitaciones
 *    sobrevivían solo hasta el siguiente reinicio del proceso.
 *
 * 2. `AuditAuthService` mantiene una cadena de hashes SHA-256 encadenados para
 *    cumplir la trazabilidad que pide la Ley 8968 (ver Normativa-Costa-Rica.md).
 *    Sin la tabla, esa cadena nunca se persistía: vivía solo en memoria y se
 *    perdía entera en cada despliegue.
 *
 * Las columnas salen de los INSERT reales de ambos servicios, y la forma general
 * de `invitacion` sigue el SQL documentado en MOD-00-Auth-y-Tenant.md.
 */
export class CreateInvitacionAndEventoAuth1789740000000 implements MigrationInterface {
  name = 'CreateInvitacionAndEventoAuth1789740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. invitacion
    // El UNIQUE (correo, tenant_id) no es decorativo: InvitationsService.inviteUser
    // depende de `ON CONFLICT (correo, tenant_id) DO UPDATE` para reenviar una
    // invitación sin duplicar la fila.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.invitacion (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE RESTRICT,
        correo TEXT NOT NULL,
        rol TEXT NOT NULL CHECK (rol IN ('propietario','administrador','peon','veterinario')),
        invitado_por UUID NOT NULL REFERENCES public.usuario(id) ON DELETE RESTRICT,
        estado TEXT NOT NULL CHECK (estado IN ('PENDIENTE','ACEPTADA','CANCELADA')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT invitacion_correo_tenant_key UNIQUE (correo, tenant_id)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_invitacion_tenant_estado
        ON public.invitacion(tenant_id, estado);
    `);

    // 2. evento_auth — bitácora de auditoría con hash encadenado.
    // curr_hash es UNIQUE: cada hash incorpora un UUID aleatorio y la marca de
    // tiempo, así que una colisión indicaría un intento de reinyectar un evento.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.evento_auth (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE RESTRICT,
        usuario_id UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
        tipo_evento TEXT NOT NULL CHECK (
          tipo_evento IN ('LOGIN','INVITACION_ENVIADA','INVITACION_ACEPTADA','CAMBIO_ROL')
        ),
        detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
        prev_hash CHAR(64) NOT NULL,
        curr_hash CHAR(64) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // getLatestHash() ordena por created_at DESC filtrando por tenant.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_evento_auth_tenant_created
        ON public.evento_auth(tenant_id, created_at DESC);
    `);

    // 3. RLS en ambas. MOD-00-Auth-y-Tenant.md las lista explícitamente entre
    // las tablas que deben tener RLS forzado.
    await queryRunner.query(`
      ALTER TABLE public.invitacion ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.invitacion FORCE ROW LEVEL SECURITY;

      ALTER TABLE public.evento_auth ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.evento_auth FORCE ROW LEVEL SECURITY;
    `);

    // El predicado acepta las dos convenciones de contexto que conviven en el
    // proyecto: la que fija RlsTransactionInterceptor (app.current_tenant_id) y
    // la del JWT de Supabase. Ver UnifyRlsPoliciesToAuthenticated1789740000002.
    await queryRunner.query(`
      DROP POLICY IF EXISTS invitacion_isolation_policy ON public.invitacion;
      CREATE POLICY invitacion_isolation_policy ON public.invitacion
        FOR ALL
        TO authenticated
        USING (tenant_id = COALESCE(
          NULLIF(current_setting('app.current_tenant_id', true), ''),
          auth.jwt() ->> 'tenant_id'
        )::uuid)
        WITH CHECK (tenant_id = COALESCE(
          NULLIF(current_setting('app.current_tenant_id', true), ''),
          auth.jwt() ->> 'tenant_id'
        )::uuid);
    `);

    await queryRunner.query(`
      DROP POLICY IF EXISTS evento_auth_isolation_policy ON public.evento_auth;
      CREATE POLICY evento_auth_isolation_policy ON public.evento_auth
        FOR ALL
        TO authenticated
        USING (tenant_id = COALESCE(
          NULLIF(current_setting('app.current_tenant_id', true), ''),
          auth.jwt() ->> 'tenant_id'
        )::uuid)
        WITH CHECK (tenant_id = COALESCE(
          NULLIF(current_setting('app.current_tenant_id', true), ''),
          auth.jwt() ->> 'tenant_id'
        )::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS evento_auth_isolation_policy ON public.evento_auth;
      DROP POLICY IF EXISTS invitacion_isolation_policy ON public.invitacion;
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS public.evento_auth;`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.invitacion;`);
  }
}
