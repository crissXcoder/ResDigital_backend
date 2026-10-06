import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, IsNull } from 'typeorm';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app.module.js';
import { SupabaseJwtService } from '../../auth/services/supabase-jwt.service.js';
import { RlsTransactionInterceptor } from '../../auth/interceptors/rls-transaction.interceptor.js';
import { dataSourceOptions } from '../../database/data-source.js';
import { ReproductiveService } from '../services/reproductive.service.js';
import { ReproductiveCalculationService } from '../services/reproductive-calculation.service.js';
import { ReproductiveStateService } from '../services/reproductive-state.service.js';
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

const usuarios = obtenerUsuariosDePrueba();

describe('Test End-to-End Flujo Reproductivo Completo (PostgreSQL local descartable)', () => {
  let dataSource: DataSource;
  let adminSource: DataSource;
  let reproService: ReproductiveService;
  let app: INestApplication;

  // UUID aleatorio por corrida: antes era un literal fijo que colisionaba con
  // el de los otros specs de integración.
  const { tenantA: tenantId, tenantB } = crearTenantsDePrueba();
  // El setup admin crea ambas FK (auth.users y usuario) en la BD descartable.
  const userId = usuarios.usuarioA;

  let animalId: string;

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

    const calcService = new ReproductiveCalculationService();
    const stateService = new ReproductiveStateService(calcService);
    reproService = new ReproductiveService(calcService, stateService);

    // 1. Crear tenant de prueba (parametrizado, sin interpolar en el SQL)
    await insertarTenants(adminSource, { tenantA: tenantId, tenantB });
    await insertarUsuario(adminSource, tenantId, userId);
    await insertarUsuario(adminSource, tenantB, usuarios.usuarioB);

    // 2. Obtener una raza GLOBAL (tenant_id IS NULL) con días de gestación.
    // No usar una raza propia de otra finca: desde la migración
    // SecureCatalogoRazaAndMigrations, catalogo_raza tiene RLS híbrido
    // (global + por tenant) y una raza tenant-scoped de otra finca no sería
    // visible bajo la sesión RLS de este tenant de prueba.
    const raza = await dataSource
      .getRepository(CatalogoRaza)
      .findOne({ where: { tenantId: IsNull() } });
    if (!raza || !raza.diasGestacion) {
      throw new Error(
        'Se requiere una raza con diasGestacion para el test E2E.',
      );
    }

    // 3. Crear animal hembra de prueba
    const animalRepo = adminSource.getRepository(Animal);
    const animal = await animalRepo.save({
      tenantId,
      areteInterno: 'TEST-E2E-VACA-01',
      nombre: 'Vaca Flujo E2E',
      sexo: 'Hembra',
      razaId: raza.id,
      categoria: 'Vaca',
      activo: true,
    });
    animalId = animal.id;
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseJwtService)
      .useValue({
        verifyToken: async (token: string) =>
          JSON.parse(Buffer.from(token, 'base64').toString('utf8')),
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
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Borrado acotado al tenant de esta corrida, en orden de FK.
      // El DELETE de animal ya no filtra por arete_interno global: borraba la
      // fila de cualquier finca que tuviera ese mismo arete de prueba.
      await limpiarTenants(adminSource, [tenantId, tenantB]);
      await adminSource.destroy();
      await dataSource.destroy();
      if (app) await app.close();
    }
  });

  it('Rechaza el arranque con sesión admin elevada', async () => {
    await expect(
      new RlsTransactionInterceptor(adminSource).onModuleInit(),
    ).rejects.toThrow(
      'DATABASE_URL debe autenticar directamente como resdigital_app',
    );
  });

  it('API reproductiva deniega tenant ajeno y diagnóstico de peón', async () => {
    const token = (tenant: string, rol: string, sub = userId) =>
      Buffer.from(JSON.stringify({ sub, tenant_id: tenant, rol })).toString(
        'base64',
      );
    await request(app.getHttpServer())
      .get('/animales/' + animalId + '/estado-reproductivo')
      .set(
        'Authorization',
        'Bearer ' + token(tenantB, 'propietario', usuarios.usuarioB),
      )
      .expect(404);
    await request(app.getHttpServer())
      .post('/animales/' + animalId + '/diagnosticos')
      .set('Authorization', 'Bearer ' + token(tenantId, 'peon'))
      .send({})
      .expect(403);
    const [{ count }] = await adminSource.query(
      'SELECT count(*)::int AS count FROM evento WHERE animal_id = $1',
      [animalId],
    );
    expect(count).toBe(0);
  });

  it('Flujo E2E Completo: Vacía -> Servicio (Servida) -> Diagnóstico (Preñada) -> Secado (En Secado) -> Parto (Vacía)', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // Configurar sesión RLS
      await queryRunner.startTransaction();
      const claims = JSON.stringify({
        sub: userId,
        tenant_id: tenantId,
        rol: 'propietario',
      });
      await queryRunner.query('SET LOCAL ROLE resdigital_app;');
      await queryRunner.query(
        `SELECT set_config('request.jwt.claims', $1, true);`,
        [claims],
      );
      await queryRunner.query(
        `SELECT set_config('app.current_tenant_id', $1, true);`,
        [tenantId],
      );

      // -------------------------------------------------------------
      // PASO 0: Estado inicial antes de cualquier evento
      // -------------------------------------------------------------
      const estadoInicial = await reproService.obtenerEstadoReproductivo(
        animalId,
        tenantId,
        queryRunner.manager,
      );
      expect(estadoInicial.estadoActual).toBe('Vacía');
      expect(estadoInicial.servicioActivo).toBeUndefined();

      // -------------------------------------------------------------
      // PASO 1: Registrar Servicio Reproductivo
      // -------------------------------------------------------------
      const fechaServicio = '2026-03-01';
      const servicioRes = await reproService.registrarServicio(
        animalId,
        tenantId,
        userId,
        {
          fechaEvento: fechaServicio,
          tipoServicio: 'Inseminación Artificial',
          toroOPajilla: 'Titan-Pajilla-E2E',
          responsable: 'Dr. Roberto',
        },
        queryRunner.manager,
      );

      // Confirmar estado "Servida"
      const estadoServida = await reproService.obtenerEstadoReproductivo(
        animalId,
        tenantId,
        queryRunner.manager,
      );
      expect(estadoServida.estadoActual).toBe('Servida');
      expect(estadoServida.servicioActivo).toBeDefined();
      expect(estadoServida.servicioActivo?.toroOPajilla).toBe(
        'Titan-Pajilla-E2E',
      );
      expect(estadoServida.servicioActivo?.fpp).toBe(servicioRes.hitos.fpp);

      // -------------------------------------------------------------
      // PASO 2: Registrar Diagnóstico Positivo (Preñada)
      // -------------------------------------------------------------
      const fechaDiagnostico = servicioRes.hitos.palpacionFecha;
      const diagRes = await reproService.registrarDiagnostico(
        animalId,
        tenantId,
        userId,
        {
          fechaEvento: fechaDiagnostico,
          eventoServicioId: servicioRes.evento.id,
          metodo: 'Palpación',
          resultado: 'Preñada',
          notas: 'Palpación positiva, preñez confirmada',
        },
        queryRunner.manager,
      );

      // Confirmar estado "Preñada" con la FPP correcta
      const estadoPreñada = await reproService.obtenerEstadoReproductivo(
        animalId,
        tenantId,
        queryRunner.manager,
      );
      expect(estadoPreñada.estadoActual).toBe('Preñada');
      expect(estadoPreñada.servicioActivo?.fpp).toBe(servicioRes.hitos.fpp);
      expect(estadoPreñada.ultimoDiagnostico?.resultado).toBe('Preñada');

      // -------------------------------------------------------------
      // PASO 3: Registrar Secado Real
      // -------------------------------------------------------------
      const fechaSecado = servicioRes.hitos.secadoFecha;
      await reproService.registrarSecado(
        animalId,
        tenantId,
        userId,
        {
          fechaEvento: fechaSecado,
          notas: 'Infusión de secado intramamaria',
        },
        queryRunner.manager,
      );

      // Confirmar estado "En Secado"
      const estadoSecado = await reproService.obtenerEstadoReproductivo(
        animalId,
        tenantId,
        queryRunner.manager,
      );
      expect(estadoSecado.estadoActual).toBe('En Secado');
      expect(estadoSecado.servicioActivo).toBeDefined();

      // -------------------------------------------------------------
      // PASO 4: Registrar Parto
      // -------------------------------------------------------------
      const fechaParto = servicioRes.hitos.fpp;
      await reproService.registrarParto(
        animalId,
        tenantId,
        userId,
        {
          fechaEvento: fechaParto,
          eventoServicioId: servicioRes.evento.id,
          facilidadParto: 'Normal',
          observaciones: 'Parto exitoso a término, cría hembra nacida vigorosa',
        },
        queryRunner.manager,
      );

      // Confirmar que culmina el ciclo y vuelve a "Vacía"
      const estadoFinal = await reproService.obtenerEstadoReproductivo(
        animalId,
        tenantId,
        queryRunner.manager,
      );
      expect(estadoFinal.estadoActual).toBe('Vacía');
      expect(estadoFinal.servicioActivo).toBeUndefined();
      expect(estadoFinal.ultimoParto?.facilidadParto).toBe('Normal');

      await queryRunner.commitTransaction();
    } finally {
      await queryRunner.release();
    }
  });
});
