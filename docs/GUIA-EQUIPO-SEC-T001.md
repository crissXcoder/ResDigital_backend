# Configuración del equipo después de SEC-T001

Fecha: 2026-10-04. Responsable de la base compartida: Cristhian.

## Qué cambia y qué sigue igual

Seguimos usando la misma base remota de Supabase: proyecto `jchrtqgzvidlcezzhols`.
No necesitan Docker, una base local ni crear otro proyecto Supabase. El backend y
frontend siguen levantándose localmente con los comandos de siempre.

Nest se conecta ahora con el usuario SQL `resdigital_app`, respetando RLS y la finca
del usuario autenticado. `postgres` se reserva para administración/migraciones.
Los usuarios de la aplicación conservan sus cuentas y roles (propietario,
administrador, peón, veterinario); no tienen que registrarse de nuevo.

La migración ya se ejecutó una vez en la base compartida. No la repitan en cada PC,
no restauren permisos `authenticated` y no cambien contraseñas del proyecto.

## 1. Obtener el código actualizado

Cambiar solamente `.env` no alcanza: el backend anterior todavía puede usar
`SET LOCAL ROLE authenticated` y fallar con los permisos nuevos.

Cristhian debe entregar/publicar la versión de SEC-T001 antes de actualizarse.
Esta guía no implica que los cambios ya estén subidos a Git. Confirmen con él la
rama o revisión que contiene la tarea.

Antes de actualizar, revisen `git status` y conserven cualquier trabajo propio.
Actualicen desde el flujo habitual del equipo; no usen `reset --hard` ni descarten
sus cambios. La versión correcta contiene:

- `src/database/migrations/1791160053418-IsolateDomainAccessToAppRole.ts`.
- El interceptor exige `session_user = current_user = resdigital_app`.
- Las peticiones autenticadas fijan `SET LOCAL ROLE resdigital_app`.

Si falta alguno, pidan la revisión correcta a Cristhian.

## 2. Actualizar solamente la conexión del backend

Cristhian asigna una sola vez la contraseña del rol y les entrega la conexión por
un canal privado. No pongan la contraseña en Git, capturas, tickets ni esta guía.
No necesitan asignarla ni crear el rol en cada computadora.

En `backend/.env`, reemplacen únicamente `DATABASE_URL`:

```dotenv
DATABASE_URL=CONEXION_PRIVADA_ENTREGADA_POR_CRISTHIAN
```

`CONEXION_PRIVADA_ENTREGADA_POR_CRISTHIAN` es un marcador que deben reemplazar por la
URL completa preparada por Cristhian; no copien el marcador literalmente. La conexión
usa estos componentes:

| Componente             | Valor                                        |
| ---------------------- | -------------------------------------------- |
| Usuario SQL del pooler | `resdigital_app.jchrtqgzvidlcezzhols`        |
| Host                   | `aws-1-us-east-1.pooler.supabase.com`        |
| Puerto                 | `5432`                                       |
| Base                   | `postgres`                                   |
| Contraseña             | La nueva del rol, recibida por canal privado |

Si la contraseña tiene caracteres reservados de URL, debe estar codificada.
No usen la contraseña anterior de `postgres`.

Se mantienen host, puerto y base. Se mantienen las variables de Supabase Auth y la
configuración existente de frontend. La contraseña SQL nunca va en `NEXT_PUBLIC_*`.

Solo quienes ejecutan Nest necesitan esta conexión. Quienes usan únicamente un
frontend conectado a la API de otro integrante no necesitan la contraseña SQL.

## 3. Levantar y verificar

En la carpeta `backend`:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm start:dev
```

En otra terminal, dentro de `frontend`:

```powershell
pnpm dev
```

Usen los puertos acordados con el equipo. Con los valores habituales, Nest corre
en `http://localhost:3001` y Next en `http://localhost:3000`.
Si usan puertos diferentes, `NEXT_PUBLIC_BACKEND_URL` del frontend debe apuntar a
Nest y `FRONTEND_URL` del backend debe incluir el origen del frontend.

El backend debe indicar que inició correctamente. Luego:

1. Cierren sesión y vuelvan a entrar con su cuenta existente. Supabase tiene activo
   el hook que agrega `tenant_id` y `rol` desde el perfil de la base; una sesión
   anterior puede conservar un token sin esas claims.
2. Abran Hato o Potreros y comprueben que los datos corresponden a su finca.
3. Prueben una operación permitida para su rol sobre datos de prueba acordados.
4. Si una operación falla, reporten ruta, estado HTTP y mensaje sin tokens ni secretos.

Las pruebas unitarias no ejecutan los tests de integración sobre la base compartida.
No ejecuten `test:integration`, seeds, `migration:run` ni `migration:revert` por su
cuenta contra esa base. Esas operaciones las coordina Cristhian.

## Errores frecuentes

| Error                                                           | Qué revisar                                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Contraseña incorrecta / `28P01`                                 | Credencial nueva de `resdigital_app` y codificación de la URL.                                                    |
| Usuario o tenant del pooler no encontrado                       | Usuario completo `resdigital_app.jchrtqgzvidlcezzhols`; mismo host y puerto 5432.                                 |
| `DATABASE_URL debe autenticar directamente como resdigital_app` | La conexión todavía usa `postgres` u otro usuario.                                                                |
| `permission denied for table` con el backend anterior           | Actualizar el código; no devolver grants a `authenticated`.                                                       |
| `401` desde Nest                                                | Iniciar sesión y revisar JWT/claims de Supabase; la contraseña SQL no es la del usuario de la app.                |
| `403` desde Nest                                                | El rol de aplicación no permite esa acción. No cambiarse el rol por REST.                                         |
| `403`/`42501` usando `.from(...)` para tablas de dominio        | Acceso directo bloqueado a propósito. Usar el endpoint Nest del módulo. Auth y Storage tienen sus flujos propios. |
| Error de conexión o CORS en frontend                            | Comprobar que Nest esté activo y ambos orígenes/puertos coincidan.                                                |

Si detectan código del navegador que lee/escribe tablas de dominio con PostgREST,
avisen al responsable del módulo para usar su endpoint Nest existente. No sustituyan
ese acceso por `service_role` en el navegador ni creen endpoints sin autorización.

## Confirmación que debe enviar cada integrante

```text
Código SEC-T001 recibido: sí/no
DATABASE_URL del backend actualizada: sí/no/no ejecuto backend
Backend inicia: sí/no
Login y lectura de mi finca: sí/no
Operación permitida para mi rol: sí/no
Error pendiente (sin credenciales): ...
```

La verificación de la máquina de Cristhian no confirma automáticamente la instalación
de las demás computadoras. La recepción de estas confirmaciones es seguimiento del equipo.
