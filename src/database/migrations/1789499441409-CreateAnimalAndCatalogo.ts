import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAnimalAndCatalogo1789499441409 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE catalogo_raza (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID,
                nombre TEXT NOT NULL,
                dias_gestacion INT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );

            CREATE TABLE animal (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL,
                nombre TEXT NOT NULL,
                arete_interno TEXT NOT NULL,
                numero_oficial_diio TEXT,
                sexo TEXT NOT NULL CHECK (sexo IN ('Hembra','Macho')),
                raza_id UUID NOT NULL REFERENCES catalogo_raza(id),
                raza_otra TEXT,
                categoria TEXT NOT NULL,
                fecha_nacimiento DATE,
                peso_actual_kg NUMERIC(6,1),
                foto_url TEXT,
                madre_id UUID REFERENCES animal(id),
                padre_id UUID REFERENCES animal(id),
                padre_externo_descripcion TEXT,
                activo BOOLEAN NOT NULL DEFAULT true,
                fecha_baja DATE,
                tipo_baja TEXT,
                motivo_baja TEXT,
                precio_venta_crc NUMERIC(12,2),
                peso_final_kg NUMERIC(6,1),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (tenant_id, arete_interno)
            );

            -- Habilitar RLS en animal
            ALTER TABLE animal ENABLE ROW LEVEL SECURITY;

            -- Políticas de seguridad para animal (aislamiento por tenant)
            DROP POLICY IF EXISTS tenant_isolation_policy ON animal;
            CREATE POLICY tenant_isolation_policy ON animal
                USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP POLICY IF EXISTS tenant_isolation_policy ON animal;
            DROP TABLE IF EXISTS animal;
            DROP TABLE IF EXISTS catalogo_raza;
        `);
    }
}

