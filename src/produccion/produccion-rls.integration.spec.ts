import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import { dataSourceOptions } from '../database/data-source.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { CatalogoRaza } from '../catalogos/entities/catalogo-raza.entity.js';
import { Evento } from '../eventos/entities/evento.entity.js';
import { Potrero } from '../potreros/entities/potrero.entity.js';
import { EventoServicio } from '../reproductivo/entities/evento-servicio.entity.js';
import { EventoDiagnostico } from '../reproductivo/entities/evento-diagnostico.entity.js';
import { EventoParto } from '../reproductivo/entities/evento-parto.entity.js';
import { EventoSecado } from '../reproductivo/entities/evento-secado.entity.js';
import { ReproductiveCalculationService } from '../reproductivo/services/reproductive-calculation.service.js';
import { ReproductiveStateService } from '../reproductivo/services/reproductive-state.service.js';
import { Medicamento } from '../sanitary/entities/medicamento.entity.js';
import { Padecimiento } from '../sanitary/entities/padecimiento.entity.js';
import { EventoTratamiento } from '../tratamientos/entities/evento-tratamiento.entity.js';
import { addCalendarDays, todayIsoDate } from '../tratamientos/retiro-calc.js';
import { TratamientosService } from '../tratamientos/tratamientos.service.js';
import { EventoProduccionLeche } from './entities/evento-produccion-leche.entity.js';
import { LactanciaService } from './lactancia.service.js';
import { ProduccionLecheService } from './produccion-leche.service.js';

