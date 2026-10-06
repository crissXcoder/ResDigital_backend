# Runbook 03 — documentos privados de animales

**Estado al 2026-10-05:** SEC-T002 completada según sus criterios de aceptación. Los dos documentos existentes se migraron y el flujo Auth → API → Storage se verificó contra la base Supabase `ca-glass-solutions` con usuarios/tenant/animal efímeros `SEC-T002-AUTOTEST`, eliminados al terminar. Solo Supabase (base de datos) está desplegada; backend y frontend se ejecutaron localmente.

## Contrato de almacenamiento

Los objetos nuevos usan `<tenant_uuid>/<animal_uuid>/<categoria>/<documento_uuid>.<pdf|png|jpg>`. El cliente sube sin `upsert`, persiste `object_path` por la API NestJS y solicita enlaces firmados de 10 minutos para ver documentos. `archivo_url` queda nulo en los registros nuevos y migrados.

El backend exige que la ruta corresponda al tenant autenticado y al animal de la solicitud antes de persistirla. Storage RLS restringe SELECT/INSERT/DELETE al tenant del JWT y al patrón completo de ruta. No existe permiso UPDATE/upsert. La política no acredita por sí misma que el UUID de animal exista o pertenezca al tenant; ese control vive en el servicio NestJS.

## Estado remoto observado

- Bucket `animal_docs`: privado, límite 10 MiB y MIME PDF/PNG/JPEG (MCP, 2026-10-05).
- Políticas activas: `animal_docs_select_tenant`, `animal_docs_insert_tenant`, `animal_docs_delete_tenant`, rol `authenticated`; no hay política UPDATE (consulta MCP `pg_policies`, 2026-10-05).
- Dos documentos existentes se inspeccionaron por path, tamaño y MIME; ambas filas tenían `object_path` y `archivo_url=NULL` tras la migración.
- La consola creó carpetas vacías durante una operación previa; no participan en el flujo y se conservan como observación.

## Evidencia E2E (2026-10-05)

- Se inició NestJS local en el puerto 3003 contra la BD remota configurada; validó el rol restringido de RLS en el arranque. No se ejecutaron migraciones ni seeds.
- Se crearon dos cuentas Auth de prueba con registro confirmado, tenants aislados y nombres marcados `SEC-T002-AUTOTEST`. El trigger de registro generó sus perfiles; el Custom Access Token Hook emitió `tenant_id` y `rol` raíz.
- Con la sesión real del propietario: `GET /auth/perfil` 200; `POST /animales` 201; carga canónica Storage 201; `POST /animales/:id/documentos` 201; listado 200; URL firmada descargó el mismo contenido PDF con HTTP 200.
- Abuso: el tenant ajeno recibió 404 al listar y registrar en el animal; Storage rechazó la firma de su objeto con 404, anon recibió HTTP 400 y una ruta con categoría fuera del patrón recibió 403.
- El script retiró objeto, documento, animal y cuentas temporales. La consulta final encontró dos tenants huérfanos creados por los intentos de setup fallidos; se borraron por UUID y nombre de prueba con guardia de ausencia de usuarios. La verificación final dio 0 tenants, usuarios, animales, documentos u objetos con marcadores SEC-T002.
- En navegador local, visitar `/hato/{id}` sin sesión redirigió a `/login`. La UI autenticada no se recorrió; el E2E anterior ejercitó el mismo contrato por SDK/Auth real y API NestJS.

## Historial de esquema

El campo y las políticas se aplicaron vía Supabase MCP `apply_migration` en `ca-glass-solutions` el 2026-10-05 y se verificaron luego por lectura de esquema y `pg_policies`. La tabla de historial TypeORM no pudo consultarse con el rol de aplicación porque TypeORM intentó crearla en `public` y recibió `permission denied`; no se ejecutó `migration:run`. Esto no bloquea SEC-T002: Supabase registra sus migraciones y el backend/frontend no están desplegados. No ejecutar el historial TypeORM contra esta base sin una decisión operativa aparte.

## Criterios SEC-T002

- [x] Bucket privado y límite/MIME permitidos verificados en Supabase.
- [x] Path tenant/animal/categoría/UUID implementado y ejercitado por carga real.
- [x] `object_path` persistido y `archivo_url` nullable.
- [x] URL anónima rechazada y URL firmada del propietario descarga el contenido.
- [x] Dos objetos existentes migrados y sus referencias verificadas.
- [x] Pruebas adversariales: tenant ajeno, anon y ruta inválida denegados.
- [x] Actualizada ficha SEC-T002 y `Estado-Actual.md` de MOD-00.

## Observaciones fuera de los criterios SEC-T002

- El flujo de documentos Auth → API → Storage se probó con sesiones reales; la UI autenticada no se recorrió visualmente. La autenticación redirige a `/login` si falta sesión.
- TypeORM `migration:show` intentó crear la tabla de historial en `public` y recibió `permission denied`; no se aplicó esa operación ni `migration:run`. La migración del esquema fue aplicada vía Supabase MCP y verificada directamente. Backend y frontend no están desplegados.
- Frontend TypeScript/ESLint no se pudo repetir en esta ejecución (dependencias locales faltantes/invocación Windows); una ejecución previa registrada había pasado pruebas focalizadas. TypeScript backend pasó.
- `.emptyFolderPlaceholder` vacíos creados durante la operación anterior siguen presentes; no intervienen en la lectura ni escritura de documentos.
