-- ==============================================================================
-- ResDigital — MOD-00 Auth y Tenant: Setup de Supabase
-- Script SQL para ejecutar directamente en el SQL Editor de Supabase
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FUNCIÓN Y TRIGGER: Registro automático de finca y usuario (handle_new_auth_user)
-- ------------------------------------------------------------------------------
-- Se dispara automáticamente cuando un nuevo usuario es insertado en auth.users.
-- Defensa estricta contra mass-assignment:
-- - NUNCA lee 'rol' desde raw_user_meta_data (que el cliente puede manipular libremente).
-- - Si es auto-registro (sin tenant_id en app_metadata), crea un nuevo tenant y
--   fuerza incondicionalmente rol = 'propietario'.
-- - Una invitación Auth solo se vincula con una invitación persistida, por id,
--   correo y vigencia; user_metadata únicamente localiza el registro.
-- ------------------------------------------------------------------------------

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
  -- Extraer nombre_completo seguro (fallback al prefijo de su correo)
  v_nombre_completo := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'nombre_completo'), ''),
    split_part(NEW.email, '@', 1)
  );

  -- Evaluar si es una invitación interna o un alta de finca nueva (self-signup)
  IF NEW.invited_at IS NOT NULL THEN
    -- Auth invited_at distingue las invitaciones de un signUp público.
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
      id,
      tenant_id,
      nombre_completo,
      correo,
      rol,
      activo
    ) VALUES (
      NEW.id,
      v_tenant_id,
      v_nombre_completo,
      NEW.email,
      v_rol,
      true
    );

  ELSE
    -- Flujo: Auto-registro de un nuevo productor (alta de finca nueva)
    v_nombre_finca := COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'nombre_finca'), ''),
      'Finca de ' || v_nombre_completo
    );

    -- 1. Crear la nueva finca (tenant)
    INSERT INTO public.tenant (nombre_finca)
    VALUES (v_nombre_finca)
    RETURNING id INTO v_tenant_id;

    -- 2. Crear el usuario como PROPIETARIO indiscutible de su finca
    -- REGLA DURA: rol quemado como 'propietario', nunca leído de metadata de usuario
    INSERT INTO public.usuario (
      id,
      tenant_id,
      nombre_completo,
      correo,
      rol,
      activo
    ) VALUES (
      NEW.id,
      v_tenant_id,
      v_nombre_completo,
      NEW.email,
      'propietario'::public.rol_usuario,
      true
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Vincular trigger a auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();


-- ------------------------------------------------------------------------------
-- 2. CUSTOM ACCESS TOKEN HOOK: Inyección de tenant_id y rol en el JWT
-- ------------------------------------------------------------------------------
-- Este hook es invocado por Supabase Auth antes de emitir cualquier JWT.
-- Inyecta 'tenant_id' y 'rol' directamente en los claims del token.
-- Permite que el backend y las políticas RLS accedan a estos valores sin queries adicionales.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_rol public.rol_usuario;
  v_claims jsonb;
BEGIN
  -- Extraer el objeto claims actual del evento de autenticación
  v_claims := event->'claims';

  -- Buscar la asignación de finca y rol del usuario en la tabla usuario
  SELECT tenant_id, rol
    INTO v_tenant_id, v_rol
    FROM public.usuario
   WHERE id = (event->>'user_id')::UUID
     AND activo = true;

  -- Manejo de resiliencia: Si aún no existe el registro en usuario
  -- (ej. race condition inmediata al registrarse) o el usuario está inactivo,
  -- se retorna el evento sin modificar en vez de abortar el flujo de autenticación.
  IF v_tenant_id IS NULL THEN
    RETURN event;
  END IF;

  -- Inyectar las claims requeridas para multi-tenancy y control de acceso
  v_claims := jsonb_set(v_claims, '{tenant_id}', to_jsonb(v_tenant_id::TEXT));
  v_claims := jsonb_set(v_claims, '{rol}', to_jsonb(v_rol::TEXT));

  -- Actualizar el objeto claims en el evento resultante
  event := jsonb_set(event, '{claims}', v_claims);

  RETURN event;
END;
$$;


-- ------------------------------------------------------------------------------
-- 3. PERMISOS Y SEGURIDAD (Grant / Revoke)
-- ------------------------------------------------------------------------------
-- Configuración de privilegios mínimos para que supabase_auth_admin pueda ejecutar
-- el hook y leer la tabla usuario con seguridad.

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;

GRANT SELECT ON TABLE public.usuario TO supabase_auth_admin;


-- ------------------------------------------------------------------------------
-- 4. PASO MANUAL REQUERIDO EN EL DASHBOARD DE SUPABASE
-- ------------------------------------------------------------------------------
-- Para que Supabase comience a ejecutar esta función al emitir tokens:
-- 1. Abrir el Dashboard de Supabase del proyecto ResDigital.
-- 2. Ir a: Authentication → Hooks (o Auth Hooks).
-- 3. En la sección "Custom Access Token (Auth Hook)", hacer clic en Enable.
-- 4. Seleccionar el tipo "PostgreSQL Function".
-- 5. Seleccionar la función: public.custom_access_token_hook.
-- 6. Guardar cambios.
