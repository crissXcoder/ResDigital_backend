# Runbook 01 — Rotación de credenciales expuestas

**Estado:** pendiente de ejecución · **Responsable:** Cristhian (dueño de MOD-00 Auth/Tenant)
**Prioridad:** máxima. Nada más de la remediación depende de esto, pero esto no depende de nada.

---

## 1. Qué quedó expuesto

Cuatro scripts sueltos en la raíz de `backend/` estaban versionados en git y subidos a
`https://github.com/crissXcoder/backend.git` con credenciales de producción en texto plano.

| Archivo | Qué contenía |
|---|---|
| `seed.cjs` | Cadena de conexión completa a la base de Supabase, con usuario y contraseña |
| `seed-razas.cjs` | La misma cadena de conexión |
| `test.mjs` | La misma cadena de conexión |
| `check-buckets.mjs` | La **`service_role` key** de Supabase (JWT completo) |

Los cuatro ya fueron eliminados del árbol de trabajo. Dos más
(`add-potrero.mjs` y `fix-rls.mjs`) habían sido borrados antes, pero contenían la misma
cadena de conexión.

### Por qué borrarlos no alcanza

Git guarda el contenido de cada commit. La contraseña aparece en al menos tres commits
(`563e2e1`, `6e7b5df`, `65a8554`) y sigue siendo recuperable desde cualquier clon del
repositorio con un solo comando, o desde la API de commits de GitHub. **Borrar los
archivos de la rama actual no invalida nada.** La única acción que corta el acceso de
verdad es rotar las credenciales.

Se decidió no reescribir el historial con `git filter-repo`, porque eso cambia los
hashes de todos los commits y obliga al equipo entero a volver a clonar. La rotación
resuelve el riesgo real sin ese costo.

### Qué puede hacer alguien con esas credenciales

- **Contraseña de la base:** el usuario es el rol dueño de las tablas. Con esa cadena
  se puede leer, modificar y borrar los datos de **todas las fincas**, sin pasar por
  ninguna política de Row Level Security.
- **`service_role` key:** es la llave de mayor privilegio del proyecto. Salta RLS y
  salta la autenticación. La que estaba expuesta vence en 2036.

---

## 2. Rotar la contraseña de la base de datos

1. Entrar al Dashboard de Supabase → proyecto → **Settings → Database**.
2. Sección **Database password** → **Reset database password**.
3. Generar una contraseña nueva y guardarla en el gestor de contraseñas personal.
   No la pegues en el chat del equipo ni en ningún archivo del repositorio.
4. Copiar la cadena de conexión nueva desde **Settings → Database → Connection string →
   URI** (modo *Session*, puerto 5432, que es el que usa TypeORM).
5. Actualizar `DATABASE_URL` en el `backend/.env` local. Ese archivo está en `.gitignore`
   y no se sube.
6. Actualizar `DATABASE_URL` en las variables de entorno del despliegue, si ya hay uno.

### Verificar

```bash
cd backend
pnpm migration:show     # debe listar las migraciones, no dar error de autenticación
pnpm start:dev          # debe arrancar y conectar
```

---

## 3. Rotar la `service_role` key

> ⚠️ **Esto invalida todas las sesiones activas.** Todos los usuarios, incluido el
> equipo, van a tener que volver a iniciar sesión. Hacerlo en un momento en que nadie
> esté en medio de una demo.

1. Dashboard → **Settings → API** → sección **JWT Settings**.
2. **Generate new JWT secret**. Esto regenera la `anon key` y la `service_role key`.
3. Copiar las tres claves nuevas (`SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_ANON_KEY`) al `backend/.env`.
4. Actualizar `NEXT_PUBLIC_SUPABASE_ANON_KEY` en el `.env` del repositorio `frontend`.

### Nota sobre el frontend

La `anon key` vieja quedó compilada dentro de los artefactos de build del frontend
(`frontend/.next/`). Eso no es una fuga grave —la `anon key` es pública por diseño—
pero conviene borrar `.next/` y reconstruir después de rotar, para que no queden
referencias a la clave vieja:

```bash
cd frontend
rm -rf .next
pnpm build
```

### Verificar

```bash
cd backend && pnpm test          # los tests de auth deben seguir en verde
```

Luego, iniciar sesión en la aplicación con una cuenta real y confirmar que
`GET /auth/perfil` responde 200 con el `tenant_id` y el `rol` correctos.

---

## 4. Avisar al equipo

Después de rotar la contraseña, el `.env` de Ari, Danny y Karla deja de funcionar.
Mensaje sugerido para el canal del equipo:

> Roté la contraseña de la base de Supabase y el JWT secret del proyecto, porque habían
> quedado subidos al repo en unos scripts sueltos (`seed.cjs`, `test.mjs`,
> `check-buckets.mjs` y `seed-razas.cjs`). Ya los saqué del repo.
>
> Qué necesitan hacer:
> 1. Hagan `git pull` en `backend` y en `frontend`.
> 2. Les paso por privado el `DATABASE_URL` nuevo y las claves de Supabase. Actualicen
>    su `backend/.env` y su `frontend/.env`.
> 3. Van a tener que volver a iniciar sesión en la app; se invalidaron todas las sesiones.
> 4. Si tenían la contraseña vieja anotada en algún lado, bórrenla.
>
> De ahora en adelante: ningún script con una cadena de conexión adentro. Todo lo que
> toque la base va en `src/database/scripts/` y lee de `process.env`. Hay un hook de
> pre-commit que bloquea los commits que traigan credenciales.

---

## 5. Checklist de cierre

- [ ] Contraseña de la base rotada en el Dashboard
- [ ] `DATABASE_URL` actualizada en el `.env` local
- [ ] `DATABASE_URL` actualizada en el entorno de despliegue (si aplica)
- [ ] `pnpm migration:show` y `pnpm start:dev` funcionan con la credencial nueva
- [ ] JWT secret rotado (`anon` y `service_role` regeneradas)
- [ ] Las tres claves actualizadas en `backend/.env`
- [ ] `anon key` actualizada en `frontend/.env` y `.next/` reconstruido
- [ ] Login real verificado de punta a punta
- [ ] Equipo avisado y con sus `.env` al día
- [ ] Contraseña vieja borrada de notas, chats y gestores personales

---

## Pendientes relacionados (otros runbooks)

- **[02 — Rol de mínimo privilegio](./02-rol-minimo-privilegio.md):** la aplicación
  sigue conectando con el rol dueño de las tablas. `Multi-Tenant-y-Seguridad.md` lo
  prohíbe explícitamente. Aplicar **después** de que la suite de tests esté en verde.
- **[03 — Storage `animal_docs`](./03-storage-animal-docs.md):** el bucket de documentos
  quedó público y con políticas abiertas a usuarios sin sesión.
