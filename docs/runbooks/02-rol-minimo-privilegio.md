# Runbook 02 — Rol de base de datos con privilegios mínimos

**Estado:** SEC-T001 verificada y terminada; migración Docker/Supabase y runtime local con evidencia real · **Responsable:** Cristhian (MOD-00 Auth/Tenant)
**Última revisión:** 2026-10-04

## Objetivo y controles aplicados por código

Nest se conecta como `resdigital_app`, que no hereda `authenticated`, no es dueño de
tablas y no tiene `SUPERUSER`, `BYPASSRLS` ni `CREATE` sobre `public`. El rol recibe
permisos DML solo en las tablas de dominio, y las políticas RLS conservan el aislamiento
por finca. `anon` y `authenticated` no tienen DML directo en esas tablas.

La migración `IsolateDomainAccessToAppRole1791160053418` aplica estos cambios cuando se
ejecuta deliberadamente por el operador. Se aplicó por el MCP configurado al proyecto
`jchrtqgzvidlcezzhols` y se registró en Supabase y en `public.migrations` para TypeORM.
Su `down` rechaza la reversión automática; cualquier corrección debe ir hacia adelante.

## Evidencia ejecutada — 2026-10-04

- Docker desechable: replay de todas las migraciones sin pendientes; smoke con conexión
  real `resdigital_app`, HTTP PostgREST y JWT simulados para los cuatro roles, intento
  de cambio de rol denegado, aislamiento entre fincas, no filtración del contexto y
  defaults de tabla/secuencia/función cerrados. El bootstrap reproduce los grants por
  esquema de Supabase y el `CREATE` directo del script legado.
- Supabase remoto, mediante MCP: todas las tablas de dominio tienen RLS forzado y
  carecen de DML para `anon`/`authenticated`. El rol dedicado no tiene atributos
  elevados, membresías, propiedad de relaciones públicas ni `CREATE` en `public`.
  Las políticas públicas no conceden acceso a roles cliente y el hook mantiene
  `EXECUTE`/lectura para `supabase_auth_admin`.
- Prueba SQL remota: claims simuladas de propietario/administrador/peon/veterinario
  bajo `SET LOCAL ROLE authenticated` rechazaron las consultas de dominio y el
  `UPDATE usuario.rol`. Se usó `WHERE false` y `ROLLBACK`, sin modificar filas reales.
  Esto demuestra permisos SQL; no sustituye HTTP con JWT emitidos por Supabase Auth.
- El MCP funciona como `postgres` administrado, sin superusuario. Se reemplazó
  `ALTER ROLE ... NOSUPERUSER/NOREPLICATION` por validación cerrada de atributos.
  Los defaults de funciones se revocan globalmente y por esquema.
- El usuario configuró `DATABASE_URL` local. Login PostgreSQL real como
  `resdigital_app`, identidad sin atributos elevados/membresías/propiedad/CREATE,
  `SET ROLE authenticated` denegado y Nest local iniciado correctamente.
- Auth inicialmente emitió JWT sin claims de finca/rol; Dashboard confirmó ausencia
  del hook. Con aprobación explícita adicional se activó el hook existente
  `public.custom_access_token_hook`. Dashboard muestra `ENABLED` y los JWT reales
  ES256 de los cuatro roles contienen las claims del perfil de la base.
- `node tooling/sec-t001-acceptance.mjs`, con opt-in de fixtures remotas y navegador,
  finalizó con código 0: Data API remota bloquea las 17 tablas para `anon` y cuatro
  JWT reales; PATCH de `usuario.rol` denegado y valor persistido intacto. Nest
  devuelve perfiles de los cuatro roles, permite escritura a propietario/admin,
  deniega a peón/veterinario y rechaza acceso cruzado entre dos fincas. Las lecturas
  concurrentes no mezclan tenants.
- SQL con credencial runtime real: lectura propia; UPDATE cruzado sin filas;
  INSERT cruzado denegado y rollback elimina el contexto. Chromium real: ruta
  protegida, error visible de contraseña, login Supabase y potrero de la finca
  autenticada leído desde Nest. Capturas de escritorio y 375 px guardadas.
- Todas las fixtures se eliminaron. Consulta MCP independiente confirmó cero
  cuentas Auth, perfiles, fincas y potreros con marcador `SEC-T001-*`.
- `vitest run`: 111 pruebas en 13 archivos aprobadas. Typecheck, build Nest,
  lint focal, sintaxis/formato de la prueba y `git diff --check` aprobados.
- El agente no editó `.env`, hizo commit ni push. La recepción de código y
  configuración en las máquinas de los compañeros requiere seguimiento del equipo.
- Advisors conserva hallazgos previos: `public.migrations` con RLS sin políticas
  (tabla de tracking administrativo) y protección contra contraseñas filtradas
  desactivada. No se ampliaron los cambios a esos controles.

## Aprovisionar en el proyecto remoto

Ejecutar estos pasos en una ventana de cambio autorizada. No colocar contraseñas en la
línea de comandos, en `.env` del repositorio, ni en evidencia compartida.

1. Respaldar el proyecto y aplicar la migración con el proceso administrativo aprobado.
2. Con una sesión interactiva `psql` conectada como administrador, ejecutar:

   ```text
   \i src/database/scripts/resdigital_app_role.sql
   ```

   El script solicita la contraseña por el prompt seguro de `psql`; luego muestra si el
   rol es superusuario, omite RLS, hereda otros roles o puede crear en `public`. Todos
   esos valores deben ser `false`.

