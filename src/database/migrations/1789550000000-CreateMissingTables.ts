import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMissingTables1789550000000 implements MigrationInterface {
  name = 'CreateMissingTables1789550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Columna potrero en animal
    await queryRunner.query(
      `ALTER TABLE "animal" ADD COLUMN IF NOT EXISTS "potrero" text`,
    );

    // Tabla pesaje
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pesaje" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "animal_id" uuid NOT NULL,
        "fecha" date NOT NULL,
        "peso_actual_kg" numeric(6,1),
        "leche_manana_l" numeric(5,1),
        "leche_tarde_l" numeric(5,1),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pesaje_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pesaje_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pesaje_animal" FOREIGN KEY ("animal_id") REFERENCES "animal"("id") ON DELETE CASCADE
      )
    `);

    // Habilitar RLS en pesaje
    await queryRunner.query(`ALTER TABLE "pesaje" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_pesaje" ON "pesaje"
      AS PERMISSIVE FOR ALL
      TO public
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    `);
    await queryRunner.query(`ALTER TABLE "pesaje" FORCE ROW LEVEL SECURITY`);

    // Tabla documento_animal
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "documento_animal" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "animal_id" uuid NOT NULL,
        "tipo" varchar(50) NOT NULL,
        "archivo_url" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_documento_animal_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_documento_animal_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_documento_animal_animal" FOREIGN KEY ("animal_id") REFERENCES "animal"("id") ON DELETE CASCADE
      )
    `);

    // Habilitar RLS en documento_animal
    await queryRunner.query(
      `ALTER TABLE "documento_animal" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_documento_animal" ON "documento_animal"
      AS PERMISSIVE FOR ALL
      TO public
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    `);
    await queryRunner.query(
      `ALTER TABLE "documento_animal" FORCE ROW LEVEL SECURITY`,
    );

    // Tabla tratamiento_sanitario
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tratamiento_sanitario" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "animal_id" uuid NOT NULL,
        "farmaco" varchar(100) NOT NULL,
        "dosis" varchar(50) NOT NULL,
        "via" varchar(50),
        "fecha" date NOT NULL,
        "diagnostico" text NOT NULL,
        "veterinario" varchar(100),
        "dias_retiro" integer,
        "documento_url" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tratamiento_sanitario_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tratamiento_sanitario_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tratamiento_sanitario_animal" FOREIGN KEY ("animal_id") REFERENCES "animal"("id") ON DELETE CASCADE
      )
    `);

    // Habilitar RLS en tratamiento_sanitario
    await queryRunner.query(
      `ALTER TABLE "tratamiento_sanitario" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation_tratamiento_sanitario" ON "tratamiento_sanitario"
      AS PERMISSIVE FOR ALL
      TO public
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    `);
    await queryRunner.query(
      `ALTER TABLE "tratamiento_sanitario" FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tratamiento_sanitario"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "documento_animal"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pesaje"`);
    await queryRunner.query(
      `ALTER TABLE "animal" DROP COLUMN IF EXISTS "potrero"`,
    );
  }
}
