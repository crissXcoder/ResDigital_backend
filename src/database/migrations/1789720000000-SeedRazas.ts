import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Carga/corrige las 6 razas base del catálogo global (Reglas-de-Negocio-Ganaderas.md).
 * Nunca usar 280 días fijos para todas las razas (bug B1) — cada una tiene su
 * propio dias_gestacion real, verificado contra fuentes veterinarias.
 *
 * Requiere que SecureCatalogoRazaAndMigrations (1789710000000) haya corrido antes:
 * depende del UNIQUE(nombre) para el ON CONFLICT.
 *
 * `tenant_id = NULL` promueve estas 6 filas a razas GLOBALES (visibles para
 * todas las fincas), incluso si ya existían mal etiquetadas con el tenant_id
 * de una finca específica. Otras razas del catálogo (ej. las que cada finca
 * agregue como propias/criollas) no se tocan.
 */
export class SeedRazas1789720000000 implements MigrationInterface {
  name = 'SeedRazas1789720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO catalogo_raza (nombre, dias_gestacion, tenant_id)
      VALUES
        ('Holstein', 281, NULL),
        ('Jersey', 279, NULL),
        ('Pardo Suizo', 290, NULL),
        ('Brahman', 293, NULL),
        ('Nelore', 293, NULL),
        ('Girolando', 290, NULL)
      ON CONFLICT (nombre) DO UPDATE
        SET dias_gestacion = EXCLUDED.dias_gestacion,
            tenant_id = NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revertir dias_gestacion a los valores previos solo si ningún animal
    // referencia esa raza (evita romper cálculos de FPP ya existentes).
    await queryRunner.query(`
      UPDATE catalogo_raza SET dias_gestacion = 280
        WHERE nombre = 'Holstein'
          AND NOT EXISTS (SELECT 1 FROM animal WHERE raza_id = catalogo_raza.id);
      UPDATE catalogo_raza SET dias_gestacion = 280
        WHERE nombre = 'Jersey'
          AND NOT EXISTS (SELECT 1 FROM animal WHERE raza_id = catalogo_raza.id);
    `);
    // Pardo Suizo, Brahman, Nelore, Girolando ya tenían sus valores correctos
    // antes de esta migración (290/290/293/290) — no hay nada que revertir ahí.
  }
}