describe('Integración RLS — MOD-06 Producción de leche (base real)', () => {
  let dataSource: DataSource;
  const lactancia = new LactanciaService(
    new ReproductiveStateService(new ReproductiveCalculationService()),
  );
  const produccion = new ProduccionLecheService(lactancia);
  const tratamientos = new TratamientosService();

  const tenantA = 'aaaaaaaa-aaaa-4aaa-aaaa-0000000000a6';
  const tenantB = 'bbbbbbbb-bbbb-4bbb-bbbb-0000000000b6';
  const userTenantA = 'c2ddf521-f85a-4752-a9cd-803e4354cac8';
  const userTenantB = '66be99b7-1f4e-4f84-97b6-61558e4cb345';
  const ARETE_A = 'TEST-RLS-LECHE-A';
  const ARETE_B = 'TEST-RLS-LECHE-B';

  const hoy = todayIsoDate();
  const hace = (dias: number) => addCalendarDays(hoy, -dias);

  let animalAId: string;
  let tratamientoAId: string;

  async function comoTenant(tenantId: string, userId: string): Promise<QueryRunner> {
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
        EventoServicio,
        EventoDiagnostico,
        EventoParto,
        EventoSecado,
        EventoTratamiento,
        EventoProduccionLeche,
        Medicamento,
        Padecimiento,
      ],
    });
    await dataSource.initialize();

    await dataSource.query(`
      INSERT INTO tenant (id, nombre_finca, created_at)
      VALUES ('${tenantA}', 'TEST RLS LECHE A', NOW()), ('${tenantB}', 'TEST RLS LECHE B', NOW())
      ON CONFLICT (id) DO NOTHING;
    `);

    const raza = await dataSource.getRepository(CatalogoRaza).findOne({ where: {} });
    if (!raza) throw new Error('Se requiere al menos una raza en catalogo_raza.');

    const animalRepo = dataSource.getRepository(Animal);
    const animalA = await animalRepo.save({
      tenantId: tenantA,
      areteInterno: ARETE_A,
      nombre: 'Vaca Leche A',
      sexo: 'Hembra',
      razaId: raza.id,
      categoria: 'Vaca',
      activo: true,
    });
    animalAId = animalA.id;
    await animalRepo.save({
      tenantId: tenantB,
      areteInterno: ARETE_B,
      nombre: 'Vaca Leche B',
      sexo: 'Hembra',
      razaId: raza.id,
      categoria: 'Vaca',
      activo: true,
    });

    const qr = await comoTenant(tenantA, userTenantA);
    await lactancia.registrarInicio(tenantA, userTenantA, animalAId, { fecha: hace(20) }, qr.manager);
    const tratamiento = await tratamientos.create(
      tenantA,
      userTenantA,
      {
        animalId: animalAId,
        farmaco: 'Oxitetraciclina RLS',
        dosis: '20 ml',
        fecha: hace(5),
        diagnostico: 'Mastitis',
        diasRetiroLeche: 30,
        diasRetiroCarne: 28,
      },
      qr.manager,
    );
    tratamientoAId = tratamiento.id;
    await cerrar(qr, true);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const animales = `SELECT id FROM animal WHERE arete_interno IN ('${ARETE_A}', '${ARETE_B}')`;
    await dataSource.query(`
      DELETE FROM evento_produccion_leche WHERE evento_id IN (SELECT id FROM evento WHERE animal_id IN (${animales}));
      DELETE FROM evento_tratamiento WHERE evento_id IN (SELECT id FROM evento WHERE animal_id IN (${animales}));
      UPDATE evento SET evento_corrige_id = NULL WHERE animal_id IN (${animales});
      DELETE FROM evento WHERE animal_id IN (${animales});
      DELETE FROM animal WHERE arete_interno IN ('${ARETE_A}', '${ARETE_B}');
      DELETE FROM tenant WHERE id IN ('${tenantA}', '${tenantB}');
    `);
    await dataSource.destroy();
  });

  it('evento_produccion_leche tiene RLS forzado y política EXISTS heredada de evento', async () => {
    const [flags] = await dataSource.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'evento_produccion_leche'`,
    );
    expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const policies = await dataSource.query(
      `SELECT qual FROM pg_policies WHERE tablename = 'evento_produccion_leche'`,
    );
    expect(policies).toHaveLength(1);
    expect(policies[0].qual).toContain('tenant_id');
  });

  it('bajo retiro guarda descarte con el tratamiento y antes del retiro comercializable', async () => {
    const qr = await comoTenant(tenantA, userTenantA);
    try {
      const antes = await produccion.create(
        tenantA,
        userTenantA,
        { animalId: animalAId, fecha: hace(10), turno: 'MANANA', litros: 12.5 },
        qr.manager,
      );
      const bajoRetiro = await produccion.create(
        tenantA,
        userTenantA,
        { animalId: animalAId, fecha: hace(1), turno: 'TARDE', litros: 8 },
        qr.manager,
      );
      expect(antes).toMatchObject({ disposicion: 'COMERCIALIZABLE', tratamientoEventoId: null });
      expect(bajoRetiro).toMatchObject({ disposicion: 'DESCARTE', tratamientoEventoId: tratamientoAId });

      const filas = await qr.query(
        `SELECT turno, litros::float AS litros, disposicion FROM evento_produccion_leche
         WHERE evento_id = ANY($1) ORDER BY turno`,
        [[antes.id, bajoRetiro.id]],
      );
      expect(filas).toEqual([
        { turno: 'MANANA', litros: 12.5, disposicion: 'COMERCIALIZABLE' },
        { turno: 'TARDE', litros: 8, disposicion: 'DESCARTE' },
      ]);

      const resumen = await produccion.resumen(tenantA, qr.manager, hace(10), hoy);
      expect(resumen).toMatchObject({
        litrosProducidos: 20.5,
        litrosComercializables: 12.5,
        litrosDescarte: 8,
      });
    } finally {
      await cerrar(qr, false);
    }
  });

  it('la base rechaza un descarte sin tratamiento de origen', async () => {
    const qr = await comoTenant(tenantA, userTenantA);
    try {
      const [evento] = await qr.query(
        `INSERT INTO evento (tenant_id, animal_id, tipo, fecha_evento, usuario_id)
         VALUES ($1, $2, 'PRODUCCION_LECHE', $3, $4) RETURNING id`,
        [tenantA, animalAId, hace(2), userTenantA],
      );
      await expect(
        qr.query(
          `INSERT INTO evento_produccion_leche (evento_id, turno, litros, disposicion)
           VALUES ($1, 'MANANA', 10, 'DESCARTE')`,
          [evento.id],
        ),
      ).rejects.toThrow();
    } finally {
      await cerrar(qr, false);
    }
  });

  it('un turno repetido responde 409 y anular conserva el original', async () => {
    const qr = await comoTenant(tenantA, userTenantA);
    try {
      const dto = { animalId: animalAId, fecha: hace(3), turno: 'MANANA' as const, litros: 10 };
      const original = await produccion.create(tenantA, userTenantA, dto, qr.manager);
      await expect(
        produccion.create(tenantA, userTenantA, dto, qr.manager),
      ).rejects.toBeInstanceOf(ConflictException);

      const anulacion = await produccion.anular(
        tenantA,
        userTenantA,
        original.id,
        { motivo: 'litros mal digitados' },
        qr.manager,
      );
      const [fila] = await qr.query(
        `SELECT e.revertido, d.litros::float AS litros FROM evento e
         JOIN evento_produccion_leche d ON d.evento_id = e.id WHERE e.id = $1`,
        [original.id],
      );
      expect(fila).toEqual({ revertido: true, litros: 10 });
      const [marcador] = await qr.query(
        'SELECT notas, evento_corrige_id FROM evento WHERE id = $1',
        [anulacion.eventoAnulacionId],
      );
      expect(marcador).toEqual({ notas: 'litros mal digitados', evento_corrige_id: original.id });

      const repetido = await produccion.create(tenantA, userTenantA, dto, qr.manager);
      expect(repetido.id).not.toBe(original.id);
    } finally {
      await cerrar(qr, false);
    }
  });

  it('tenant B no puede leer, modificar ni anular la producción de A', async () => {
    const qrA = await comoTenant(tenantA, userTenantA);
    const creada = await produccion.create(
      tenantA,
      userTenantA,
      { animalId: animalAId, fecha: hace(4), turno: 'TARDE', litros: 9 },
      qrA.manager,
    );
    await cerrar(qrA, true);

    const qr = await comoTenant(tenantB, userTenantB);
    try {
      const detalle = await qr.query(
        'SELECT * FROM evento_produccion_leche WHERE evento_id = $1',
        [creada.id],
      );
      expect(detalle).toHaveLength(0);

      const update = await qr.query(
        `UPDATE evento_produccion_leche SET disposicion = 'COMERCIALIZABLE', tratamiento_evento_id = NULL WHERE evento_id = $1`,
        [creada.id],
      );
      expect(update[1] ?? 0).toBe(0);

      await expect(
        produccion.findAllByAnimal(tenantB, animalAId, qr.manager),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        produccion.anular(tenantB, userTenantB, creada.id, { motivo: 'ataque' }, qr.manager),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        lactancia.getEstado(tenantB, animalAId, qr.manager),
      ).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      await cerrar(qr, false);
    }
  });
});
