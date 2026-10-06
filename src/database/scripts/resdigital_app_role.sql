-- Aprovisionamiento interactivo posterior a IsolateDomainAccessToAppRole.
-- Conectar con un rol administrador de la base; no pasar ni guardar contraseñas
-- en argumentos, variables de psql, archivos o historial del shell.
-- Uso: psql "<conexión administrativa>" -f src/database/scripts/resdigital_app_role.sql

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resdigital_app') THEN
    RAISE EXCEPTION 'Aplique primero la migración IsolateDomainAccessToAppRole';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'resdigital_app'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'resdigital_app tiene atributos privilegiados; se deniega el aprovisionamiento';
  END IF;
END
$$;

ALTER ROLE resdigital_app LOGIN NOINHERIT;

-- psql solicita la contraseña de forma interactiva y no la imprime.
\password resdigital_app

SELECT
  rolname,
  rolsuper AS es_superusuario,
  rolbypassrls AS puede_saltar_rls,
  rolinherit AS hereda_roles,
  has_schema_privilege(rolname, 'public', 'CREATE') AS puede_crear_en_public
FROM pg_roles
WHERE rolname = 'resdigital_app';
