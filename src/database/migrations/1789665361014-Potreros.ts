import { MigrationInterface, QueryRunner } from 'typeorm';

export class Potreros1789665361014 implements MigrationInterface {
  name = 'Potreros1789665361014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Los IF EXISTS son una corrección de idempotencia: esta migración fue
    // autogenerada y asumía objetos que en una base limpia ya no existen
    // (las FK de los catálogos sanitarios salieron de
    // CreateSanitaryCatalogues1726451077000). No cambia el resultado en
    // ninguna base ya migrada.
    await queryRunner.query(
      `ALTER TABLE "catalogo_medicamento" DROP CONSTRAINT IF EXISTS "catalogo_medicamento_tenant_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalogo_padecimiento" DROP CONSTRAINT IF EXISTS "catalogo_padecimiento_medicamento_sugerido_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalogo_padecimiento" DROP CONSTRAINT IF EXISTS "catalogo_padecimiento_tenant_id_fkey"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_catalogo_medicamento_tenant_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_catalogo_padecimiento_tenant_id"`,
    );
    // Postgres no tiene RENAME COLUMN IF EXISTS. El rename es histórico y en
    // la práctica es ruido: las dos líneas siguientes borran la columna y la
    // recrean como uuid. Se conserva para no alterar la semántica original.
    await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'animal'
                      AND column_name = 'potrero'
                ) THEN
                    ALTER TABLE "animal" RENAME COLUMN "potrero" TO "potrero_id";
                END IF;
            END $$;
        `);
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "potrero" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "nombre" text NOT NULL, "area_ha" numeric(6,2) NOT NULL, "tipo_pasto" text, "capacidad_recomendada_ua_ha" numeric(4,2) NOT NULL, "dias_descanso_recomendados" integer NOT NULL, "fecha_ultimo_ingreso" date, "fuente_agua" text, "notas" text, "estado_manual" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7f373d3f2699e8164f637659585" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "animal" DROP COLUMN IF EXISTS "potrero_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "animal" ADD COLUMN IF NOT EXISTS "potrero_id" uuid`,
    );
    await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_27f9b37ba2647c1c99611b692f4') THEN
                    ALTER TABLE "animal" ADD CONSTRAINT "FK_27f9b37ba2647c1c99611b692f4" FOREIGN KEY ("potrero_id") REFERENCES "potrero"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_252aa1253946ca98ff35931afab') THEN
                    ALTER TABLE "catalogo_padecimiento" ADD CONSTRAINT "FK_252aa1253946ca98ff35931afab" FOREIGN KEY ("medicamento_sugerido_id") REFERENCES "catalogo_medicamento"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
                END IF;
            END $$;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "catalogo_padecimiento" DROP CONSTRAINT "FK_252aa1253946ca98ff35931afab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "animal" DROP CONSTRAINT "FK_27f9b37ba2647c1c99611b692f4"`,
    );
    await queryRunner.query(`ALTER TABLE "animal" DROP COLUMN "potrero_id"`);
    await queryRunner.query(`ALTER TABLE "animal" ADD "potrero_id" text`);
    await queryRunner.query(`DROP TABLE "potrero"`);
    await queryRunner.query(
      `ALTER TABLE "animal" RENAME COLUMN "potrero_id" TO "potrero"`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_catalogo_padecimiento_tenant_id" ON "catalogo_padecimiento" USING btree ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_catalogo_medicamento_tenant_id" ON "catalogo_medicamento" USING btree ("tenant_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "catalogo_padecimiento" ADD CONSTRAINT "catalogo_padecimiento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalogo_padecimiento" ADD CONSTRAINT "catalogo_padecimiento_medicamento_sugerido_id_fkey" FOREIGN KEY ("medicamento_sugerido_id") REFERENCES "catalogo_medicamento"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "catalogo_medicamento" ADD CONSTRAINT "catalogo_medicamento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}
