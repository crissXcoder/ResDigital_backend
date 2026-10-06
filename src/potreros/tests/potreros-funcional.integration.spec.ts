import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
// ESM con moduleResolution "nodenext": los imports relativos llevan extensión .js.
import { AppModule } from '../../app.module.js';
import { DataSource } from 'typeorm';
import {
  crearTenantsDePrueba,
  crearAdminDataSource,
  insertarTenants,
  insertarUsuario,
  limpiarTenants,
  obtenerUsuariosDePrueba,
} from '../../test-utils/integration-tenant.js';
import { SupabaseJwtService } from '../../auth/services/supabase-jwt.service.js';

describe('Potreros Funcional & Regresión (Integration)', () => {
  let app: INestApplication;
  let adminSource: DataSource;

  const { tenantA, tenantB } = crearTenantsDePrueba();
  const { usuarioA, usuarioB } = obtenerUsuariosDePrueba();

  // Tokens simulados (payloads base64 para el mock)
  const tokenPropietarioA = Buffer.from(
    JSON.stringify({
      sub: usuarioA,
      app_metadata: { tenant_id: tenantA },
      rol: 'propietario',
    }),
  ).toString('base64');

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseJwtService)
      .useValue({
        verifyToken: async (token: string) => {
          const parts = token.split('.');
          const payloadBase64 = parts.length === 3 ? parts[1] : token;
          return JSON.parse(
            Buffer.from(payloadBase64, 'base64').toString('utf8'),
          );
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
    adminSource = crearAdminDataSource();
    await adminSource.initialize();
    await insertarTenants(adminSource, { tenantA, tenantB });
    await insertarUsuario(adminSource, tenantA, usuarioA);
    await insertarUsuario(adminSource, tenantB, usuarioB);
  });

  afterAll(async () => {
    try {
      if (adminSource?.isInitialized)
        await limpiarTenants(adminSource, [tenantA, tenantB]);
    } finally {
      if (adminSource?.isInitialized) await adminSource.destroy();
      if (app) await app.close();
    }
  });

  beforeEach(async () => {
    await adminSource.query('DELETE FROM animal WHERE tenant_id = ANY($1)', [
      [tenantA, tenantB],
    ]);
    await adminSource.query('DELETE FROM potrero WHERE tenant_id = ANY($1)', [
      [tenantA, tenantB],
    ]);
  });

  describe('Flujo de Traslado y Asignación Múltiple', () => {
    it('Debe trasladar animales entre potreros y recalcular carga y estado', async () => {
      // 1. Crear Potreros
      const p1Res = await request(app.getHttpServer())
        .post('/potreros')
        .set('Authorization', `Bearer ${tokenPropietarioA}`)
        .send({
          nombre: 'Potrero 1 (Origen)',
          areaHa: 10,
          capacidadRecomendadaUaHa: 1, // 10 UA total
          diasDescansoRecomendados: 30,
        });
      expect(p1Res.status).toBe(201);
      const p1Id = p1Res.body.id;

      const p2Res = await request(app.getHttpServer())
        .post('/potreros')
        .set('Authorization', `Bearer ${tokenPropietarioA}`)
        .send({
          nombre: 'Potrero 2 (Destino)',
          areaHa: 5,
          capacidadRecomendadaUaHa: 1, // 5 UA total
          diasDescansoRecomendados: 30,
        });
      expect(p2Res.status).toBe(201);
      const p2Id = p2Res.body.id;

      const [{ id: razaId }] = await adminSource.query(
        'SELECT id FROM catalogo_raza WHERE tenant_id IS NULL LIMIT 1',
      );

      // 2. Crear 4 animales directamente en DB para aislar la prueba de DTOs (2 Vacas = 2 UA, 2 Terneros = 1 UA. Total = 3 UA)
      const animals = [];
      for (let i = 0; i < 4; i++) {
        const insertRes = await adminSource.query(
          `INSERT INTO animal (tenant_id, nombre, arete_interno, sexo, categoria, raza_id, potrero_id, fecha_nacimiento)
           VALUES ('${tenantA}', 'Animal ${i}', 'A${i}', '${i < 2 ? 'Hembra' : 'Macho'}', '${i < 2 ? 'Vaca' : 'Ternero'}', '${razaId}', '${p1Id}', '2020-01-01')
           RETURNING id`,
        );
        animals.push(insertRes[0].id);
      }

      // Verificamos estado inicial P1
      const p1Check1 = await request(app.getHttpServer())
        .get(`/potreros/${p1Id}`)
        .set('Authorization', `Bearer ${tokenPropietarioA}`);

      expect(p1Check1.body.cargaActualUaHa).toBeCloseTo(0.3, 1); // 3 UA / 10 Ha
      expect(p1Check1.body.animalesAsignadosCount).toBe(4);
      expect(p1Check1.body.estadoCalculado).toBe('DISPONIBLE'); // 0.3 < 1.0

      // 3. Ejecutar Traslado (P1 -> P2)
      const trasladoRes = await request(app.getHttpServer())
        .post(`/potreros/${p2Id}/asignar`)
        .set('Authorization', `Bearer ${tokenPropietarioA}`)
        .send({ animalIds: animals });

      expect(trasladoRes.status).toBe(201);

      // 4. Comprobar P1 (debe quedar vacío)
      const p1Check2 = await request(app.getHttpServer())
        .get(`/potreros/${p1Id}`)
        .set('Authorization', `Bearer ${tokenPropietarioA}`);
      expect(p1Check2.body.cargaActualUaHa).toBe(0);
      expect(p1Check2.body.animalesAsignadosCount).toBe(0);

      // 5. Comprobar P2 (debe recibir los animales y recalcular)
      const p2Check1 = await request(app.getHttpServer())
        .get(`/potreros/${p2Id}`)
        .set('Authorization', `Bearer ${tokenPropietarioA}`);
      expect(p2Check1.body.cargaActualUaHa).toBeCloseTo(0.6, 1); // 3 UA / 5 Ha
      expect(p2Check1.body.animalesAsignadosCount).toBe(4);
      expect(p2Check1.body.estadoCalculado).toBe('DISPONIBLE'); // 0.6 < 1.0

      // 6. Verificar a nivel de Animal que apuntan al nuevo potrero
      const aCheck = await request(app.getHttpServer())
        .get(`/animales/${animals[0]}`)
        .set('Authorization', `Bearer ${tokenPropietarioA}`);
      expect(aCheck.body.potrero.id).toBe(p2Id);
      expect(aCheck.body.potrero.nombre).toBe('Potrero 2 (Destino)');
    }, 15000);

    it('Debe calcular SOBRECARGADO si la carga supera la capacidad recomendada', async () => {
      // Potrero pequeño de 1 hectárea, capacidad 1 UA/ha
      const p1Res = await request(app.getHttpServer())
        .post('/potreros')
        .set('Authorization', `Bearer ${tokenPropietarioA}`)
        .send({
          nombre: 'Pequeño',
          areaHa: 1,
          capacidadRecomendadaUaHa: 1,
          diasDescansoRecomendados: 30,
        });
      const p1Id = p1Res.body.id;

      const [{ id: razaId }] = await adminSource.query(
        'SELECT id FROM catalogo_raza WHERE tenant_id IS NULL LIMIT 1',
      );

      // Crear 2 Toros = 2 UA directamente en DB
      await adminSource.query(
        `INSERT INTO animal (tenant_id, nombre, arete_interno, sexo, categoria, raza_id, potrero_id, fecha_nacimiento)
         VALUES 
         ('${tenantA}', 'Toro 1', 'T1', 'Macho', 'Toro', '${razaId}', '${p1Id}', '2020-01-01'),
         ('${tenantA}', 'Toro 2', 'T2', 'Macho', 'Toro', '${razaId}', '${p1Id}', '2020-01-01')`,
      );

      const p1Check = await request(app.getHttpServer())
        .get(`/potreros/${p1Id}`)
        .set('Authorization', `Bearer ${tokenPropietarioA}`);

      expect(p1Check.body.cargaActualUaHa).toBe(2); // 2 UA / 1 Ha = 2
      expect(p1Check.body.estadoCalculado).toBe('SOBRECARGADO');
    });
  });

  describe('Seguridad y Casos de Borde', () => {
    it('Debe rechazar la asignación si el potrero no existe (POTRERO INEXISTENTE)', async () => {
      const assignRes = await request(app.getHttpServer())
        .post(`/potreros/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/asignar`)
        .set('Authorization', `Bearer ${tokenPropietarioA}`)
        .send({ animalIds: ['aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'] });

      expect(assignRes.status).toBe(404);
      expect(assignRes.body.message).toContain('Potrero no encontrado');
    });

    it('Debe rechazar la asignación si un animal no pertenece al tenant (CROSS-TENANT)', async () => {
      // Potrero en Tenant A
      const pResA = await request(app.getHttpServer())
        .post('/potreros')
        .set('Authorization', `Bearer ${tokenPropietarioA}`)
        .send({
          nombre: 'Potrero A',
          areaHa: 10,
          capacidadRecomendadaUaHa: 1,
          diasDescansoRecomendados: 30,
        });

      const [{ id: razaId }] = await adminSource.query(
        'SELECT id FROM catalogo_raza WHERE tenant_id IS NULL LIMIT 1',
      );

      // Animal en Tenant B creado directamente
      const insertResB = await adminSource.query(
        `INSERT INTO animal (tenant_id, nombre, arete_interno, sexo, categoria, raza_id, fecha_nacimiento)
         VALUES ('${tenantB}', 'Vaca B', 'B1', 'Hembra', 'Vaca', '${razaId}', '2020-01-01')
         RETURNING id`,
      );
      const animalBId = insertResB[0].id;

      // Tenant A intenta asignar Animal de Tenant B a su potrero
      const assignRes = await request(app.getHttpServer())
        .post(`/potreros/${pResA.body.id}/asignar`)
        .set('Authorization', `Bearer ${tokenPropietarioA}`)
        .send({ animalIds: [animalBId] });

      expect(assignRes.status).toBe(400); // Lanzado por BadRequestException custom
      expect(assignRes.body.message).toContain(
        'Uno o más animales proporcionados no existen',
      );
    });

    it('Debe rechazar la asignación si se envía un ID de animal inexistente', async () => {
      const pRes = await request(app.getHttpServer())
        .post('/potreros')
        .set('Authorization', `Bearer ${tokenPropietarioA}`)
        .send({
          nombre: 'Potrero A',
          areaHa: 10,
          capacidadRecomendadaUaHa: 1,
          diasDescansoRecomendados: 30,
        });

      const fakeAnimalId = 'ffffffff-ffff-4fff-afff-ffffffffffff';
      const assignRes = await request(app.getHttpServer())
        .post(`/potreros/${pRes.body.id}/asignar`)
        .set('Authorization', `Bearer ${tokenPropietarioA}`)
        .send({ animalIds: [fakeAnimalId] });

      expect(assignRes.status).toBe(400);
      expect(assignRes.body.message).toContain(
        'Uno o más animales proporcionados no existen',
      );
    });
  });
});
