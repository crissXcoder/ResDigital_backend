import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { DataSource, IsNull } from 'typeorm';
import { Test } from '@nestjs/testing';
import { BadRequestException, type INestApplication, ValidationPipe } from '@nestjs/common';
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
  let concurrencyAnimalId: string;
  let fechaCierreCiclo: string;

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
    const concurrencyAnimal = await animalRepo.save({
      tenantId,
      areteInterno: 'TEST-E2E-VACA-CONCURRENCY',
      nombre: 'Vaca Concurrencia E2E',
      sexo: 'Hembra',
      razaId: raza.id,
      categoria: 'Vaca',
      activo: true,
    });
    concurrencyAnimalId = concurrencyAnimal.id;
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

  it('serializa dos correcciones concurrentes del mismo evento', async () => {
    const conTransaccionDeTenant = async <T>(
      ejecutar: (manager: DataSource['manager']) => Promise<T>,
    ): Promise<T> => {
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
      try {
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
        const result = await ejecutar(queryRunner.manager);
        await queryRunner.commitTransaction();
        return result;
      } catch (error) {
        if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    };

    const original = await conTransaccionDeTenant((manager) =>
      reproService.registrarServicio(
        concurrencyAnimalId,
        tenantId,
        userId,
        {
          fechaEvento: '2025-01-01',
          tipoServicio: 'Monta Natural',
          toroOPajilla: 'Concurrente original',
        },
        manager,
      ),
    );
    const corregir = (toroOPajilla: string) =>
      conTransaccionDeTenant((manager) =>
        reproService.registrarServicio(
          concurrencyAnimalId,
          tenantId,
          userId,
          {
            fechaEvento: '2025-01-02',
            tipoServicio: 'Monta Natural',
            toroOPajilla,
            eventoCorrigeId: original.evento.id,
          },
          manager,
        ),
      );

    const resultados = await Promise.allSettled([
      corregir('Corrección concurrente A'),
      corregir('Corrección concurrente B'),
    ]);
    expect(resultados.filter((resultado) => resultado.status === 'fulfilled'))
      .toHaveLength(1);
    const rechazado = resultados.find((resultado) => resultado.status === 'rejected');
    expect(rechazado?.status).toBe('rejected');
    if (rechazado?.status === 'rejected') {
      expect(rechazado.reason).toBeInstanceOf(BadRequestException);
    }

    const reemplazos = await adminSource.getRepository(Evento).find({
      where: {
        tenantId,
        animalId: concurrencyAnimalId,
        eventoCorrigeId: original.evento.id,
      },
    });
    expect(reemplazos).toHaveLength(1);
    const originalGuardado = await adminSource.getRepository(Evento).findOne({
      where: { id: original.evento.id, tenantId, animalId: concurrencyAnimalId },
    });
    expect(originalGuardado?.revertido).toBe(true);
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
      const fechaServicio = '2025-03-01';
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

      await expect(
        reproService.registrarServicio(
          animalId,
          tenantId,
          userId,
          {
            fechaEvento: '2025-03-02',
            tipoServicio: 'Monta Natural',
            toroOPajilla: 'No debe registrarse',
          },
          queryRunner.manager,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        reproService.registrarDiagnostico(
          animalId,
          tenantId,
          userId,
          {
            fechaEvento: '2025-04-10',
            eventoServicioId: servicioRes.evento.id,
            eventoCorrigeId: servicioRes.evento.id,
            metodo: 'Palpación',
            resultado: 'Preñada',
          },
          queryRunner.manager,
        ),
      ).rejects.toThrow(BadRequestException);
      const servicioTrasRechazo = await queryRunner.manager.findOne(Evento, {
        where: { id: servicioRes.evento.id, tenantId, animalId },
      });
      expect(servicioTrasRechazo?.revertido).toBe(false);

      await expect(
        reproService.registrarDiagnostico(
          animalId,
          tenantId,
          userId,
          {
            fechaEvento: '2025-02-28',
            eventoServicioId: servicioRes.evento.id,
            metodo: 'Palpación',
            resultado: 'Preñada',
          },
          queryRunner.manager,
        ),
      ).rejects.toThrow(BadRequestException);

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

      await expect(
        reproService.registrarSecado(
          animalId,
          tenantId,
          userId,
          { fechaEvento: '2025-02-28' },
          queryRunner.manager,
        ),
      ).rejects.toThrow(BadRequestException);

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

      await expect(
        reproService.registrarDiagnostico(
          animalId,
          tenantId,
          userId,
          {
            fechaEvento: fechaDiagnostico,
            eventoServicioId: servicioRes.evento.id,
            eventoCorrigeId: diagRes.evento.id,
            metodo: 'Palpación',
            resultado: 'Vacía',
          },
          queryRunner.manager,
        ),
      ).rejects.toThrow(BadRequestException);
      const diagnosticoActivoTrasRechazo = await queryRunner.manager.findOne(
        Evento,
        { where: { id: diagRes.evento.id, animalId, tenantId } },
      );
      expect(diagnosticoActivoTrasRechazo?.revertido).toBe(false);

      // -------------------------------------------------------------
      // PASO 4: Registrar Parto
      // -------------------------------------------------------------
      const fechaParto = servicioRes.hitos.fpp;
      await expect(
        reproService.registrarParto(
          animalId,
          tenantId,
          userId,
          {
            fechaEvento: '2025-02-28',
            eventoServicioId: servicioRes.evento.id,
          },
          queryRunner.manager,
        ),
      ).rejects.toThrow(BadRequestException);
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

      const fechaServicioNuevoCiclo = new Date(`${fechaParto}T00:00:00.000Z`);
      fechaServicioNuevoCiclo.setUTCDate(fechaServicioNuevoCiclo.getUTCDate() + 1);
      const nuevoCiclo = await reproService.registrarServicio(
        animalId,
        tenantId,
        userId,
        {
          fechaEvento: fechaServicioNuevoCiclo.toISOString().slice(0, 10),
          tipoServicio: 'Monta Natural',
          toroOPajilla: 'Segundo ciclo',
        },
        queryRunner.manager,
      );
      const fechaDiagnosticoNegativo = new Date(
        `${nuevoCiclo.evento.fechaEvento}T00:00:00.000Z`,
      );
      fechaDiagnosticoNegativo.setUTCDate(fechaDiagnosticoNegativo.getUTCDate() + 1);
      fechaCierreCiclo = fechaDiagnosticoNegativo.toISOString().slice(0, 10);
      await reproService.registrarDiagnostico(
        animalId,
        tenantId,
        userId,
        {
          fechaEvento: fechaDiagnosticoNegativo.toISOString().slice(0, 10),
          eventoServicioId: nuevoCiclo.evento.id,
          metodo: 'Palpación',
          resultado: 'Vacía',
        },
        queryRunner.manager,
      );
      const estadoTrasDiagnosticoNegativo =
        await reproService.obtenerEstadoReproductivo(
          animalId,
          tenantId,
          queryRunner.manager,
        );
      expect(estadoTrasDiagnosticoNegativo.estadoActual).toBe('Vacía');

      const diagnosticosAntesDeIntentoReapertura = await queryRunner.manager.count(
        Evento,
        { where: { animalId, tenantId, tipo: 'DIAGNOSTICO' } },
      );
      await expect(
        reproService.registrarDiagnostico(
          animalId,
          tenantId,
          userId,
          {
            fechaEvento: fechaCierreCiclo,
            eventoServicioId: nuevoCiclo.evento.id,
            metodo: 'Palpación',
            resultado: 'Preñada',
          },
          queryRunner.manager,
        ),
      ).rejects.toThrow(BadRequestException);
      const diagnosticosTrasIntentoReapertura = await queryRunner.manager.count(
        Evento,
        { where: { animalId, tenantId, tipo: 'DIAGNOSTICO' } },
      );
      expect(diagnosticosTrasIntentoReapertura).toBe(
        diagnosticosAntesDeIntentoReapertura,
      );

      await queryRunner.commitTransaction();
    } finally {
      await queryRunner.release();
    }
  });

  it('OpenAPI publica la misma forma que perfil, documentos y alta reproductiva', async () => {
    const token = Buffer.from(
      JSON.stringify({
        sub: userId,
        tenant_id: tenantId,
        rol: 'propietario',
        email: 'qa-openapi@example.invalid',
      }),
    ).toString('base64');
    const authorization = `Bearer ${token}`;
    const specification = JSON.parse(
      readFileSync(new URL('../../../openapi.json', import.meta.url), 'utf8'),
    ) as {
      paths: Record<
        string,
        Record<
          string,
          {
            responses: Record<
              string,
              {
                content?: {
                  'application/json'?: {
                    schema?: { $ref?: string; items?: { $ref?: string } };
                  };
                };
              }
            >;
          }
        >
      >;
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };

    const perfil = await request(app.getHttpServer())
      .get('/auth/perfil')
      .set('Authorization', authorization)
      .expect(200);
    expect(Object.keys(perfil.body).sort()).toEqual(
      Object.keys(specification.components.schemas.UserProfileResponseDto.properties).sort(),
    );

    const documentos = await request(app.getHttpServer())
      .get(`/animales/${animalId}/documentos`)
      .set('Authorization', authorization)
      .expect(200);
    expect(documentos.body).toEqual([]);
    expect(
      specification.paths['/animales/{id}/documentos'].get.responses['200']
        .content?.['application/json']?.schema?.items?.$ref,
    ).toBe('#/components/schemas/DocumentoAnimalResponseDto');

    const fechaServicio = new Date(`${fechaCierreCiclo}T00:00:00.000Z`);
    fechaServicio.setUTCDate(fechaServicio.getUTCDate() + 1);
    const response = await request(app.getHttpServer())
      .post(`/animales/${animalId}/servicios`)
      .set('Authorization', authorization)
      .send({
        fechaEvento: fechaServicio.toISOString().slice(0, 10),
        tipoServicio: 'Inseminación Artificial',
        toroOPajilla: 'OpenAPI integration fixture',
      })
      .expect(201);
    const responseSchema =
      specification.paths['/animales/{id}/servicios'].post.responses['201']
        .content?.['application/json']?.schema?.$ref;
    expect(responseSchema).toBe(
      '#/components/schemas/RegistrarServicioResponseDto',
    );
    expect(Object.keys(response.body).sort()).toEqual(
      Object.keys(
        specification.components.schemas.RegistrarServicioResponseDto.properties,
      ).sort(),
    );

    const diaSiguiente = (date: string): string => {
      const next = new Date(`${date}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      return next.toISOString().slice(0, 10);
    };
    const diagnostico = await request(app.getHttpServer())
      .post(`/animales/${animalId}/diagnosticos`)
      .set('Authorization', authorization)
      .send({
        fechaEvento: diaSiguiente(response.body.evento.fechaEvento),
        eventoServicioId: response.body.evento.id,
        metodo: 'Palpación',
        resultado: 'Preñada',
      })
      .expect(201);
    expect(
      specification.paths['/animales/{id}/diagnosticos'].post.responses['201']
        .content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/RegistrarDiagnosticoResponseDto');
    expect(Object.keys(diagnostico.body).sort()).toEqual(
      Object.keys(
        specification.components.schemas.RegistrarDiagnosticoResponseDto.properties,
      ).sort(),
    );

    const secado = await request(app.getHttpServer())
      .post(`/animales/${animalId}/secados`)
      .set('Authorization', authorization)
      .send({ fechaEvento: diaSiguiente(diagnostico.body.evento.fechaEvento) })
      .expect(201);
    expect(
      specification.paths['/animales/{id}/secados'].post.responses['201']
        .content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/RegistrarSecadoResponseDto');
    expect(Object.keys(secado.body).sort()).toEqual(
      Object.keys(
        specification.components.schemas.RegistrarSecadoResponseDto.properties,
      ).sort(),
    );

    const parto = await request(app.getHttpServer())
      .post(`/animales/${animalId}/partos`)
      .set('Authorization', authorization)
      .send({ fechaEvento: diaSiguiente(secado.body.evento.fechaEvento) })
      .expect(201);
    expect(
      specification.paths['/animales/{id}/partos'].post.responses['201']
        .content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/RegistrarPartoResponseDto');
    expect(Object.keys(parto.body).sort()).toEqual(
      Object.keys(
        specification.components.schemas.RegistrarPartoResponseDto.properties,
      ).sort(),
    );
  });
});
