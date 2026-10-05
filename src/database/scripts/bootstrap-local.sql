-- Bootstrap de una base Postgres local para verificar la cadena de migraciones.
--
-- Problema que resuelve: el esquema de ResDigital asume el entorno de Supabase.
-- Varias migraciones referencian `auth.users`, llaman a `auth.jwt()` y crean
-- políticas `TO authenticated` / `TO supabase_auth_admin`. Nada de eso existe en
-- un Postgres recién instalado, así que `pnpm migration:run` falla por razones
-- que no tienen que ver con las migraciones.
--
-- Este script crea el mínimo andamiaje para que la cadena corra en limpio y se
-- pueda comprobar que es replayable. NO reproduce Supabase: no hay GoTrue, no
-- hay Storage, no hay PostgREST. Solo sirve para validar migraciones.
--
-- Uso:
--   docker run -d --name resdigital-test -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:15
--   psql postgresql://postgres:test@localhost:5433/postgres -f src/database/scripts/bootstrap-local.sql
--   pnpm build
--   DATABASE_URL=postgresql://postgres:test@localhost:5433/postgres pnpm migration:run

-- 1. Extensiones que usan las migraciones
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- uuid_generate_v4()

-- 2. Roles de Supabase. NOLOGIN: acá solo hacen falta como destinatarios de las
-- políticas RLS, nadie se conecta con ellos.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resdigital_app') THEN
    CREATE ROLE resdigital_app LOGIN NOINHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

-- Credenciales aleatorias de un solo uso para el PostgREST efímero del smoke test.
-- El proceso que invoca psql genera y suministra ambas variables.
ALTER ROLE authenticator LOGIN PASSWORD :'api_password';
ALTER ROLE resdigital_app PASSWORD :'app_password';
GRANT anon, authenticated TO authenticator;

GRANT USAGE ON SCHEMA public TO anon, authenticated, authenticator, service_role;
-- El script de aprovisionamiento anterior concedía CREATE directamente al rol.
-- El replay debe probar que la migración elimina también ese permiso heredado.
GRANT CREATE ON SCHEMA public TO resdigital_app;

-- 3. Esquema `auth` mínimo.
CREATE SCHEMA IF NOT EXISTS auth;

-- `usuario.id` tiene FK contra auth.users(id).
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT
);

-- Stub de auth.jwt(). En Supabase esta función lee los claims del JWT que
-- PostgREST deja en el parámetro de sesión `request.jwt.claims`. La versión real
-- hace lo mismo, así que las políticas se comportan igual mientras el cliente
-- fije ese parámetro — que es exactamente lo que hace RlsTransactionInterceptor.
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;

-- 4. La migración de aislamiento revoca defaults para el creador efectivo y
-- para `postgres` cuando exista. Las migraciones conceden permisos explícitos.
-- Reproduce los defaults públicos observados en Supabase: grants por esquema
-- se suman al EXECUTE implícito global de PUBLIC y deben revocarse ambos.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
