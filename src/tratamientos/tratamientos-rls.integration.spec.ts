import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import { dataSourceOptions } from '../database/data-source.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { CatalogoRaza } from '../catalogos/entities/catalogo-raza.entity.js';
import { Evento } from '../eventos/entities/evento.entity.js';
import { Potrero } from '../potreros/entities/potrero.entity.js';
import { Medicamento } from '../sanitary/entities/medicamento.entity.js';
import { Padecimiento } from '../sanitary/entities/padecimiento.entity.js';
import { EventoTratamiento } from './entities/evento-tratamiento.entity.js';
import { TratamientosService } from './tratamientos.service.js';

describe('Integración RLS — MOD-02 Tratamientos como evento (base real)', () => {
  let dataSource: DataSource;
  const service = new TratamientosService();

  const tenantA = 'aaaaaaaa-aaaa-4aaa-aaaa-0000000000a2';
  const tenantB = 'bbbbbbbb-bbbb-4bbb-bbbb-0000000000b2';
  const userTenantA = 'c2ddf521-f85a-4752-a9cd-803e4354cac8';
  const userTenantB = '66be99b7-1f4e-4f84-97b6-61558e4cb345';
  const ARETE_A = 'TEST-RLS-SAN-A';
  const ARETE_B = 'TEST-RLS-SAN-B';

  let animalAId: string;
  let tratamientoAId: string;

  const datos = {
    farmaco: 'Cefalexina RLS',
    dosis: '1 jeringa',
    fecha: '2026-09-17',
    diagnostico: 'Mastitis',
    diasRetiroLeche: 5,
    diasRetiroCarne: 4,
  };

  async function comoTenant(
    tenantId: string,
    userId: string,
  ): Promise<QueryRunner> {
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    const claims = JSON.stringify({ sub: userId, tenant_id: tenantId, rol: 'propietario' });
    await qr.query('SET LOCAL ROLE resdigital_app;');
    await qr.query(`SET LOCAL "request.jwt.claims" = '${claims}';`);
    await qr.query(`SELECT set_config('app.current_tenant_id', $1, true);`, [tenantId]);
    return qr;
  }

  async function cerrar(qr: QueryRunner, commit: boolean): Promise<void> {
    try {
      if (commit) await qr.commitTransaction();
      else await qr.rollbackTransaction();
    } finally {
      await qr.release();
    }
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      ...dataSourceOptions,
      migrations: [],
      entities: [
        CatalogoRaza,
        Animal,
        Potrero,
        Evento,
        EventoTratamiento,
        Medicamento,
        Padecimiento,
      ],
    });
    await dataSource.initialize();

    await dataSource.query(`
      INSERT INTO tenant (id, nombre_finca, created_at)
      VALUES ('${tenantA}', 'TEST RLS SAN A', NOW()), ('${tenantB}', 'TEST RLS SAN B', NOW())
      ON CONFLICT (id) DO NOTHING;
    `);

    const raza = await dataSource.getRepository(CatalogoRaza).findOne({ where: {} });
    if (!raza) throw new Error('Se requiere al menos una raza en catalogo_raza.');

    const animalRepo = dataSource.getRepository(Animal);
    const animalA = await animalRepo.save({
      tenantId: tenantA,
      areteInterno: ARETE_A,
      nombre: 'Vaca Sanidad A',
      sexo: 'Hembra',
      razaId: raza.id,
      categoria: 'Vaca',
      activo: true,
    });
    animalAId = animalA.id;
    await animalRepo.save({
      tenantId: tenantB,
      areteInterno: ARETE_B,
      nombre: 'Vaca Sanidad B',
      sexo: 'Hembra',
      razaId: raza.id,
      categoria: 'Vaca',
      activo: true,
    });

    const qr = await comoTenant(tenantA, userTenantA);
    const creado = await service.create(
      tenantA,
      userTenantA,
      { animalId: animalAId, ...datos },
      qr.manager,
    );
    tratamientoAId = creado.id;
    await cerrar(qr, true);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const animales = `SELECT id FROM animal WHERE arete_interno IN ('${ARETE_A}', '${ARETE_B}')`;
    await dataSource.query(`
      DELETE FROM evento_tratamiento WHERE evento_id IN (SELECT id FROM evento WHERE animal_id IN (${animales}));
      UPDATE evento SET evento_corrige_id = NULL WHERE animal_id IN (${animales});
      DELETE FROM evento WHERE animal_id IN (${animales});
      DELETE FROM animal WHERE arete_interno IN ('${ARETE_A}', '${ARETE_B}');
      DELETE FROM tenant WHERE id IN ('${tenantA}', '${tenantB}');
    `);
    await dataSource.destroy();
  });

  it('evento_tratamiento tiene RLS forzado y política EXISTS heredada de evento', async () => {
    const [flags] = await dataSource.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'evento_tratamiento'`,
    );
    expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const policies = await dataSource.query(
      `SELECT policyname, qual FROM pg_policies WHERE tablename = 'evento_tratamiento'`,
    );
    expect(policies).toHaveLength(1);
    expect(policies[0].policyname).toBe('evento_tratamiento_isolation_policy');
    expect(policies[0].qual).toContain('tenant_id');
  });

  it('tenant A lee su tratamiento con usuario registrador', async () => {
    const qr = await comoTenant(tenantA, userTenantA);
    try {
      const lista = await service.findAllByAnimal(tenantA, animalAId, qr.manager);
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({
        id: tratamientoAId,
        usuarioId: userTenantA,
        fechaLiberacionLeche: '2026-09-22',
      });
    } finally {
      await cerrar(qr, false);
    }
  });

  it('tenant B no puede leer, modificar, corregir ni anular el tratamiento de A', async () => {
    const qr = await comoTenant(tenantB, userTenantB);
    try {
      const detalle = await qr.query(
        'SELECT * FROM evento_tratamiento WHERE evento_id = $1',
        [tratamientoAId],
      );
      expect(detalle).toHaveLength(0);

      const update = await qr.query(
        `UPDATE evento_tratamiento SET dias_retiro_leche = 0 WHERE evento_id = $1`,
        [tratamientoAId],
      );
      expect(update[1] ?? 0).toBe(0);

      const revertir = await qr.query(
        `UPDATE evento SET revertido = true WHERE id = $1`,
        [tratamientoAId],
      );
      expect(revertir[1] ?? 0).toBe(0);

      await expect(
        service.findAllByAnimal(tenantB, animalAId, qr.manager),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.corregir(tenantB, userTenantB, tratamientoAId, datos, qr.manager),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.anular(
          tenantB,
          userTenantB,
          tratamientoAId,
          { motivo: 'ataque' },
          qr.manager,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      await cerrar(qr, false);
    }
  });

  it('una corrección que falla no deja el original revertido (rollback real)', async () => {
    const qr = await comoTenant(tenantA, userTenantA);
    try {
      await expect(
        service.corregir(
          tenantA,
          userTenantA,
          tratamientoAId,
          { ...datos, fecha: '2099-01-01' },
          qr.manager,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      const [original] = await qr.query('SELECT revertido FROM evento WHERE id = $1', [
        tratamientoAId,
      ]);
      expect(original.revertido).toBe(false);
    } finally {
      await cerrar(qr, false);
    }
  });

  it('corregir y anular son append-only: el original sigue en la base', async () => {
    const qr = await comoTenant(tenantA, userTenantA);
    try {
      const corregido = await service.corregir(
        tenantA,
        userTenantA,
        tratamientoAId,
        { ...datos, diasRetiroCarne: 28 },
        qr.manager,
      );
      expect(corregido.eventoCorrigeId).toBe(tratamientoAId);

      const vigentes = await service.findAllByAnimal(tenantA, animalAId, qr.manager);
      expect(vigentes.map((t) => t.id)).toEqual([corregido.id]);

      const [original] = await qr.query(
        `SELECT e.revertido, d.dias_retiro_carne FROM evento e
         JOIN evento_tratamiento d ON d.evento_id = e.id WHERE e.id = $1`,
        [tratamientoAId],
      );
      expect(original).toEqual({ revertido: true, dias_retiro_carne: 4 });

      const anulacion = await service.anular(
        tenantA,
        userTenantA,
        corregido.id,
        { motivo: 'prueba de anulación' },
        qr.manager,
      );
      const [evento] = await qr.query(
        'SELECT usuario_id, notas, evento_corrige_id FROM evento WHERE id = $1',
        [anulacion.eventoAnulacionId],
      );
      expect(evento).toEqual({
        usuario_id: userTenantA,
        notas: 'prueba de anulación',
        evento_corrige_id: corregido.id,
      });

      const estado = await service.getEstadoSanitario(
        tenantA,
        animalAId,
        qr.manager,
        '2026-09-18',
      );
      expect(estado.enRetiro).toBe(false);
    } finally {
      await cerrar(qr, false);
    }
  });
});
