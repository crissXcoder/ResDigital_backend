import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RecordPartoLineageReconciliation1792900000000 implements MigrationInterface {
  name = 'RecordPartoLineageReconciliation1792900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE evento_parto
        ADD COLUMN cria_anterior_id uuid,
        ADD COLUMN accion_filiacion_anterior text,
        ADD CONSTRAINT evento_parto_cria_anterior_fk
          FOREIGN KEY (cria_anterior_id) REFERENCES animal(id) ON DELETE RESTRICT,
        ADD CONSTRAINT evento_parto_accion_filiacion_check CHECK (
          (cria_anterior_id IS NULL AND accion_filiacion_anterior IS NULL) OR
          (cria_anterior_id IS NOT NULL AND accion_filiacion_anterior IS NOT NULL AND accion_filiacion_anterior IN ('CONSERVAR', 'DESVINCULAR'))
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE evento_parto
        DROP CONSTRAINT evento_parto_accion_filiacion_check,
        DROP CONSTRAINT evento_parto_cria_anterior_fk,
        DROP COLUMN accion_filiacion_anterior,
        DROP COLUMN cria_anterior_id
    `);
  }
}