3. Nest y frontend funcionan localmente; Supabase aloja la base remota. Configurar
   `DATABASE_URL` local para `resdigital_app` con la credencial asignada, mediante un
   mecanismo protegido y autorización específica para editar `.env`. La conexión
   administrativa de migraciones debe mantenerse separada del runtime.
4. Reiniciar Nest. El proceso ahora valida durante el arranque el usuario real de la
   conexión, `BYPASSRLS`, propiedad de tablas y permiso `CREATE`; cualquier discrepancia
   detiene el arranque.
5. Ejecutar la matriz de aceptación SEC-T001 antes de cerrar la ventana.

## Verificación posterior

Con la nueva conexión configurada en un ambiente aislado:

```bash
pnpm start:dev
```

Consultar el historial de migraciones mediante el MCP o una conexión administrativa
separada. El usuario runtime no recibe acceso a `public.migrations`.

Comprobar los cuatro roles de usuario mediante la Data API: ninguno debe poder consultar
ni mutar tablas de dominio. Como usuario `peon`, intentar `PATCH usuario.rol`; la petición
debe ser denegada y el valor debe permanecer igual. Desde Nest, comprobar una operación
permitida para `propietario`, una operación prohibida para `peon` y aislamiento entre dos
fincas. Revisar también hook, alta/login, perfiles y conexión de la interfaz.

Los tests que envuelven escritura en `SET LOCAL ROLE resdigital_app` y fijan ambos
contextos (`request.jwt.claims` y `app.current_tenant_id`) solo demuestran el predicado
SQL en la base aislada; no sustituyen las pruebas HTTP contra PostgREST ni contra Nest.
No ejecutar la configuración `test:integration` existente apuntando al proyecto
compartido: sus suites pueden insertar y borrar filas reales.

## Operación y reversión

Los seeds y las migraciones requieren una conexión administrativa separada; no se deben
ejecutar con el usuario runtime. Si hay que retirar el runtime, cambiar la configuración
de despliegue a una credencial aprobada de forma controlada y revocar la contraseña de
`resdigital_app` desde el administrador. No revertir la migración para recuperar acceso
Data API: su `down` mantiene las barreras de privilegio.

## Repetir la aceptación completa

Solo el responsable, con autorización para fixtures en la base compartida. Requiere
Nest/Next locales activos, la conexión runtime y las claves existentes del backend;
no mostrar sus valores. No sustituye el test aislado de defaults/replay Docker.

```powershell
$env:SEC_T001_ALLOW_REMOTE_FIXTURES='true'
$env:SEC_T001_BROWSER='true'
$env:SEC_T001_EVIDENCE_DIR='RUTA_EXISTENTE_PARA_CAPTURAS'
node tooling/sec-t001-acceptance.mjs
```

Por defecto usa Nest `http://localhost:39111` y Next `http://localhost:39110`.
Se pueden fijar `SEC_T001_API_URL` y `SEC_T001_WEB_URL` a los puertos locales activos;
CORS y `NEXT_PUBLIC_BACKEND_URL` deben coincidir. La prueba valida el proyecto y
rol previstos, genera contraseñas aleatorias en memoria y limpia sus fixtures aun
cuando falle. No ejecutar suites de integración generales contra la base compartida.

## Límites y observaciones fuera de SEC-T001

- El alta comprobó el trigger mediante Admin Auth con confirmación automática,
  sin enviar correos. No acredita auto-registro público, entrega de correo ni
  aceptación de invitaciones. Para probar los roles, las pertenencias de fixtures
  se prepararon por el canal administrativo y luego se emitieron JWT reales.
- En el alta administrativa, el perfil inicial fue propietario aunque se envió
  `app_metadata` de otro rol. Confirmado para este método de preparación; el orden
  de asignación de metadata es una hipótesis, no prueba de fallo de invitaciones.
- La captura a 375 px revela layout de Potreros recortado por la barra lateral.
  La cabecera muestra Administrador/Finca San Martín de forma fija. Los datos de
  Potreros sí se contrastaron con la respuesta real de Nest y la finca de prueba.
  Esta ejecución no acredita usabilidad móvil ni una cabecera conectada al perfil.
- Las brechas históricas de invitaciones/Storage/matriz de roles siguen fuera de
  esta tarea. MOD-00 mantiene estado parcial.
- Compartir [GUIA-EQUIPO-SEC-T001.md](../GUIA-EQUIPO-SEC-T001.md): código actualizado,
  nueva `DATABASE_URL` por canal privado, reinicio y nuevo login; Docker no es
  obligatorio para los compañeros.

## Checklist de liberación

- [x] Migración aplicada y permisos/defaults verificados en una base aislada y en Supabase.
- [x] Credencial runtime local configurada por el usuario y conexión real verificada; no se expusieron secretos.
- [x] Nest inicia con `session_user = current_user = resdigital_app`; unit tests rechazan identidades inseguras.
- [x] Pruebas PostgREST remotas: cuatro JWT reales bloqueados; intento de cambio de rol no altera datos.
- [x] Pruebas Nest reales: rol permitido/prohibido, aislamiento entre fincas y no filtración concurrente.
- [x] Hook activo, alta mediante Admin Auth/trigger, login real, perfil y navegador verificados con los límites anteriores.
- [x] Fixtures eliminadas y ausencia confirmada por consulta independiente.
