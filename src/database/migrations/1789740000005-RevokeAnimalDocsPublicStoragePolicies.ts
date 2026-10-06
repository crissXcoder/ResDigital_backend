import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Revoca las políticas abiertas del bucket de storage `animal_docs`.
 *
 * Un script suelto (`fix-rls.mjs`, ya eliminado del repositorio) se ejecutó a
 * mano contra la base y creó cuatro políticas sobre `storage.objects` que
 * conceden INSERT, SELECT, UPDATE y DELETE `TO public` sobre el bucket
 * `animal_docs`, **sin ningún filtro de tenant**.
 *
 * En Postgres `public` incluye a `anon`, el rol con el que responde PostgREST
 * usando la anon key, que es pública por diseño. En la práctica eso significa
 * que cualquiera con esa clave podía leer, sobrescribir y borrar los documentos
 * de todas las fincas del sistema.
 *
 * Como el script corrió fuera de TypeORM, no existía migración que lo revirtiera
 * ni rastro en `public.migrations`: el estado vivía únicamente en la base.
 *
 * La política nueva exige sesión autenticada y acota por carpeta: se asume que
 * los objetos se guardan como `<tenant_id>/<archivo>`. Si el frontend todavía no
 * usa esa convención de rutas, la política bloqueará las subidas — eso es
 * intencional y está documentado en el runbook 03.
 *
 * NOTA: esta migración NO cambia la bandera `public` del bucket. Pasar el bucket
 * a privado rompe cualquier consumidor que use `getPublicUrl()`, así que es un
 * paso manual y coordinado con el frontend. Ver docs/runbooks/03-storage-animal-docs.md.
 *
 * Todo el bloque va envuelto en un manejador de excepciones porque
 * `storage.objects` pertenece a `supabase_storage_admin`: según con qué rol
 * corran las migraciones, puede no haber privilegio para alterarla. Si falla,
 * la migración no aborta y el runbook 03 trae el mismo SQL para pegarlo en el
 * SQL Editor del Dashboard, que sí corre con privilegios suficientes.
 */

const POLITICAS_A_ELIMINAR = [
  'Allow public uploads animal_docs',
  'Allow public read animal_docs',
  'Allow public update animal_docs',
  'Allow public delete animal_docs',
];

export class RevokeAnimalDocsPublicStoragePolicies1789740000005 implements MigrationInterface {
  name = 'RevokeAnimalDocsPublicStoragePolicies1789740000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const drops = POLITICAS_A_ELIMINAR.map(
      (p) => `        DROP POLICY IF EXISTS "${p}" ON storage.objects;`,
    ).join('\n');

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('storage.objects') IS NULL THEN
          RAISE NOTICE 'storage.objects no existe (base sin Supabase Storage); se omite.';
          RETURN;
        END IF;

${drops}

        DROP POLICY IF EXISTS "animal_docs_tenant_rw" ON storage.objects;
        CREATE POLICY "animal_docs_tenant_rw" ON storage.objects
          FOR ALL
          TO authenticated
          USING (
            bucket_id = 'animal_docs'
            AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
          )
          WITH CHECK (
            bucket_id = 'animal_docs'
            AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
          );
      EXCEPTION
        WHEN insufficient_privilege THEN
          RAISE NOTICE 'Sin privilegios sobre storage.objects. Aplicar el SQL del runbook 03 desde el SQL Editor del Dashboard.';
        WHEN undefined_function THEN
          RAISE NOTICE 'Funciones de Supabase Storage no disponibles. Aplicar el SQL del runbook 03 manualmente.';
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No se restauran las políticas abiertas: eran el problema, no un estado al
    // que tenga sentido volver.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('storage.objects') IS NOT NULL THEN
          DROP POLICY IF EXISTS "animal_docs_tenant_rw" ON storage.objects;
        END IF;
      EXCEPTION
        WHEN insufficient_privilege THEN
          RAISE NOTICE 'Sin privilegios sobre storage.objects.';
      END $$;
    `);
  }
}
