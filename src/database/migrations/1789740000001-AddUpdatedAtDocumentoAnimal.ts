import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cierra una deriva real de esquema.
 *
 * `DocumentoAnimal` declara `@UpdateDateColumn({ name: 'updated_at' })`, pero
 * CreateMissingTables1789550000000 creó la tabla sin esa columna y ninguna
 * migración posterior la agregó. Resultado: TypeORM incluye `updated_at` en
 * todo INSERT y UPDATE de documentos, y Postgres responde
 * `column "updated_at" of relation "documento_animal" does not exist`.
 *
 * Es decir: subir un documento a un animal falla hoy, siempre.
 */
export class AddUpdatedAtDocumentoAnimal1789740000001 implements MigrationInterface {
  name = 'AddUpdatedAtDocumentoAnimal1789740000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.documento_animal
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.documento_animal DROP COLUMN IF EXISTS updated_at;
    `);
  }
}
