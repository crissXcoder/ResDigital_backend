import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ForbiddenException,
  NotFoundException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { EntityManager } from 'typeorm';
import { ReproductiveController } from '../reproductive.controller.js';
import {
  ReproductiveService,
  DIAS_VENTANA_DEFAULT,
} from '../services/reproductive.service.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';
import { RegistrarServicioDto } from '../dto/registrar-servicio.dto.js';
import { RegistrarDiagnosticoDto } from '../dto/registrar-diagnostico.dto.js';
import { RegistrarPartoDto } from '../dto/registrar-parto.dto.js';
import { ProximosEventosQueryDto } from '../dto/proximos-eventos-query.dto.js';
import type { EstadoReproductivoInfo } from '../interfaces/reproductive-state.interface.js';

describe('ReproductiveController (Controlador REST y Seguridad RBAC)', () => {
  let controller: ReproductiveController;
  let service: ReproductiveService;
  let rolesGuard: RolesGuard;
  let reflector: Reflector;
  let mockEntityManager: EntityManager;

  const mockPropietario: AuthenticatedUser = {
    userId: 'user-prop-1',
    tenantId: 'tenant-finca-1',
    rol: 'propietario',
    email: 'propietario@finca.cr',
    rawClaims: {},
  };

  const mockVeterinario: AuthenticatedUser = {
    userId: 'user-vet-1',
    tenantId: 'tenant-finca-1',
    rol: 'veterinario',
    email: 'vet@finca.cr',
    rawClaims: {},
  };

  const mockPeon: AuthenticatedUser = {
    userId: 'user-peon-1',
    tenantId: 'tenant-finca-1',
    rol: 'peon',
    email: 'peon@finca.cr',
    rawClaims: {},
  };

  const createMockContext = (
    user: AuthenticatedUser,
    handler: Function,
  ): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => handler,
      getClass: () => ReproductiveController,
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    service = {
      registrarServicio: vi.fn(),
      registrarDiagnostico: vi.fn(),
      registrarParto: vi.fn(),
      registrarSecado: vi.fn(),
      obtenerEstadoReproductivo: vi.fn(),
      obtenerHistorialReproductivo: vi.fn(),
      obtenerProximosEventos: vi.fn(),
    } as unknown as ReproductiveService;

    controller = new ReproductiveController(service);

    reflector = new Reflector();
    rolesGuard = new RolesGuard(reflector);
    mockEntityManager = {} as EntityManager;
  });

  describe('CRITERIO 1: Seguridad RBAC (RolesGuard)', () => {
    it('CRITERIO 1: Un peon autenticado puede registrar un servicio según la matriz de roles', () => {
      const rolesDecorados = reflector.get(
        'roles',
        controller.registrarServicio,
      );
      expect(rolesDecorados).toEqual([
        'propietario',
        'administrador',
        'peon',
        'veterinario',
      ]);

      const contextPeon = createMockContext(
        mockPeon,
        controller.registrarServicio,
      );
      expect(rolesGuard.canActivate(contextPeon)).toBe(true);
    });

    it('Permite acceso a POST /animales/:id/servicios para roles autorizados', () => {
      const contextProp = createMockContext(
        mockPropietario,
        controller.registrarServicio,
      );
      expect(rolesGuard.canActivate(contextProp)).toBe(true);

      const contextVet = createMockContext(
        mockVeterinario,
        controller.registrarServicio,
      );
      expect(rolesGuard.canActivate(contextVet)).toBe(true);
    });

    it('GET /animales/:id/estado-reproductivo y GET /reproductivo/proximos-eventos son de solo lectura y accesibles para peón', () => {
      const rolesEstado = reflector.get(
        'roles',
        controller.obtenerEstadoReproductivo,
      );
      expect(rolesEstado).toBeUndefined(); // Sin restricción de roles

      const rolesFeed = reflector.get(
        'roles',
        controller.obtenerProximosEventos,
      );
      expect(rolesFeed).toBeUndefined(); // Sin restricción de roles

      const contextPeon = createMockContext(
        mockPeon,
        controller.obtenerEstadoReproductivo,
      );
      expect(rolesGuard.canActivate(contextPeon)).toBe(true);
    });
  });

  describe('CRITERIO 2: Validación de DTOs antes de tocar la base de datos', () => {
    it('CRITERIO 2: Un DTO con tipoServicio fuera del enum es rechazado con error de validación (400) antes de tocar la base de datos', async () => {
      // 'Celo Detectado' o un tipo inventado debe ser rechazado
      const payloadInvalido = {
        fechaEvento: '2026-03-01',
        tipoServicio: 'Celo Detectado', // Inválido según el CHECK y enum
        toroOPajilla: 'Pajilla-01',
      };

      const dtoInstance = plainToInstance(
        RegistrarServicioDto,
        payloadInvalido,
      );
      const errors = await validate(dtoInstance);

      expect(errors.length).toBeGreaterThan(0);
      const tipoServicioError = errors.find(
        (e) => e.property === 'tipoServicio',
      );
      expect(tipoServicioError).toBeDefined();
      expect(tipoServicioError?.constraints?.isIn).toBeDefined();
    });

    it('DTO con tipoServicio válido ("Inseminación Artificial" o "Monta Natural") pasa validación limpiamente', async () => {
      const payloadValidoIA = {
        fechaEvento: '2026-03-01',
        tipoServicio: 'Inseminación Artificial',
        toroOPajilla: 'Titan-01',
      };

      const dtoIA = plainToInstance(RegistrarServicioDto, payloadValidoIA);
      const errorsIA = await validate(dtoIA);
      expect(errorsIA.length).toBe(0);

      const payloadValidoMN = {
        fechaEvento: '2026-03-01',
        tipoServicio: 'Monta Natural',
        toroOPajilla: 'Toro Padrillo',
      };

      const dtoMN = plainToInstance(RegistrarServicioDto, payloadValidoMN);
      const errorsMN = await validate(dtoMN);
      expect(errorsMN.length).toBe(0);
    });

    it('RegistrarDiagnosticoDto rechaza métodos o resultados fuera de catálogo', async () => {
      const payloadInvalido = {
        fechaEvento: '2026-04-10',
        eventoServicioId: 'a0b9432d-cf48-4be7-a2f0-1a76c66cfcb1',
        metodo: 'Ojo clínico', // Fuera de ['Palpación', 'Ecografía', 'PAG']
        resultado: 'Quizás', // Fuera de ['Preñada', 'Vacía']
      };

      const dtoInstance = plainToInstance(
        RegistrarDiagnosticoDto,
        payloadInvalido,
      );
      const errors = await validate(dtoInstance);

      expect(errors.length).toBe(2);
      expect(errors.some((e) => e.property === 'metodo')).toBe(true);
      expect(errors.some((e) => e.property === 'resultado')).toBe(true);
    });
  });

  describe('CRITERIO 3: Aislamiento Multitenant (404 vía RLS)', () => {
    it('CRITERIO 3: GET /animales/:id/estado-reproductivo de un animal de otro tenant devuelve 404 (por RLS al no encontrar fila)', async () => {
      // El servicio lanza NotFoundException si no existe fila para ese tenantId
      vi.spyOn(service, 'obtenerEstadoReproductivo').mockRejectedValue(
        new NotFoundException(
          "Animal con ID 'vaca-tenant-ajeno' no encontrado.",
        ),
      );

      await expect(
        controller.obtenerEstadoReproductivo(
          'vaca-tenant-ajeno',
          mockPropietario,
          mockEntityManager,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('GET /animales/:id/estado-reproductivo devuelve el estado y próximos hitos si el animal pertenece al tenant', async () => {
      const mockEstado: EstadoReproductivoInfo = {
        animalId: 'vaca-1',
        areteInterno: '101',
        sexo: 'Hembra',
        estadoActual: 'Servida',
        diasEnEstado: 15,
        proximosHitos: [
          {
            tipo: 'Palpación',
            fecha: '2026-04-10',
            diasRestantes: 25,
            urgente: false,
          },
        ],
        advertencias: [],
      };

      vi.spyOn(service, 'obtenerEstadoReproductivo').mockResolvedValue(
        mockEstado,
      );

      const result = await controller.obtenerEstadoReproductivo(
        'vaca-1',
        mockPropietario,
        mockEntityManager,
      );

      expect(result.estadoActual).toBe('Servida');
      expect(result.proximosHitos).toHaveLength(1);
    });
  });

  describe('CRITERIO 4: Feed de Próximos Eventos para el Dashboard de Karla', () => {
    it('GET /reproductivo/proximos-eventos entrega el feed estructurado para Karla', async () => {
      vi.spyOn(service, 'obtenerProximosEventos').mockResolvedValue([
        {
          animalId: 'vaca-101',
          arete: '101',
          nombre: 'Mariposa',
          tipo: 'Palpación',
          fecha: '2026-04-10',
          diasRestantes: 12,
          urgente: false,
        },
        {
          animalId: 'vaca-102',
          arete: '102',
          nombre: 'Estrella',
          tipo: 'Aviso Parto Urgente',
          fecha: '2026-04-15',
          diasRestantes: 17,
          urgente: true,
        },
      ]);

      // La ventana ya viaja en un DTO validado, no como string suelto parseado
      // a mano fuera del ValidationPipe.
      const query = new ProximosEventosQueryDto();
      query.diasVentana = 60;

      const feed = await controller.obtenerProximosEventos(
        mockPropietario,
        mockEntityManager,
        query,
      );

      expect(feed).toHaveLength(2);
      expect(feed[0]).toEqual({
        animalId: 'vaca-101',
        arete: '101',
        nombre: 'Mariposa',
        tipo: 'Palpación',
        fecha: '2026-04-10',
        diasRestantes: 12,
        urgente: false,
      });
      // El contrato que consume el Dashboard incluye el aviso urgente de FPP-3.
      expect(feed[1].tipo).toBe('Aviso Parto Urgente');
      expect(feed[1].urgente).toBe(true);

      expect(service.obtenerProximosEventos).toHaveBeenCalledWith(
        mockPropietario.tenantId,
        mockEntityManager,
        60,
      );
    });

    it('usa la ventana por defecto cuando el cliente no manda diasVentana', async () => {
      vi.spyOn(service, 'obtenerProximosEventos').mockResolvedValue([]);

      await controller.obtenerProximosEventos(
        mockPropietario,
        mockEntityManager,
        new ProximosEventosQueryDto(),
      );

      expect(service.obtenerProximosEventos).toHaveBeenCalledWith(
        mockPropietario.tenantId,
        mockEntityManager,
        DIAS_VENTANA_DEFAULT,
      );
    });
  });

  describe('Historial reproductivo', () => {
    it('GET /animales/:id/eventos-reproductivos devuelve el historial cronológico, incluidos los revertidos', async () => {
      const evento = (
        id: string,
        tipo: string,
        fechaEvento: string,
        revertido: boolean,
      ) =>
        ({
          id,
          tenantId: mockPropietario.tenantId,
          animalId: 'vaca-1',
          tipo,
          fechaEvento,
          fechaRegistro: new Date(`${fechaEvento}T08:00:00Z`),
          usuarioId: 'u1',
          revertido,
          eventoCorrigeId: null,
          notas: null,
        }) as any;

      const evS = evento('s1', 'SERVICIO', '2026-01-01', true);
      const evS2 = evento('s2', 'SERVICIO', '2026-01-15', false);

      vi.spyOn(service, 'obtenerHistorialReproductivo').mockResolvedValue([
        {
          evento: evS,
          servicio: {
            eventoId: 's1',
            tipoServicio: 'Monta Natural',
            toroOPajilla: 'Toro equivocado',
            responsable: null,
            palpacionFecha: '2026-02-10',
            secadoFecha: '2026-08-10',
            avisoPartoFecha: '2026-09-24',
            avisoPartoUrgenteFecha: '2026-10-06',
            fpp: '2026-10-09',
          } as any,
        },
        {
          evento: evS2,
          servicio: {
            eventoId: 's2',
            tipoServicio: 'Inseminación Artificial',
            toroOPajilla: 'Titan',
            responsable: 'Dr. Roberto',
            palpacionFecha: '2026-02-24',
            secadoFecha: '2026-08-24',
            avisoPartoFecha: '2026-10-08',
            avisoPartoUrgenteFecha: '2026-10-20',
            fpp: '2026-10-23',
          } as any,
        },
      ]);

      const historial = await controller.obtenerHistorialReproductivo(
        'vaca-1',
        mockPropietario,
        mockEntityManager,
      );

      expect(historial).toHaveLength(2);
      // El registro es append-only: la corrección tiene que verse, marcada.
      expect(historial[0].revertido).toBe(true);
      expect(historial[1].revertido).toBe(false);
      expect(historial.map((h) => h.fechaEvento)).toEqual([
        '2026-01-01',
        '2026-01-15',
      ]);
      expect((historial[1].detalle as any).toroOPajilla).toBe('Titan');
    });
  });
});
