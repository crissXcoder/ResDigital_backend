# ResDigital — Backend (API)

API de **ResDigital**, plataforma de trazabilidad y gestión ganadera para pequeños y medianos ganaderos de Costa Rica. Cubre hato, reproducción, sanidad (con retiros de leche y carne), potreros y producción lechera.

> El frontend vive en el repositorio `frontend`. Para ver la aplicación completa hay que levantar los dos.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | NestJS (ESM) + TypeScript |
| Base de datos | PostgreSQL en Supabase, con TypeORM (solo migraciones; `synchronize` siempre en `false`) |
| Autenticación | Supabase Auth. El backend solo verifica el JWT contra JWKS (ES256, librería `jose`); nunca ve contraseñas |
| Autorización | Roles `propietario`, `administrador`, `peon`, `veterinario` + Row Level Security por finca (tenant) |
| Seguridad | `helmet`, límite de peticiones (`express-rate-limit`), validación con `class-validator` |
| Documentación | OpenAPI/Swagger en `/api` (solo si está habilitado) |
| Pruebas | Vitest (unitarias, integración con RLS y e2e) |
| Gestor de paquetes | pnpm 10.32.1, Node `>=24.14 <25` |

## Requisitos

- Node 24.14.x y pnpm 10.32.1.
- Un proyecto de Supabase con su base de datos y Auth.
- El certificado raíz de Supabase (hay una copia en `.certs/supabase-ca.pem`).

## Puesta en marcha

1. Instalar dependencias:

   ```bash
   pnpm install
   ```

2. Crear el archivo de entorno a partir del ejemplo y completar los valores:

   ```bash
   cp .env.example .env
   ```

   Variables principales (los valores reales los entrega el equipo; **nunca** se suben al repositorio):

   | Variable | Para qué sirve |
   |---|---|
   | `PORT` | Puerto de la API (por defecto `3001`) |
   | `FRONTEND_URL` | Origen permitido por CORS (en local, `http://localhost:3000`) |
   | `DATABASE_URL` | Cadena de conexión a PostgreSQL de Supabase |
   | `DATABASE_CA_CERT` | **Obligatoria con Supabase.** Contenido PEM del certificado raíz |
   | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | Conexión a Supabase Auth |
   | `SWAGGER_ENABLED` | Activa la documentación en `/api` |
   | `THROTTLE_TTL`, `THROTTLE_LIMIT` | Ventana y límite de peticiones |

   **Importante sobre `DATABASE_CA_CERT`:** si falta, la API no arranca y muestra el error "DATABASE_CA_CERT es obligatorio". Puede definirse en el `.env` con el contenido del PEM o exportarse al lanzar el proceso, por ejemplo en Git Bash:

   ```bash
   export DATABASE_CA_CERT="$(cat .certs/supabase-ca.pem)"
   ```

3. Aplicar las migraciones (crean tablas, políticas RLS y permisos):

   ```bash
   pnpm migration:run
   ```

4. Cargar datos de ejemplo para desarrollo (idempotente):

   ```bash
   pnpm seed:dev           # finca demo y usuarios de cada rol
   pnpm seed:sanitary      # catálogos de medicamentos y padecimientos
   pnpm seed:reproductivo  # animales y eventos reproductivos de ejemplo
   ```

   Los correos y contraseñas de los usuarios demo están en `src/database/scripts/seed-dev.ts`. Solo deben usarse en desarrollo.

5. Levantar la API:

   ```bash
   pnpm start:dev     # modo desarrollo con recarga
   pnpm start         # una sola ejecución
   pnpm start:prod    # requiere `pnpm build` antes
   ```

   La API queda en `http://localhost:3001`. Una petición sin token a una ruta protegida responde `401`, lo que confirma que arrancó bien.

## Estructura

```
src/
  auth/          Verificación de JWT, roles, invitaciones, RLS por request
  animales/      Hato, bajas, reactivación, documentos, genealogía
  reproductivo/  Servicio, diagnóstico, parto, secado y estado reproductivo
  tratamientos/  Tratamientos como eventos auditables y retiros de leche y carne
  sanitary/      Catálogos de medicamentos y padecimientos
  produccion/    Lactancia derivada y producción de leche (con descarte por retiro)
  pesajes/       Pesajes (solo peso)
  potreros/      Potreros, carga animal (UA) y movimientos
  catalogos/     Razas
  database/      Migraciones, scripts de seed y opciones SSL
```

## Pruebas

```bash
pnpm test               # unitarias
pnpm test:integration   # integración y RLS: escriben en la base real de DATABASE_URL
pnpm test:e2e           # extremo a extremo
pnpm typecheck          # tipos
pnpm lint               # oxlint
```

Las pruebas de integración escriben en la base configurada, por eso exigen una bandera explícita y dos usuarios de prueba existentes (`TEST_USER_A_ID`, `TEST_USER_B_ID`). Ver `.env.example`.

## Contrato con el frontend

El backend genera el contrato OpenAPI y lo sincroniza con el frontend:

```bash
pnpm openapi:generate   # genera openapi.json y lo copia al frontend
pnpm openapi:check      # verifica que no haya desfase
```

## Zona horaria y formatos

La fecha "de hoy" se calcula en la zona de la finca, `America/Costa_Rica` (UTC−6), y no en la del servidor. La API usa fechas `YYYY-MM-DD` y mensajes de validación en español con fechas `DD/MM/AAAA`.

## Git y CI

- `main` y `dev` reciben cambios por PR, con revisión de otro integrante, CODEOWNERS y todos los checks requeridos.
- Node `24.14.x` y pnpm `10.32.1` son las versiones fijadas. No se añaden dependencias para estas barreras.
- Husky usa el pre-commit para escanear el index con Gitleaks y bloquear si el scanner falta o falla; el auto-fix anterior de `lint-staged` ya no cambia archivos durante commit.
- `pnpm git:setup-hooks` configura hooks solo en este clon; `pnpm git:workflows` valida YAML/actions con SHA. Los binarios se guardan dentro del directorio Git con SHA-256 verificado.
- CI verifica PR, secretos, dependencias, lint, tipos, unit tests, build, replay de migraciones contra PostgreSQL descartable y workflows. Ningún job fallido/omitido pasa el check agregador.
- Dependabot propone actualizaciones semanalmente sin auto-merge. Releases solo se borradorizan para tags en `main` con versión coincidente y CI aprobado.
- CD queda pendiente hasta definir ambientes, secretos, aprobadores y rollback.

Detalles y activación remota requieren el protocolo documentado en `00-Sistema/Git-y-Entrega.md` dentro de la bóveda ResDigital.
