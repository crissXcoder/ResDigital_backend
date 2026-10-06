import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentoUrlToTratamiento1789596438664 implements MigrationInterface {
  name = 'AddDocumentoUrlToTratamiento1789596438664';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // CreateMissingTables1789550000000 ya crea documento_url dentro del
    // CREATE TABLE. En una base limpia esta migración fallaba por columna
    // duplicada. El IF NOT EXISTS la vuelve idempotente sin cambiar el
    // resultado en las bases donde ya corrió.
    await queryRunner.query(
      `ALTER TABLE "tratamiento_sanitario" ADD COLUMN IF NOT EXISTS "documento_url" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tratamiento_sanitario" DROP COLUMN IF EXISTS "documento_url"`,
    );
  }
}
