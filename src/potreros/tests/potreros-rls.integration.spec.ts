import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../database/data-source.js';
import { Potrero } from '../entities/potrero.entity.js';
import { Animal } from '../../animales/entities/animal.entity.js';
import { CatalogoRaza } from '../../catalogos/entities/catalogo-raza.entity.js';
import {
  crearTenantsDePrueba,
  insertarTenants,
  limpiarTenants,
  obtenerUsuariosDePrueba,
} from '../../test-utils/integration-tenant.js';

const usuarios = obtenerUsuariosDePrueba();

describe.skipIf(usuarios === null)(
  'Test de Integración Real RLS — MOD-05 Potreros (Base Real Supabase)',
  () => {
    let dataSource: DataSource;

    const { tenantA, tenantB } = crearTenantsDePrueba();
    const userTenantA = usuarios!.usuarioA;
    const userTenantB = usuarios!.usuarioB;

    let potreroAId: string;

    beforeAll(async () => {
      dataSource = new DataSource({
        ...dataSourceOptions,
        entities: [Potrero, Animal, CatalogoRaza],
      });
      await dataSource.initialize();
      await insertarTenants(dataSource, { tenantA, tenantB });
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        // Borrado acotado a los tenants de esta corrida. Si falla, el test debe
        // romper: una limpieza silenciosa deja basura en la base compartida.
        await limpiarTenants(dataSource, [tenantA, tenantB]);
        await dataSource.destroy();
      }
    });

    it('CRITERIO RLS 1: pg_class confirma relrowsecurity = true y relforcerowsecurity = true en potrero', async () => {
      const rows = await dataSource.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity 
      FROM pg_class 
      WHERE relname = 'potrero';
    `);

      expect(rows).toHaveLength(1);
      expect(rows[0].relrowsecurity).toBe(true);
      expect(rows[0].relforcerowsecurity).toBe(true);
    });

    it('CRITERIO RLS 2: pg_policies confirma política EXISTS con aislamiento por tenant_id', async () => {
      const policies = await dataSource.query(`
      SELECT tablename, policyname, qual 
      FROM pg_policies 
      WHERE tablename = 'potrero';
    `);

      expect(policies.length).toBeGreaterThan(0);
      const policy = policies[0];
      expect(policy.policyname).toBe('potrero_isolation_policy');
      expect(policy.qual).toContain('tenant_id');
    });

    it('CRITERIO RLS 3: Aislamiento estricto entre Tenant A y Tenant B en base real', async () => {
      const queryRunnerA = dataSource.createQueryRunner();
      await queryRunnerA.connect();

      try {
        await queryRunnerA.startTransaction();
        const claimsA = JSON.stringify({
          sub: userTenantA,
          tenant_id: tenantA,
          rol: 'propietario',
        });
        await queryRunnerA.query('SET LOCAL ROLE resdigital_app;');
        await queryRunnerA.query(
          `SELECT set_config('request.jwt.claims', $1, true);`,
          [claimsA],
        );
        await queryRunnerA.query(
          `SELECT set_config('app.current_tenant_id', $1, true);`,
          [tenantA],
        );

        const insertPotrero = await queryRunnerA.query(
          `
        INSERT INTO potrero (tenant_id, nombre, area_ha, capacidad_recomendada_ua_ha, dias_descanso_recomendados)
        VALUES ($1, 'Potrero A Test RLS', 10.5, 2.0, 30)
        RETURNING id;
      `,
          [tenantA],
        );
        potreroAId = insertPotrero[0].id;

        const lecturaTenantA = await queryRunnerA.query(
          `
        SELECT * FROM potrero WHERE id = $1;
      `,
          [potreroAId],
        );
        expect(lecturaTenantA).toHaveLength(1);
        expect(lecturaTenantA[0].nombre).toBe('Potrero A Test RLS');

        await queryRunnerA.commitTransaction();
      } finally {
        await queryRunnerA.release();
      }

      const queryRunnerB = dataSource.createQueryRunner();
      await queryRunnerB.connect();

      try {
        await queryRunnerB.startTransaction();
        const claimsB = JSON.stringify({
          sub: userTenantB,
          tenant_id: tenantB,
          rol: 'propietario',
        });
        await queryRunnerB.query('SET LOCAL ROLE resdigital_app;');
        await queryRunnerB.query(
          `SELECT set_config('request.jwt.claims', $1, true);`,
          [claimsB],
        );
        await queryRunnerB.query(
          `SELECT set_config('app.current_tenant_id', $1, true);`,
          [tenantB],
        );

        // Intento de LECTURA: Tenant B intenta leer potrero de Tenant A sin WHERE
        const lecturaTodosTenantB = await queryRunnerB.query(
          `
        SELECT * FROM potrero WHERE id = $1;
      `,
          [potreroAId],
        );
        expect(lecturaTodosTenantB).toHaveLength(0); // Bloqueado por RLS

        // Intento de MODIFICACIÓN
        const updateTenantB = await queryRunnerB.query(
          `
        UPDATE potrero 
        SET nombre = 'Hackeado por B' 
        WHERE id = $1;
      `,
          [potreroAId],
        );
        expect(updateTenantB[1] ?? 0).toBe(0);

        // Intento de ELIMINACIÓN
        const deleteTenantB = await queryRunnerB.query(
          `
        DELETE FROM potrero WHERE id = $1;
      `,
          [potreroAId],
        );
        expect(deleteTenantB[1] ?? 0).toBe(0);

        await queryRunnerB.rollbackTransaction();
      } finally {
        await queryRunnerB.release();
      }
    });
  },
);
