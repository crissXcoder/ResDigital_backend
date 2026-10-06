import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnimalPurchaseFields1789538300367 implements MigrationInterface {
  name = 'AddAnimalPurchaseFields1789538300367';

  private static readonly COLUMNAS = [
    ['origen', 'text'],
    ['comprado_a', 'text'],
    ['fecha_compra', 'date'],
    ['valor_compra_crc', 'numeric(12,2)'],
    ['numero_guia', 'text'],
    ['metodo_compra', 'text'],
    ['metodos_combinados', 'text array'],
    ['referencia_pago', 'text'],
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [
      columna,
      tipo,
    ] of AddAnimalPurchaseFields1789538300367.COLUMNAS) {
      await queryRunner.query(
        `ALTER TABLE "animal" ADD COLUMN IF NOT EXISTS "${columna}" ${tipo}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Antes estaba vacío, lo que hacía la migración irreversible.
    for (const [columna] of AddAnimalPurchaseFields1789538300367.COLUMNAS) {
      await queryRunner.query(
        `ALTER TABLE "animal" DROP COLUMN IF EXISTS "${columna}"`,
      );
    }
  }
}
