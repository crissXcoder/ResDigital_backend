import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índices para las dos consultas calientes del módulo reproductivo.
 *
 * `ReproductiveStateService.calcularEstado` recorre los eventos de un animal
 * filtrando por `(animal_id, tenant_id, revertido)` y ordenando por
 * `fecha_evento`. El endpoint de próximos eventos hace lo mismo para todas las
 * hembras activas de la finca, y el endpoint de historial recorre el mismo
 * conjunto.
 *
 * El patrón Evento-Estado-Alerta implica que el estado se deriva siempre del
 * historial, así que estas consultas se ejecutan en cada lectura por diseño.
 * Los índices son lo que mantiene barato ese "cálculo al vuelo" que
 * Patron-Evento-Estado-Alerta.md recomienda para el MVP.
 */
export class AddEventoQueryIndexes1789740000007 implements MigrationInterface {
  name = 'AddEventoQueryIndexes1789740000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_evento_tenant_animal_fecha
        ON public.evento(tenant_id, animal_id, fecha_evento);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_evento_tenant_tipo_activo
        ON public.evento(tenant_id, tipo)
        WHERE revertido = false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS public.idx_evento_tenant_tipo_activo;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS public.idx_evento_tenant_animal_fecha;`,
    );
  }
}
