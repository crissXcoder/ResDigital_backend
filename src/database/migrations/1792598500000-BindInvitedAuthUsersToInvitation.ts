import type { MigrationInterface, QueryRunner } from 'typeorm';

const INVITED_USER_TRIGGER = `
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_nombre_finca TEXT;
  v_nombre_completo TEXT;
  v_rol public.rol_usuario;
  v_invitacion_id UUID;
BEGIN
  v_nombre_completo := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'nombre_completo'), ''),
    split_part(NEW.email, '@', 1)
  );

  IF NEW.invited_at IS NOT NULL THEN
    v_invitacion_id := (NEW.raw_user_meta_data->>'invitacion_id')::UUID;
    SELECT tenant_id, rol::public.rol_usuario
      INTO v_tenant_id, v_rol
      FROM public.invitacion
     WHERE id = v_invitacion_id
       AND correo = lower(trim(NEW.email))
       AND estado = 'PENDIENTE'
       AND created_at > now() - interval '24 hours';

    IF v_tenant_id IS NULL THEN
      RAISE EXCEPTION 'No existe una invitación vigente para esta cuenta';
    END IF;

    INSERT INTO public.usuario (
      id, tenant_id, nombre_completo, correo, rol, activo
    ) VALUES (
      NEW.id, v_tenant_id, v_nombre_completo, NEW.email, v_rol, true
    );
  ELSE
    v_nombre_finca := COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'nombre_finca'), ''),
      'Finca de ' || v_nombre_completo
    );

    INSERT INTO public.tenant (nombre_finca)
    VALUES (v_nombre_finca)
    RETURNING id INTO v_tenant_id;

    INSERT INTO public.usuario (
      id, tenant_id, nombre_completo, correo, rol, activo
    ) VALUES (
      NEW.id, v_tenant_id, v_nombre_completo, NEW.email,
      'propietario'::public.rol_usuario, true
    );
  END IF;

  RETURN NEW;
END;
$$;
`;

export class BindInvitedAuthUsersToInvitation1792598500000
  implements MigrationInterface
{
  name = 'BindInvitedAuthUsersToInvitation1792598500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(INVITED_USER_TRIGGER);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      -- Keep rollback closed: restoring the old metadata-based assignment would
      -- let a signup claim an arbitrary finca and role.
      CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $$
      DECLARE
        v_tenant_id UUID;
        v_nombre_completo TEXT;
      BEGIN
        IF NEW.invited_at IS NOT NULL THEN
          RAISE EXCEPTION 'Las invitaciones requieren la migración de seguridad activa';
        END IF;

        v_nombre_completo := COALESCE(
          NULLIF(TRIM(NEW.raw_user_meta_data->>'nombre_completo'), ''),
          split_part(NEW.email, '@', 1)
        );
        INSERT INTO public.tenant (nombre_finca)
        VALUES (COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'nombre_finca'), ''),
                         'Finca de ' || v_nombre_completo))
        RETURNING id INTO v_tenant_id;
        INSERT INTO public.usuario (id, tenant_id, nombre_completo, correo, rol, activo)
        VALUES (NEW.id, v_tenant_id, v_nombre_completo, NEW.email,
                'propietario'::public.rol_usuario, true);

        RETURN NEW;
      END;
      $$;
    `);
  }
}
