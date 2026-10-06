import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Unifica las políticas RLS de las 5 tablas que se salían del estándar del
 * proyecto. Cierra tres problemas distintos de una sola vez:
 *
 * 1. `pesaje`, `documento_animal` y `tratamiento_sanitario` tenían sus políticas
 *    declaradas `TO public`. En Postgres `public` incluye al rol `anon`, que es
 *    con el que responde PostgREST usando la anon key — una clave pública por
 *    diseño. El filtro de tenant seguía aplicando, pero conceder la política a
 *    `anon` amplía la superficie sin ninguna razón: el resto del esquema usa
 *    `TO authenticated`.
 *
 * 2. `animal` y `potrero` tenían políticas sin cláusula `TO` (equivale a
 *    PUBLIC) y, más grave, **sin `WITH CHECK`**. Sin `WITH CHECK` la política
 *    filtra lo que se lee pero no valida lo que se escribe: un INSERT o UPDATE
 *    podía grabar una fila con el `tenant_id` de otra finca.
 *
 * 3. Coexistían dos convenciones para resolver el tenant actual:
 *    `current_setting('app.current_tenant_id')`, que es la que fija
 *    RlsTransactionInterceptor, y `auth.jwt() ->> 'tenant_id'`, la de Supabase.
 *    Cada tabla usaba una sola, así que el acceso que no pasara por la
 *    convención correcta veía cero filas. Ahora todas aceptan ambas vía
 *    COALESCE, igual que ya hacía FixReproductiveEventRLS1789700000001.
 *
 * Los nombres de política se conservan a propósito: hay tests de integración
 * que los verifican contra `pg_policies`.
 */

const PREDICADO_TENANT = `tenant_id = COALESCE(
      NULLIF(current_setting('app.current_tenant_id', true), ''),
      auth.jwt() ->> 'tenant_id'
    )::uuid`;

interface PoliticaTenant {
  tabla: string;
  politica: string;
}

const POLITICAS: PoliticaTenant[] = [
  { tabla: 'pesaje', politica: 'tenant_isolation_pesaje' },
  { tabla: 'documento_animal', politica: 'tenant_isolation_documento_animal' },
  {
    tabla: 'tratamiento_sanitario',
    politica: 'tenant_isolation_tratamiento_sanitario',
  },
  { tabla: 'animal', politica: 'tenant_isolation_policy' },
  { tabla: 'potrero', politica: 'potrero_isolation_policy' },
];

export class UnifyRlsPoliciesToAuthenticated1789740000002 implements MigrationInterface {
  name = 'UnifyRlsPoliciesToAuthenticated1789740000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { tabla, politica } of POLITICAS) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS "${politica}" ON public."${tabla}";`,
      );
      await queryRunner.query(`
        CREATE POLICY "${politica}" ON public."${tabla}"
          AS PERMISSIVE
          FOR ALL
          TO authenticated
          USING (${PREDICADO_TENANT})
          WITH CHECK (${PREDICADO_TENANT});
      `);

      // Defensa en profundidad: ENABLE sin FORCE deja al dueño de la tabla
      // fuera de la política. Ambas banderas ya deberían estar puestas por
      // migraciones anteriores; esto las vuelve a afirmar por si alguna base
      // quedó a medias.
      await queryRunner.query(`
        ALTER TABLE public."${tabla}" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public."${tabla}" FORCE ROW LEVEL SECURITY;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restaura la forma anterior: TO public y solo con la convención
    // app.current_tenant_id. Se deja por completitud del rollback, no porque
    // sea un estado deseable.
    for (const { tabla, politica } of POLITICAS) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS "${politica}" ON public."${tabla}";`,
      );
      await queryRunner.query(`
        CREATE POLICY "${politica}" ON public."${tabla}"
          AS PERMISSIVE
          FOR ALL
          TO public
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
      `);
    }
  }
}
