import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Normaliza `evento_parto.facilidad_parto` a un catálogo cerrado.
 *
 * Por qué importa más de lo que parece: la máquina de estados de MOD-03 detecta
 * el aborto comparando este campo contra la cadena exacta `'Aborto'`. Hasta
 * ahora era texto libre, sin `@IsIn` en el DTO ni CHECK en la base, así que un
 * `'aborto'`, un `'ABORTO'` o un `'Aborto tardío'` rompían en silencio la rama
 * `Preñada → Vacía` que MOD-03-Reproductivo.md define como parte del ciclo.
 *
 * El paso de normalización no es opcional: el ejemplo documentado en el propio
 * DTO era `'Normal (Eutócico)'`, un valor que el CHECK rechazaría. Si hay filas
 * con esa forma, el ALTER fallaría sin este UPDATE previo.
 *
 * Los tres valores de dificultad siguen la terminología veterinaria estándar
 * (parto eutócico / distócico / por cesárea) y el aborto se modela como un
 * cuarto valor porque es lo que la máquina de estados necesita distinguir.
 */
export class AddFacilidadPartoCheck1789740000006 implements MigrationInterface {
  name = 'AddFacilidadPartoCheck1789740000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Llevar los valores existentes al catálogo. Lo que no encaje queda NULL
    // en vez de bloquear la migración: es preferible perder un matiz de texto
    // libre antes que dejar la base sin la restricción.
    await queryRunner.query(`
      UPDATE public.evento_parto
      SET facilidad_parto = CASE
        WHEN facilidad_parto IS NULL THEN NULL
        WHEN facilidad_parto ILIKE '%abort%' THEN 'Aborto'
        WHEN facilidad_parto ILIKE '%ces%'   THEN 'Cesárea'
        WHEN facilidad_parto ILIKE '%dist%'  THEN 'Distocia'
        WHEN facilidad_parto ILIKE '%normal%' OR facilidad_parto ILIKE '%eut%' THEN 'Normal'
        ELSE NULL
      END
      WHERE facilidad_parto IS NOT NULL
        AND facilidad_parto NOT IN ('Normal','Distocia','Cesárea','Aborto');
    `);

    // 2. Restricción.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'evento_parto_facilidad_parto_check'
        ) THEN
          ALTER TABLE public.evento_parto
            ADD CONSTRAINT evento_parto_facilidad_parto_check
            CHECK (facilidad_parto IS NULL OR facilidad_parto IN ('Normal','Distocia','Cesárea','Aborto'));
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.evento_parto
        DROP CONSTRAINT IF EXISTS evento_parto_facilidad_parto_check;
    `);
  }
}
