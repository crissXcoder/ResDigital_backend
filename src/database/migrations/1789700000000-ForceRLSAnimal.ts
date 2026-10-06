import { MigrationInterface, QueryRunner } from 'typeorm';

export class ForceRLSAnimal1789700000000 implements MigrationInterface {
  name = 'ForceRLSAnimal1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "animal" FORCE ROW LEVEL SECURITY`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: FORCE ROW LEVEL SECURITY can't easily be undone if we don't know the prior state,
    // but usually NO FORCE ROW LEVEL SECURITY is the default.
    await queryRunner.query(`ALTER TABLE "animal" NO FORCE ROW LEVEL SECURITY`);
  }
}
