import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../database/data-source.js';
import { Animal } from '../../animales/entities/animal.entity.js';
import { CatalogoRaza } from '../../catalogos/entities/catalogo-raza.entity.js';
import { Evento } from '../../eventos/entities/evento.entity.js';
import { EventoServicio } from '../entities/evento-servicio.entity.js';
import { EventoDiagnostico } from '../entities/evento-diagnostico.entity.js';
import { EventoParto } from '../entities/evento-parto.entity.js';
import { EventoSecado } from '../entities/evento-secado.entity.js';
import { Potrero } from '../../potreros/entities/potrero.entity.js';
import {
  crearTenantsDePrueba,
  insertarTenants,
  limpiarTenants,
  obtenerUsuariosDePrueba,
  crearAdminDataSource,
  insertarUsuario,
} from '../../test-utils/integration-tenant.js';

describe('Test de Integración Real RLS — MOD-03 Reproductivo (PostgreSQL local descartable)', () => {
  let dataSource: DataSource;
  let adminSource: DataSource;

  const { tenantA, tenantB } = crearTenantsDePrueba();
  const { usuarioA: userTenantA, usuarioB: userTenantB } =
    obtenerUsuariosDePrueba();

  let animalAId: string;
  let animalBId: string;
  let eventoAId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      ...dataSourceOptions,
      migrations: [],
      entities: [
        CatalogoRaza,
        Animal,
        Evento,
        EventoServicio,
        EventoDiagnostico,
        EventoParto,
        EventoSecado,
        Potrero,
      ],
    });
    await dataSource.initialize();
    adminSource = crearAdminDataSource(dataSource.options.entities);
    await adminSource.initialize();

    await insertarTenants(adminSource, { tenantA, tenantB });
    await insertarUsuario(adminSource, tenantA, userTenantA);
    await insertarUsuario(adminSource, tenantB, userTenantB);

    // 2. Obtener una raza válida
    const raza = await dataSource
      .getRepository(CatalogoRaza)
      .findOne({ where: {} });
    if (!raza) {
      throw new Error(
        'Se requiere al menos una raza en catalogo_raza para el test.',
      );
    }

    // 3. Crear animales identificables para cada tenant
    const animalRepo = adminSource.getRepository(Animal);
    const animalA = await animalRepo.save({
      tenantId: tenantA,
      areteInterno: 'TEST-RLS-VACA-A',
      nombre: 'Vaca Test Tenant A',
      sexo: 'Hembra',
      razaId: raza.id,
      categoria: 'Vaca',
      activo: true,
    });
    animalAId = animalA.id;

    const animalB = await animalRepo.save({
      tenantId: tenantB,
      areteInterno: 'TEST-RLS-VACA-B',
      nombre: 'Vaca Test Tenant B',
      sexo: 'Hembra',
      razaId: raza.id,
      categoria: 'Vaca',
      activo: true,
    });
    animalBId = animalB.id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await limpiarTenants(adminSource, [tenantA, tenantB]);
      await adminSource.destroy();
      await dataSource.destroy();
    }
  });

  it('CRITERIO RLS 1: pg_class confirma relrowsecurity = true y relforcerowsecurity = true en las 4 tablas de detalle y evento', async () => {
    const rows = await dataSource.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity 
      FROM pg_class 
      WHERE relname IN ('evento', 'evento_servicio', 'evento_diagnostico', 'evento_parto', 'evento_secado')
      ORDER BY relname ASC;
    `);

    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('CRITERIO RLS 2: pg_policies confirma política EXISTS con aislamiento por tenant_id heredado de evento', async () => {
    const policies = await dataSource.query(`
      SELECT tablename, policyname, qual 
      FROM pg_policies 
      WHERE tablename = 'evento_servicio';
    `);

    expect(policies.length).toBeGreaterThan(0);
    const policy = policies[0];
    expect(policy.policyname).toBe('evento_servicio_isolation_policy');
    expect(policy.qual).toContain('auth.jwt()');
    expect(policy.qual).toContain('tenant_id');
  });

  it('CRITERIO RLS 3: Aislamiento estricto entre Tenant A y Tenant B en base real', async () => {
    const queryRunnerA = dataSource.createQueryRunner();
    await queryRunnerA.connect();

    try {
      // 1. Iniciar sesión transaccional como Tenant A
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

      // Insertar evento en Tenant A
      const insertEvento = await queryRunnerA.query(
        `
        INSERT INTO evento (tenant_id, animal_id, tipo, fecha_evento, usuario_id)
        VALUES ($1, $2, 'SERVICIO', '2026-03-01', $3)
        RETURNING id;
      `,
        [tenantA, animalAId, userTenantA],
      );
      eventoAId = insertEvento[0].id;

      // Insertar evento_servicio en Tenant A
      await queryRunnerA.query(
        `
        INSERT INTO evento_servicio (evento_id, tipo_servicio, toro_o_pajilla, fpp, palpacion_fecha, secado_fecha, aviso_parto_fecha, aviso_parto_urgente_fecha)
        VALUES ($1, 'Inseminación Artificial', 'Titan-RLS-01', '2026-12-07', '2026-04-10', '2026-10-08', '2026-11-22', '2026-12-04');
      `,
        [eventoAId],
      );

      // Tenant A puede leer su propia fila
      const lecturaTenantA = await queryRunnerA.query(
        `
        SELECT * FROM evento_servicio WHERE evento_id = $1;
      `,
        [eventoAId],
      );
      expect(lecturaTenantA).toHaveLength(1);
      expect(lecturaTenantA[0].toro_o_pajilla).toBe('Titan-RLS-01');

      await queryRunnerA.commitTransaction();
    } finally {
      await queryRunnerA.release();
    }

    // 2. Iniciar sesión transaccional separada como Tenant B
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

      const lecturaAnimalB = await queryRunnerB.query(
        'SELECT id FROM animal WHERE id = $1;',
        [animalBId],
      );
      expect(lecturaAnimalB).toHaveLength(1);
      const lecturaAnimalA = await queryRunnerB.query(
        'SELECT id FROM animal WHERE id = $1;',
        [animalAId],
      );
      expect(lecturaAnimalA).toHaveLength(0);

      // 2.1 Intento de LECTURA: Tenant B intenta leer evento_servicio de Tenant A
      const lecturaTenantB = await queryRunnerB.query(
        `
        SELECT * FROM evento_servicio WHERE evento_id = $1;
      `,
        [eventoAId],
      );
      expect(lecturaTenantB).toHaveLength(0); // RLS bloquea la fila por completo

      // 2.2 Intento de MODIFICACIÓN: Tenant B intenta actualizar toro_o_pajilla de Tenant A
      const updateTenantB = await queryRunnerB.query(
        `
        UPDATE evento_servicio 
        SET toro_o_pajilla = 'Ataque-Hacked' 
        WHERE evento_id = $1;
      `,
        [eventoAId],
      );
      // En pg driver, rowCount es devuelto en el resultado de UPDATE
      expect(updateTenantB[1] ?? 0).toBe(0); // Cero filas modificadas

      // 2.3 Intento de ELIMINACIÓN: Tenant B intenta borrar evento_servicio de Tenant A
      const deleteTenantB = await queryRunnerB.query(
        `
        DELETE FROM evento_servicio WHERE evento_id = $1;
      `,
        [eventoAId],
      );
      expect(deleteTenantB[1] ?? 0).toBe(0); // Cero filas eliminadas

      await queryRunnerB.rollbackTransaction();
    } finally {
      await queryRunnerB.release();
    }
  });
});
