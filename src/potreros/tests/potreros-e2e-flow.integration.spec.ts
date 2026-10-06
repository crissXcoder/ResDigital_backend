import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
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

describe('Test de Integración E2E — MOD-05 Potreros', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const { tenantA, tenantB } = crearTenantsDePrueba();
  const { usuarioA: userTenantA, usuarioB: userTenantB } =
    obtenerUsuariosDePrueba();
  const userPeonTenantA = crypto.randomUUID();

  let tokenOwnerA: string;
  let tokenPeonA: string;
  let potreroAId: string;
  let animalAId: string;

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
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    dataSource = crearAdminDataSource();
    await dataSource.initialize();

    await insertarTenants(dataSource, { tenantA, tenantB });
    await insertarUsuario(dataSource, tenantA, userTenantA);
    await insertarUsuario(dataSource, tenantB, userTenantB);
    await insertarUsuario(dataSource, tenantA, userPeonTenantA, 'peon');

    // Obtener raza para animal
    const raza = await dataSource.query(
      `SELECT id FROM catalogo_raza LIMIT 1;`,
    );
    let razaId = raza[0]?.id;
    if (!razaId) {
      throw new Error(
        'Se requiere al menos una raza en catalogo_raza para el test.',
      );
    }

    // Insert animal
    const uniqueArete = `VACA-POTRERO-${Date.now()}`;
    const animal = await dataSource.query(`
      INSERT INTO animal (tenant_id, arete_interno, nombre, sexo, raza_id, categoria, activo)
      VALUES ('${tenantA}', '${uniqueArete}', 'Vaca Potrero Test', 'Hembra', '${razaId}', 'Vaca', true)
      RETURNING id;
    `);
    animalAId = animal[0].id;

    // Tokens
    const jwtOwnerA = {
      sub: userTenantA,
      tenant_id: tenantA,
      rol: 'propietario',
    };
    tokenOwnerA = Buffer.from(JSON.stringify(jwtOwnerA)).toString('base64');

    const jwtPeonA = {
      sub: userPeonTenantA,
      tenant_id: tenantA,
      rol: 'peon', // Rol que NO tiene acceso a mutaciones
    };
    tokenPeonA = Buffer.from(JSON.stringify(jwtPeonA)).toString('base64');
  });

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized)
        await limpiarTenants(dataSource, [tenantA, tenantB]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
      if (app) await app.close();
    }
  });

  describe('CRUD de Potreros con Roles y Validación DTO', () => {
    it('1. POST /potreros sin auth devuelve 401', async () => {
      await request
        .default(app.getHttpServer())
        .post('/potreros')
        .send({ nombre: 'Potrero 1', areaHa: 10, capacidadRecomendadaUgm: 5 })
        .expect(401);
    });

    it('2. POST /potreros con rol "peon" devuelve 403 (No permitido)', async () => {
      await request
        .default(app.getHttpServer())
        .post('/potreros')
        .set('Authorization', `Bearer test.${tokenPeonA}.test`)
        .send({ nombre: 'Potrero 1', areaHa: 10, capacidadRecomendadaUgm: 5 })
        .expect(403);
    });

    it('3. POST /potreros falla con 400 por payload inválido (Validación DTO mass-assignment)', async () => {
      const resp = await request
        .default(app.getHttpServer())
        .post('/potreros')
        .set('Authorization', `Bearer test.${tokenOwnerA}.test`)
        .send({
          areaHa: -5, // Invalido: menor a 0
          tenantId: 'hacker-tenant', // NO PERMITIDO: mass-assignment
        })
        .expect(400);

      expect(resp.body.message).toEqual(
        expect.arrayContaining([
          'areaHa must not be less than 0',
          'property tenantId should not exist',
        ]),
      );
    });

    it('4. POST /potreros con rol "propietario" crea el potrero (201)', async () => {
      const resp = await request
        .default(app.getHttpServer())
        .post('/potreros')
        .set('Authorization', `Bearer test.${tokenOwnerA}.test`)
        .send({
          nombre: 'Potrero A',
          areaHa: 15.5,
          capacidadRecomendadaUaHa: 2.5,
          diasDescansoRecomendados: 25,
          estadoManual: 'EN MANTENIMIENTO',
        })
        .expect(201);

      potreroAId = resp.body.id;
      expect(potreroAId).toBeDefined();
      expect(resp.body.nombre).toBe('Potrero A');
      expect(resp.body.estadoManual).toBe('EN MANTENIMIENTO');
    });

    it('5. GET /potreros devuelve la lista de potreros para el tenant (Operador tiene acceso a lectura)', async () => {
      const resp = await request
        .default(app.getHttpServer())
        .get('/potreros')
        .set('Authorization', `Bearer test.${tokenPeonA}.test`)
        .expect(200);

      expect(Array.isArray(resp.body)).toBe(true);
      expect(resp.body.length).toBeGreaterThanOrEqual(1);
      expect(resp.body[0].nombre).toBe('Potrero A');
    });

    it('Tenant B no puede consultar ni modificar el potrero de A', async () => {
      const tokenB = Buffer.from(
        JSON.stringify({
          sub: userTenantB,
          tenant_id: tenantB,
          rol: 'propietario',
        }),
      ).toString('base64');
      await request
        .default(app.getHttpServer())
        .get('/potreros/' + potreroAId)
        .set('Authorization', 'Bearer ' + tokenB)
        .expect(404);
      await request
        .default(app.getHttpServer())
        .patch('/potreros/' + potreroAId)
        .set('Authorization', 'Bearer ' + tokenB)
        .send({ nombre: 'Ataque' })
        .expect(404);
      const [row] = await dataSource.query(
        'SELECT nombre FROM potrero WHERE id = $1',
        [potreroAId],
      );
      expect(row.nombre).toBe('Potrero A');
    });

    it('6. PATCH /potreros/:id con rol "operador" devuelve 403', async () => {
      await request
        .default(app.getHttpServer())
        .patch(`/potreros/${potreroAId}`)
        .set('Authorization', `Bearer test.${tokenPeonA}.test`)
        .send({ nombre: 'Nombre nuevo' })
        .expect(403);
    });

    it('7. PATCH /potreros/:id actualiza exitosamente', async () => {
      const resp = await request
        .default(app.getHttpServer())
        .patch(`/potreros/${potreroAId}`)
        .set('Authorization', `Bearer test.${tokenOwnerA}.test`)
        .send({ nombre: 'Potrero A Modificado', estadoManual: null })
        .expect(200);

      expect(resp.body.nombre).toBe('Potrero A Modificado');
      // No debe existir estado manual ya que se le envió null
    });
  });

  describe('Asignación de Animales y Efecto Colateral', () => {
    it('8. POST /potreros/:id/asignar falla con payload inválido (Validación)', async () => {
      const resp = await request
        .default(app.getHttpServer())
        .post(`/potreros/${potreroAId}/asignar`)
        .set('Authorization', `Bearer test.${tokenOwnerA}.test`)
        .send({ animalIds: 'no-es-array' })
        .expect(400);

      expect(resp.body.message).toEqual(
        expect.arrayContaining([
          'animalIds must be an array',
          'each value in animalIds must be a UUID',
        ]),
      );
    });

    it('9. POST /potreros/:id/asignar asigna exitosamente animales (Impacto en tabla animal)', async () => {
      await request
        .default(app.getHttpServer())
        .post(`/potreros/${potreroAId}/asignar`)
        .set('Authorization', `Bearer test.${tokenOwnerA}.test`)
        .send({ animalIds: [animalAId] })
        .expect(201); // El decorador Post por defecto es 201

      // Verificar que el animal ahora tiene el potreroAId en la BD
      const animalUpdated = await dataSource.query(
        'SELECT potrero_id FROM animal WHERE id = $1',
        [animalAId],
      );
      expect(animalUpdated[0].potrero_id).toBe(potreroAId);
    });
  });
});
