import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Extiende tratamiento_sanitario con retiros duales leche/carne y fechas
 * de liberación persistidas. Backfill desde dias_retiro + fecha.
 */
export class AddDualRetiroToTratamiento1789740000008 implements MigrationInterface {
  name = 'AddDualRetiroToTratamiento1789740000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tratamiento_sanitario"
        ADD COLUMN IF NOT EXISTS "dias_retiro_leche" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "dias_retiro_carne" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "fecha_liberacion_leche" date,
        ADD COLUMN IF NOT EXISTS "fecha_liberacion_carne" date
    `);

    await queryRunner.query(`
      UPDATE "tratamiento_sanitario"
      SET
        "dias_retiro_leche" = COALESCE("dias_retiro", 0),
        "dias_retiro_carne" = COALESCE("dias_retiro", 0),
        "fecha_liberacion_leche" = ("fecha"::date + (COALESCE("dias_retiro", 0) * INTERVAL '1 day'))::date,
        "fecha_liberacion_carne" = ("fecha"::date + (COALESCE("dias_retiro", 0) * INTERVAL '1 day'))::date
      WHERE "fecha_liberacion_leche" IS NULL OR "fecha_liberacion_carne" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tratamiento_sanitario"
        DROP COLUMN IF EXISTS "fecha_liberacion_carne",
        DROP COLUMN IF EXISTS "fecha_liberacion_leche",
        DROP COLUMN IF EXISTS "dias_retiro_carne",
        DROP COLUMN IF EXISTS "dias_retiro_leche"
    `);
  }
}
