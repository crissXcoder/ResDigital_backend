import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueIndexDiioAnimal1791238200000
  implements MigrationInterface
{
  name = 'AddUniqueIndexDiioAnimal1791238200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Sanitizar filas con strings vacíos o solo espacios para asegurar que se almacenen como NULL
    await queryRunner.query(`
      UPDATE public.animal
         SET numero_oficial_diio = NULL
       WHERE numero_oficial_diio IS NOT NULL
         AND trim(numero_oficial_diio) = '';
    `);

    // 2. Crear índice único condicional (partial unique index) por tenant
    // Garantiza que cuando un animal posea DIIO oficial, este sea estrictamente único dentro de la finca,
    // permitiendo a la vez múltiples animales sin DIIO asignado (NULL).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_animal_tenant_diio_unique
        ON public.animal (tenant_id, numero_oficial_diio)
       WHERE numero_oficial_diio IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS public.idx_animal_tenant_diio_unique;
    `);
  }
}
