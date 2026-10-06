import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ReproductiveService } from '../services/reproductive.service.js';
import { ReproductiveCalculationService } from '../services/reproductive-calculation.service.js';
import { ReproductiveStateService } from '../services/reproductive-state.service.js';
import { Animal } from '../../animales/entities/animal.entity.js';
import { Evento } from '../../eventos/entities/evento.entity.js';
import { EventoServicio } from '../entities/evento-servicio.entity.js';
import { EventoDiagnostico } from '../entities/evento-diagnostico.entity.js';
import { EventoParto } from '../entities/evento-parto.entity.js';
import { EventoSecado } from '../entities/evento-secado.entity.js';

describe('ReproductiveService (Orquestador de Dominio Reproductivo)', () => {
  let service: ReproductiveService;
  let calculationService: ReproductiveCalculationService;
  let stateService: ReproductiveStateService;
  let mockEntityManager: EntityManager;

  const tenantA = '270d197a-ce3f-4372-8c33-3ea62600e5fa';
  const tenantB = '99999999-9999-9999-9999-999999999999';
  const userId = 'user-uuid-123';

  const mockVacaA: Partial<Animal> = {
    id: 'vaca-uuid-a1',
    tenantId: tenantA,
    areteInterno: '101',
    nombre: 'Mariposa',
    sexo: 'Hembra',
    activo: true,
    raza: {
      id: 'raza-1',
      nombre: 'Holstein',
      diasGestacion: 281,
    } as any,
  };

  const mockToroA: Partial<Animal> = {
    id: 'toro-uuid-a1',
    tenantId: tenantA,
    areteInterno: '005',
    nombre: 'Tormenta',
    sexo: 'Macho',
    activo: true,
    raza: {
      id: 'raza-2',
      nombre: 'Brahman',
      diasGestacion: 293,
    } as any,
  };

  const mockVacaSinRaza: Partial<Animal> = {
    id: 'vaca-uuid-noraza',
    tenantId: tenantA,
    areteInterno: '102',
    sexo: 'Hembra',
    activo: true,
    raza: undefined,
  };

  beforeEach(() => {
    calculationService = new ReproductiveCalculationService();
    // Creamos mock ligero para stateService
    stateService = {
      calcularEstado: vi.fn(async () => ({
        animalId: mockVacaA.id!,
        areteInterno: '101',
        sexo: 'Hembra',
        estadoActual: 'Vacía' as const,
        proximosHitos: [],
        advertencias: [],
      })),
      calcularEstadosBatch: vi.fn(async () => new Map()),
      derivarEstadoDesdeEventos: vi.fn(),
      obtenerHistorial: vi.fn(),
    } as unknown as ReproductiveStateService;

    // Mock dinámico de EntityManager.
    // `transaction` ejecuta el callback con el mismo manager: contra Postgres
    // real esto es un SAVEPOINT anidado dentro de la transacción que ya abrió
    // RlsTransactionInterceptor, así que el manager efectivo es equivalente.
    mockEntityManager = {
      findOne: vi.fn(),
      find: vi.fn().mockResolvedValue([]),
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn((entityClass, plain) => ({ ...plain })),
      save: vi.fn((entityClass, entity) =>
        Promise.resolve({ id: 'saved-uuid-1', ...entity }),
      ),
      transaction: vi.fn((cb: (m: EntityManager) => Promise<unknown>) =>
        cb(mockEntityManager),
      ),
    } as unknown as EntityManager;

    service = new ReproductiveService(calculationService, stateService);
  });

  describe('registrarServicio', () => {
    it('debe registrar exitosamente un servicio calculando los 5 hitos en una sola transacción', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(
        mockVacaA as Animal,
      );

      const dto = {
        fechaEvento: '2026-03-01',
        tipoServicio: 'Inseminación Artificial' as const,
        toroOPajilla: 'Titan-01',
        responsable: 'Dr. Roberto',
      };

      const result = await service.registrarServicio(
        mockVacaA.id!,
        tenantA,
        userId,
        dto,
        mockEntityManager,
      );

      // Verificaciones
      expect(result).toBeDefined();
      expect(result.evento.tipo).toBe('SERVICIO');
      expect(result.evento.animalId).toBe(mockVacaA.id);
      expect(result.servicio.tipoServicio).toBe('Inseminación Artificial');
      expect(result.servicio.toroOPajilla).toBe('Titan-01');

      // 5 hitos para Holstein (281 días):
      // Servicio: 2026-03-01
      // Palpación: 2026-03-01 + 40 días = 2026-04-10
      // FPP: 2026-03-01 + 281 días = 2026-12-07
      // Secado: FPP - 60 días = 2026-10-08
      expect(result.hitos.palpacionFecha).toBe('2026-04-10');
      expect(result.hitos.fpp).toBe('2026-12-07');
      expect(result.hitos.secadoFecha).toBe('2026-10-08');

      expect(mockEntityManager.save).toHaveBeenCalledTimes(2); // Evento y EventoServicio
    });

    it('debe rechazar con BadRequestException (400) si el animal es macho', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(
        mockToroA as Animal,
      );

      const dto = {
        fechaEvento: '2026-03-01',
        tipoServicio: 'Inseminación Artificial' as const,
        toroOPajilla: 'Pajilla-01',
      };

      await expect(
        service.registrarServicio(
          mockToroA.id!,
          tenantA,
          userId,
          dto,
          mockEntityManager,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe rechazar con BadRequestException (400) si el animal no tiene raza con dias_gestacion configurados', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(
        mockVacaSinRaza as Animal,
      );

      const dto = {
        fechaEvento: '2026-03-01',
        tipoServicio: 'Inseminación Artificial' as const,
        toroOPajilla: 'Pajilla-01',
      };

      await expect(
        service.registrarServicio(
          mockVacaSinRaza.id!,
          tenantA,
          userId,
          dto,
          mockEntityManager,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe rechazar con NotFoundException (404) si el animal no existe o no pertenece al tenant', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(null);

      const dto = {
        fechaEvento: '2026-03-01',
        tipoServicio: 'Inseminación Artificial' as const,
        toroOPajilla: 'Pajilla-01',
      };

      await expect(
        service.registrarServicio(
          'id-inexistente',
          tenantA,
          userId,
          dto,
          mockEntityManager,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza un servicio adicional cuando el ciclo sigue Servida', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(mockVacaA as Animal);
      vi.spyOn(stateService, 'calcularEstado').mockResolvedValue({
        animalId: mockVacaA.id!, areteInterno: '101', sexo: 'Hembra',
        estadoActual: 'Servida', proximosHitos: [], advertencias: [],
      });
      await expect(service.registrarServicio(
        mockVacaA.id!, tenantA, userId,
        { fechaEvento: '2026-03-02', tipoServicio: 'Monta Natural', toroOPajilla: 'Toro 2' },
        mockEntityManager,
      )).rejects.toThrow(BadRequestException);
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });

    it('no permite fechar un nuevo servicio antes del diagnóstico negativo que cerró el ciclo', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(mockVacaA as Animal);
      vi.spyOn(stateService, 'calcularEstado').mockResolvedValue({
        animalId: mockVacaA.id!, areteInterno: '101', sexo: 'Hembra',
        estadoActual: 'Vacía',
        ultimoDiagnostico: {
          eventoId: 'diagnostico-negativo', fecha: '2026-03-10', metodo: 'Palpación',
          resultado: 'Vacía', eventoServicioId: 'servicio-anterior',
        },
        proximosHitos: [], advertencias: [],
      });
      await expect(service.registrarServicio(
        mockVacaA.id!, tenantA, userId,
        { fechaEvento: '2026-03-09', tipoServicio: 'Monta Natural', toroOPajilla: 'Toro 2' },
        mockEntityManager,
      )).rejects.toThrow(BadRequestException);
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });

    it('debe marcar el evento anterior como revertido = true cuando se envía eventoCorrigeId', async () => {
      const eventoPrevio: Partial<Evento> = {
        id: 'evento-previo-id',
        animalId: mockVacaA.id,
        tenantId: tenantA,
        tipo: 'SERVICIO',
        revertido: false,
      };

      vi.spyOn(mockEntityManager, 'findOne')
        .mockResolvedValueOnce(mockVacaA as Animal) // Búsqueda de animal
        .mockResolvedValueOnce(eventoPrevio as Evento); // Búsqueda de evento anterior

      const dto = {
        fechaEvento: '2026-03-02',
        tipoServicio: 'Monta Natural' as const,
        toroOPajilla: 'Toro Campeon',
        eventoCorrigeId: 'evento-previo-id',
      };

      await service.registrarServicio(
        mockVacaA.id!,
        tenantA,
        userId,
        dto,
        mockEntityManager,
      );

      expect(eventoPrevio.revertido).toBe(true);
      expect(mockEntityManager.save).toHaveBeenCalledWith(Evento, eventoPrevio);
    });
  });

  describe('registrarDiagnostico', () => {
    it('debe registrar un diagnóstico de preñez vinculado a un servicio previo', async () => {
      const mockServicioEvento: Partial<Evento> = {
        id: 'servicio-evento-id',
        animalId: mockVacaA.id,
        tenantId: tenantA,
        tipo: 'SERVICIO',
        revertido: false,
        fechaEvento: '2026-03-01',
      };

      vi.spyOn(mockEntityManager, 'findOne')
        .mockResolvedValueOnce(mockVacaA as Animal)
        .mockResolvedValueOnce(mockServicioEvento as Evento);
      vi.spyOn(stateService, 'calcularEstado').mockResolvedValue({
        animalId: mockVacaA.id!,
        areteInterno: '101',
        sexo: 'Hembra',
        estadoActual: 'Servida',
        servicioActivo: {
          eventoId: mockServicioEvento.id!,
          fechaServicio: '2026-03-01',
          tipoServicio: 'Monta Natural',
          toroOPajilla: 'Toro 1',
          fpp: '2026-12-07',
          palpacionFecha: '2026-04-10',
          secadoFecha: '2026-10-08',
          avisoPartoFecha: '2026-11-22',
          avisoPartoUrgenteFecha: '2026-12-04',
        },
        proximosHitos: [],
        advertencias: [],
      });

      const dto = {
        fechaEvento: '2026-04-10',
        eventoServicioId: 'servicio-evento-id',
        metodo: 'Palpación' as const,
        resultado: 'Preñada' as const,
        notas: 'Confirmada preñez de 40 días',
      };

      const result = await service.registrarDiagnostico(
        mockVacaA.id!,
        tenantA,
        userId,
        dto,
        mockEntityManager,
      );

      expect(result.evento.tipo).toBe('DIAGNOSTICO');
      expect(result.diagnostico.resultado).toBe('Preñada');
      expect(result.diagnostico.metodo).toBe('Palpación');
    });

    it('debe rechazar con NotFoundException (404) si el servicio previo no existe o no pertenece al animal', async () => {
      vi.spyOn(mockEntityManager, 'findOne')
        .mockResolvedValueOnce(mockVacaA as Animal)
        .mockResolvedValueOnce(null); // Servicio no encontrado

      const dto = {
        fechaEvento: '2026-04-10',
        eventoServicioId: 'servicio-inexistente',
        metodo: 'Ecografía' as const,
        resultado: 'Preñada' as const,
      };

      await expect(
        service.registrarDiagnostico(
          mockVacaA.id!,
          tenantA,
          userId,
          dto,
          mockEntityManager,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza una corrección de diagnóstico que intenta reemplazar un servicio', async () => {
      const servicio = {
        id: 'servicio-evento-id', animalId: mockVacaA.id, tenantId: tenantA,
        tipo: 'SERVICIO', revertido: false, fechaEvento: '2026-03-01',
      } as Evento;
      vi.spyOn(mockEntityManager, 'findOne')
        .mockResolvedValueOnce(mockVacaA as Animal)
        .mockResolvedValueOnce(servicio)
        .mockResolvedValueOnce(servicio);

      await expect(service.registrarDiagnostico(
        mockVacaA.id!, tenantA, userId,
        {
          fechaEvento: '2026-04-10', eventoServicioId: servicio.id,
          eventoCorrigeId: servicio.id, metodo: 'Palpación', resultado: 'Preñada',
        },
        mockEntityManager,
      )).rejects.toThrow(BadRequestException);
      expect(servicio.revertido).toBe(false);
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });

    it('rechaza un diagnóstico anterior al servicio sin guardar eventos', async () => {
      const servicio = {
        id: 'servicio-evento-id',
        animalId: mockVacaA.id,
        tenantId: tenantA,
        tipo: 'SERVICIO',
        revertido: false,
        fechaEvento: '2026-03-01',
      } as Evento;
      vi.spyOn(mockEntityManager, 'findOne')
        .mockResolvedValueOnce(mockVacaA as Animal)
        .mockResolvedValueOnce(servicio);
      vi.spyOn(stateService, 'calcularEstado').mockResolvedValue({
        animalId: mockVacaA.id!, areteInterno: '101', sexo: 'Hembra',
        estadoActual: 'Vacía', proximosHitos: [], advertencias: [],
      });

      await expect(service.registrarDiagnostico(
        mockVacaA.id!, tenantA, userId,
        { fechaEvento: '2026-02-28', eventoServicioId: servicio.id, metodo: 'Palpación', resultado: 'Preñada' },
        mockEntityManager,
      )).rejects.toThrow(BadRequestException);
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });

    it('rechaza un diagnóstico que intenta reabrir un ciclo ya cerrado', async () => {
      const servicio = {
        id: 'servicio-evento-id', animalId: mockVacaA.id, tenantId: tenantA,
        tipo: 'SERVICIO', revertido: false, fechaEvento: '2026-03-01',
      } as Evento;
      vi.spyOn(mockEntityManager, 'findOne')
        .mockResolvedValueOnce(mockVacaA as Animal)
        .mockResolvedValueOnce(servicio);
      vi.spyOn(stateService, 'calcularEstado').mockResolvedValue({
        animalId: mockVacaA.id!, areteInterno: '101', sexo: 'Hembra',
        estadoActual: 'Vacía', proximosHitos: [], advertencias: [],
      });

      await expect(service.registrarDiagnostico(
        mockVacaA.id!, tenantA, userId,
        {
          fechaEvento: '2026-04-10', eventoServicioId: servicio.id,
          metodo: 'Palpación', resultado: 'Preñada',
        },
        mockEntityManager,
      )).rejects.toThrow(BadRequestException);
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });
  });

  describe('registrarParto y registrarSecado', () => {
    /** Deja al animal en un estado desde el que un parto es válido. */
    const estadoPrenada = (estadoActual: 'Preñada' | 'En Secado' = 'Preñada') =>
      vi.spyOn(stateService, 'calcularEstado').mockResolvedValue({
        animalId: mockVacaA.id!,
        areteInterno: '101',
        sexo: 'Hembra',
        estadoActual,
        servicioActivo: {
          eventoId: 'servicio-activo', fechaServicio: '2026-01-01',
          tipoServicio: 'Inseminación Artificial', toroOPajilla: 'Toro 1',
          fpp: '2026-10-09', palpacionFecha: '2026-02-10', secadoFecha: '2026-08-10',
          avisoPartoFecha: '2026-09-24', avisoPartoUrgenteFecha: '2026-10-06',
        },
        ultimoDiagnostico: {
          eventoId: 'diagnostico-activo', fecha: '2026-03-01', metodo: 'Palpación',
          resultado: 'Preñada', eventoServicioId: 'servicio-activo',
        },
        proximosHitos: [],
        advertencias: [],
      });

    it('debe registrar parto exitosamente', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(
        mockVacaA as Animal,
      );
      estadoPrenada();

      const dto = {
        fechaEvento: '2026-09-07',
        facilidadParto: 'Normal' as const,
        observaciones: 'Cría hembra nacida sana',
      };

      const result = await service.registrarParto(
        mockVacaA.id!,
        tenantA,
        userId,
        dto,
        mockEntityManager,
      );

      expect(result.evento.tipo).toBe('PARTO');
      expect(result.parto.facilidadParto).toBe('Normal');
    });

    it('acepta el parto también desde "En Secado"', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(
        mockVacaA as Animal,
      );
      estadoPrenada('En Secado');

      const result = await service.registrarParto(
        mockVacaA.id!,
        tenantA,
        userId,
        { fechaEvento: '2026-09-07' },
        mockEntityManager,
      );

      expect(result.evento.tipo).toBe('PARTO');
    });

    it('rechaza parto anterior al diagnóstico positivo activo', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(mockVacaA as Animal);
      estadoPrenada();
      await expect(service.registrarParto(
        mockVacaA.id!, tenantA, userId, { fechaEvento: '2026-02-28' }, mockEntityManager,
      )).rejects.toThrow(BadRequestException);
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });

    it('CASO LÍMITE: rechaza con 400 un parto sobre un animal que no está preñado', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(
        mockVacaA as Animal,
      );
      vi.spyOn(stateService, 'calcularEstado').mockResolvedValue({
        animalId: mockVacaA.id!,
        areteInterno: '101',
        sexo: 'Hembra',
        estadoActual: 'Vacía',
        proximosHitos: [],
        advertencias: [],
      });

      await expect(
        service.registrarParto(
          mockVacaA.id!,
          tenantA,
          userId,
          { fechaEvento: '2026-09-07' },
          mockEntityManager,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('SEGURIDAD: rechaza con 404 un eventoServicioId que no pertenece al animal o a la finca', async () => {
      // El animal existe, pero la búsqueda del evento de servicio no devuelve nada.
      // Sin esta validación el id se persistía tal cual: las FK de Postgres no
      // aplican RLS, así que un id de otra finca quedaba enlazado.
      vi.spyOn(mockEntityManager, 'findOne').mockImplementation(
        async (entityClass: any) =>
          entityClass === Animal ? (mockVacaA as Animal) : null,
      );

      await expect(
        service.registrarParto(
          mockVacaA.id!,
          tenantA,
          userId,
          {
            fechaEvento: '2026-09-07',
            eventoServicioId: '11111111-1111-4111-8111-111111111111',
          },
          mockEntityManager,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('CASO LÍMITE: rechaza con 404 un eventoCorrigeId inexistente en un parto (antes devolvía 201 sin corregir nada)', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockImplementation(
        async (entityClass: any) =>
          entityClass === Animal ? (mockVacaA as Animal) : null,
      );
      estadoPrenada();

      await expect(
        service.registrarParto(
          mockVacaA.id!,
          tenantA,
          userId,
          {
            fechaEvento: '2026-09-07',
            eventoCorrigeId: '22222222-2222-4222-8222-222222222222',
          },
          mockEntityManager,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('CASO LÍMITE: rechaza con 404 un eventoCorrigeId inexistente en un secado', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockImplementation(
        async (entityClass: any) =>
          entityClass === Animal ? (mockVacaA as Animal) : null,
      );

      await expect(
        service.registrarSecado(
          mockVacaA.id!,
          tenantA,
          userId,
          {
            fechaEvento: '2026-09-07',
            eventoCorrigeId: '33333333-3333-4333-8333-333333333333',
          },
          mockEntityManager,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe registrar secado real exitosamente', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(
        mockVacaA as Animal,
      );
      estadoPrenada();

      const dto = {
        fechaEvento: '2026-10-08',
        notas: 'Terapia de secado aplicada',
      };

      const result = await service.registrarSecado(
        mockVacaA.id!,
        tenantA,
        userId,
        dto,
        mockEntityManager,
      );

      expect(result.evento.tipo).toBe('SECADO');
      expect(result.secado).toBeDefined();
    });

    it('rechaza secado anterior al diagnóstico positivo activo', async () => {
      vi.spyOn(mockEntityManager, 'findOne').mockResolvedValue(mockVacaA as Animal);
      estadoPrenada();
      await expect(service.registrarSecado(
        mockVacaA.id!, tenantA, userId, { fechaEvento: '2026-02-28' }, mockEntityManager,
      )).rejects.toThrow(BadRequestException);
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });
  });

  describe('Aislamiento Multitenant en Feed de Próximos Eventos (Dashboard de Karla)', () => {
    it('CRITERIO 4: GET /reproductivo/proximos-eventos no incluye animales de otro tenant', async () => {
      // Simular que el tenant A tiene 2 vacas y el tenant B tiene 1 vaca
      const vacaTenantA1: Partial<Animal> = {
        id: 'vaca-a1',
        tenantId: tenantA,
        areteInterno: '101',
        nombre: 'Paloma',
        sexo: 'Hembra',
        activo: true,
      };

      // manager.find busca animales con where: { tenantId: tenantA, activo: true }
      vi.spyOn(mockEntityManager, 'find').mockImplementation(
        async (entityClass, options: any) => {
          if (options?.where?.tenantId === tenantA) {
            return [vacaTenantA1 as Animal];
          }
          return []; // Tenant B o desconocido
        },
      );

      // El feed ahora deriva los estados en lote: una sola pasada para todas las
      // hembras, en vez de una cascada de consultas por animal.
      vi.spyOn(stateService, 'calcularEstadosBatch').mockImplementation(
        async (animales) =>
          new Map(
            animales.map((a) => [
              a.id,
              {
                animalId: a.id,
                areteInterno: '101',
                sexo: 'Hembra',
                razaNombre: 'Holstein',
                estadoActual: 'Preñada' as const,
                diasEnEstado: 200,
                diasGestacionRaza: 281,
                proximosHitos: [
                  {
                    tipo: 'Parto FPP' as const,
                    fecha: '2026-10-15',
                    diasRestantes: 20,
                    urgente: false,
                  },
                  {
                    tipo: 'Aviso Parto Urgente' as const,
                    fecha: '2026-10-12',
                    diasRestantes: 17,
                    urgente: true,
                  },
                ],
                advertencias: [],
              },
            ]),
          ),
      );

      // Consultar para Tenant A
      const eventosTenantA = await service.obtenerProximosEventos(
        tenantA,
        mockEntityManager,
      );
      expect(eventosTenantA).toHaveLength(2);
      expect(eventosTenantA.every((e) => e.animalId === 'vaca-a1')).toBe(true);
      // 'Parto FPP' se publica como 'Parto' en el contrato del feed.
      expect(eventosTenantA.map((e) => e.tipo)).toContain('Parto');
      // El aviso urgente ya viaja en el feed, con su bandera.
      const urgente = eventosTenantA.find(
        (e) => e.tipo === 'Aviso Parto Urgente',
      );
      expect(urgente?.urgente).toBe(true);

      // Consultar para Tenant B
      const eventosTenantB = await service.obtenerProximosEventos(
        tenantB,
        mockEntityManager,
      );
      expect(eventosTenantB).toHaveLength(0); // Cero animales de tenant A fugados hacia tenant B
    });

    it('CASO LÍMITE: la ventana incluye los hitos vencidos hace 7 días y excluye los de 8', async () => {
      const vaca: Partial<Animal> = {
        id: 'vaca-a1',
        tenantId: tenantA,
        areteInterno: '101',
        nombre: 'Paloma',
        sexo: 'Hembra',
        activo: true,
      };
      vi.spyOn(mockEntityManager, 'find').mockResolvedValue([vaca as Animal]);
      vi.spyOn(stateService, 'calcularEstadosBatch').mockResolvedValue(
        new Map([
          [
            'vaca-a1',
            {
              animalId: 'vaca-a1',
              areteInterno: '101',
              sexo: 'Hembra',
              estadoActual: 'Servida' as const,
              proximosHitos: [
                {
                  tipo: 'Palpación' as const,
                  fecha: '2026-09-11',
                  diasRestantes: -7,
                  urgente: false,
                },
                {
                  tipo: 'Secado' as const,
                  fecha: '2026-09-10',
                  diasRestantes: -8,
                  urgente: false,
                },
                {
                  tipo: 'Parto FPP' as const,
                  fecha: '2026-10-18',
                  diasRestantes: 30,
                  urgente: false,
                },
                {
                  tipo: 'Aviso Parto' as const,
                  fecha: '2026-10-19',
                  diasRestantes: 31,
                  urgente: false,
                },
              ],
              advertencias: [],
            },
          ],
        ]),
      );

      const eventos = await service.obtenerProximosEventos(
        tenantA,
        mockEntityManager,
        30,
      );

      const dias = eventos.map((e) => e.diasRestantes);
      expect(dias).toContain(-7); // el borde inferior entra
      expect(dias).not.toContain(-8); // uno más allá, no
      expect(dias).toContain(30); // el borde superior entra
      expect(dias).not.toContain(31); // uno más allá, no
    });
  });
});
