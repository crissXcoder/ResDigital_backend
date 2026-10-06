import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrige una contradicción del modelo de seguridad.
 *
 * SecureCatalogoRazaAndMigrations1789710000000 puso `ENABLE` **y** `FORCE ROW
 * LEVEL SECURITY` sobre `public.migrations` sin crear ninguna política. Esa
 * combinación es un deny-all absoluto: `FORCE` significa precisamente que la
 * política también se le aplica al dueño de la tabla, y sin políticas no hay
 * fila que pase el filtro.
 *
 * El comentario de aquella migración justificaba la decisión diciendo que "la
 * CLI de migraciones sigue funcionando porque conecta con el rol dueño de la
 * tabla". Eso describe mal la semántica de `FORCE`: con `FORCE` el dueño NO
 * queda exento. Hoy `migration:run` solo funciona porque el rol de conexión
 * tiene `BYPASSRLS` — y `Multi-Tenant-y-Seguridad.md` dice, textual:
 *
 *   "Regla no negociable: el rol de base de datos que usa la aplicación nunca
 *    debe tener el privilegio BYPASSRLS ni ser SUPERUSER."
 *
 * Las dos premisas no pueden ser ciertas a la vez. Esta migración se queda con
 * la regla de la bóveda y arregla la tabla.
 *
 * Quitar `FORCE` (dejando `ENABLE`) logra lo que la migración original quería:
 *  - el dueño de la tabla vuelve a leer y escribir, así que la CLI funciona
 *    aunque el rol no tenga BYPASSRLS;
 *  - `anon` y `authenticated` siguen viendo cero filas, porque no hay ninguna
 *    política que se lo permita.
 *
 * El REVOKE es defensa en profundidad: aunque alguien agregara una política por
 * error, esos roles ya no tienen el privilegio de tabla.
 *
 * Requisito previo del runbook 02 (rol de mínimo privilegio): sin esta
 * migración aplicada, un rol sin BYPASSRLS no puede ni leer `public.migrations`
 * y `pnpm migration:run` falla en el arranque.
 */
export class FixMigrationsTableRLS1789740000004 implements MigrationInterface {
  name = 'FixMigrationsTableRLS1789740000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.migrations NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.migrations ENABLE ROW LEVEL SECURITY;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON public.migrations FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON public.migrations FROM authenticated;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.migrations FORCE ROW LEVEL SECURITY;
    `);
  }
}
