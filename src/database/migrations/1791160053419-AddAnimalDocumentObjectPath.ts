import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnimalDocumentObjectPath1791160053419 implements MigrationInterface {
  name = 'AddAnimalDocumentObjectPath1791160053419';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.documento_animal
        ADD COLUMN IF NOT EXISTS object_path text;

      ALTER TABLE public.documento_animal
        ALTER COLUMN archivo_url DROP NOT NULL;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('storage.objects') IS NULL THEN
          RAISE NOTICE 'storage.objects no existe; se omite la configuración de animal_docs.';
          RETURN;
        END IF;

        DROP POLICY IF EXISTS "animal_docs_insert_auth" ON storage.objects;
        DROP POLICY IF EXISTS "animal_docs_update_auth" ON storage.objects;
        DROP POLICY IF EXISTS "animal_docs_delete_auth" ON storage.objects;
        DROP POLICY IF EXISTS "animal_docs_insert_tenant" ON storage.objects;
        DROP POLICY IF EXISTS "animal_docs_update_tenant" ON storage.objects;
        DROP POLICY IF EXISTS "animal_docs_delete_tenant" ON storage.objects;
        DROP POLICY IF EXISTS "animal_docs_select_tenant" ON storage.objects;
        DROP POLICY IF EXISTS "animal_docs_tenant_rw" ON storage.objects;

        CREATE POLICY "animal_docs_select_tenant" ON storage.objects
          FOR SELECT TO authenticated
          USING (
            bucket_id = 'animal_docs'
            AND split_part(name, '/', 1) = (auth.jwt() ->> 'tenant_id')
            AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[a-z0-9]+(-[a-z0-9]+)*/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](pdf|png|jpg)$'
          );

        CREATE POLICY "animal_docs_insert_tenant" ON storage.objects
          FOR INSERT TO authenticated
          WITH CHECK (
            bucket_id = 'animal_docs'
            AND split_part(name, '/', 1) = (auth.jwt() ->> 'tenant_id')
            AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[a-z0-9]+(-[a-z0-9]+)*/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](pdf|png|jpg)$'
          );

        CREATE POLICY "animal_docs_delete_tenant" ON storage.objects
          FOR DELETE TO authenticated
          USING (
            bucket_id = 'animal_docs'
            AND split_part(name, '/', 1) = (auth.jwt() ->> 'tenant_id')
            AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[a-z0-9]+(-[a-z0-9]+)*/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](pdf|png|jpg)$'
          );
      EXCEPTION
        WHEN insufficient_privilege THEN
          RAISE EXCEPTION 'Sin privilegios para configurar políticas sobre storage.objects.';
        WHEN undefined_function THEN
          RAISE EXCEPTION 'Funciones de Supabase Storage no disponibles para configurar políticas.';
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('storage.objects') IS NOT NULL THEN
          DROP POLICY IF EXISTS "animal_docs_select_tenant" ON storage.objects;
          DROP POLICY IF EXISTS "animal_docs_insert_tenant" ON storage.objects;
          DROP POLICY IF EXISTS "animal_docs_delete_tenant" ON storage.objects;
          CREATE POLICY "animal_docs_tenant_rw" ON storage.objects
            FOR ALL TO authenticated
            USING (
              bucket_id = 'animal_docs'
              AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
            )
            WITH CHECK (
              bucket_id = 'animal_docs'
              AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
            );
        END IF;
      END $$;

      ALTER TABLE public.documento_animal
        DROP COLUMN IF EXISTS object_path;
    `);
  }
}
