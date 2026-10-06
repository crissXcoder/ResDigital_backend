import { MigrationInterface, QueryRunner } from "typeorm";

export class ForceRLSPotrero1789686241681 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Habilitar RLS en potrero
        await queryRunner.query(`ALTER TABLE "potrero" ENABLE ROW LEVEL SECURITY`);
        
        // Forzar RLS (para que incluso los owners de la tabla sigan la política)
        await queryRunner.query(`ALTER TABLE "potrero" FORCE ROW LEVEL SECURITY`);

        // Políticas de seguridad para potrero (aislamiento por tenant)
        await queryRunner.query(`DROP POLICY IF EXISTS potrero_isolation_policy ON "potrero"`);
        await queryRunner.query(`
            CREATE POLICY potrero_isolation_policy ON "potrero"
                USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP POLICY IF EXISTS potrero_isolation_policy ON "potrero"`);
        await queryRunner.query(`ALTER TABLE "potrero" NO FORCE ROW LEVEL SECURITY`);
        await queryRunner.query(`ALTER TABLE "potrero" DISABLE ROW LEVEL SECURITY`);
    }
}
