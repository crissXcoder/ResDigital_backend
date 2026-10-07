import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PotrerosService } from '../potreros.service.js';
import { Potrero } from '../entities/potrero.entity.js';
import { Animal } from '../../animales/entities/animal.entity.js';
import { Evento } from '../../eventos/entities/evento.entity.js';
import { EventoMovimiento } from '../entities/evento-movimiento.entity.js';
import { EntityManager } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('PotrerosService - Trazabilidad Histórica (POT-T001)', () => {
  let service: PotrerosService;
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';
  const USER_ID = '00000000-0000-0000-0000-000000000099';
  const POTRERO_DESTINO_ID = '11111111-1111-1111-1111-111111111111';
  const POTRERO_ORIGEN_ID = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    service = new PotrerosService();
  });

  it('debe registrar Evento y EventoMovimiento con potrero origen y destino al trasladar animales', async () => {
    const potreroDestino = {
      id: POTRERO_DESTINO_ID,
      tenantId: TENANT_ID,
      nombre: 'Potrero La Loma',
      areaHa: 10,
      capacidadRecomendadaUaHa: 2,
      diasDescansoRecomendados: 30,
      fechaUltimoIngreso: null,
      animales: [],
    } as unknown as Potrero;

    const animalExistente = {
      id: 'animal-1',
      tenantId: TENANT_ID,
      areteInterno: '101',
      nombre: 'Manuela',
      potreroId: POTRERO_ORIGEN_ID,
      categoria: 'Vaca',
    } as unknown as Animal;

    const mockRepoPotrero = {
      findOne: vi.fn().mockResolvedValue(potreroDestino),
      save: vi.fn().mockImplementation((p) => Promise.resolve(p)),
    };

    const mockRepoAnimal = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([animalExistente]),
      }),
      save: vi.fn().mockImplementation((a) => Promise.resolve(a)),
    };

    const eventosGuardados: Evento[] = [];
    const mockRepoEvento = {
      create: vi.fn().mockImplementation((dto) => ({ id: 'evento-101', ...dto })),
      save: vi.fn().mockImplementation((e) => {
        eventosGuardados.push(e);
        return Promise.resolve(e);
      }),
    };

    const movimientosGuardados: EventoMovimiento[] = [];
    const mockRepoEventoMovimiento = {
      create: vi.fn().mockImplementation((dto) => ({ ...dto })),
      save: vi.fn().mockImplementation((m) => {
        movimientosGuardados.push(m);
        return Promise.resolve(m);
      }),
    };

    const mockManager = {
      getRepository: vi.fn().mockImplementation((entity) => {
        if (entity === Potrero) return mockRepoPotrero;
        if (entity === Animal) return mockRepoAnimal;
        if (entity === Evento) return mockRepoEvento;
        if (entity === EventoMovimiento) return mockRepoEventoMovimiento;
        return {};
      }),
    } as unknown as EntityManager;

    // Espiamos findOne para simular la recarga final
    vi.spyOn(service, 'findOne').mockResolvedValue(potreroDestino as any);

    await service.asignarAnimales(
      POTRERO_DESTINO_ID,
      TENANT_ID,
      USER_ID,
      {
        animalIds: ['animal-1'],
        fecha: '2026-10-06',
        motivo: 'Rotación por descanso de pasto',
      },
      mockManager,
    );

    // 1. Debe haber guardado el evento padre
    expect(eventosGuardados).toHaveLength(1);
    expect(eventosGuardados[0]).toMatchObject({
      tenantId: TENANT_ID,
      animalId: 'animal-1',
      tipo: 'MOVIMIENTO',
      fechaEvento: '2026-10-06',
      usuarioId: USER_ID,
      notas: 'Rotación por descanso de pasto',
    });

    // 2. Debe haber guardado el detalle del movimiento con origen previo y destino
    expect(movimientosGuardados).toHaveLength(1);
    expect(movimientosGuardados[0]).toMatchObject({
      eventoId: 'evento-101',
      potreroOrigenId: POTRERO_ORIGEN_ID,
      potreroDestinoId: POTRERO_DESTINO_ID,
      motivo: 'Rotación por descanso de pasto',
    });

    // 3. Ubicación actual del animal debe haber sido actualizada a potrero destino
    expect(animalExistente.potreroId).toBe(POTRERO_DESTINO_ID);
    expect(mockRepoAnimal.save).toHaveBeenCalledWith(animalExistente);

    // 4. Potrero destino debe haber actualizado su fechaUltimoIngreso
    expect(potreroDestino.fechaUltimoIngreso).toBe('2026-10-06');
    expect(mockRepoPotrero.save).toHaveBeenCalledWith(potreroDestino);
  });

  it('debe registrar potreroOrigenId como null cuando el animal no tenía potrero previo', async () => {
    const potreroDestino = {
      id: POTRERO_DESTINO_ID,
      tenantId: TENANT_ID,
      nombre: 'Potrero 1',
    } as unknown as Potrero;

    const animalSinPotrero = {
      id: 'animal-2',
      tenantId: TENANT_ID,
      potreroId: null,
    } as unknown as Animal;

    const movimientosGuardados: EventoMovimiento[] = [];

    const mockManager = {
      getRepository: vi.fn().mockImplementation((entity) => {
        if (entity === Potrero) {
          return {
            findOne: vi.fn().mockResolvedValue(potreroDestino),
            save: vi.fn().mockResolvedValue(potreroDestino),
          };
        }
        if (entity === Animal) {
          return {
            createQueryBuilder: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnThis(),
              getMany: vi.fn().mockResolvedValue([animalSinPotrero]),
            }),
            save: vi.fn().mockResolvedValue(animalSinPotrero),
          };
        }
        if (entity === Evento) {
          return {
            create: vi.fn().mockReturnValue({ id: 'ev-2' }),
            save: vi.fn().mockImplementation((e) => Promise.resolve(e)),
          };
        }
        if (entity === EventoMovimiento) {
          return {
            create: vi.fn().mockImplementation((dto) => dto),
            save: vi.fn().mockImplementation((m) => {
              movimientosGuardados.push(m);
              return Promise.resolve(m);
            }),
          };
        }
        return {};
      }),
    } as unknown as EntityManager;

    vi.spyOn(service, 'findOne').mockResolvedValue(potreroDestino as any);

    await service.asignarAnimales(
      POTRERO_DESTINO_ID,
      TENANT_ID,
      USER_ID,
      { animalIds: ['animal-2'] },
      mockManager,
    );

    expect(movimientosGuardados[0].potreroOrigenId).toBeNull();
    expect(movimientosGuardados[0].potreroDestinoId).toBe(POTRERO_DESTINO_ID);
    expect(animalSinPotrero.potreroId).toBe(POTRERO_DESTINO_ID);
  });

  it('adversarial: debe rechazar con NotFoundException si el potrero destino no existe o es de otro tenant', async () => {
    const mockManager = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as EntityManager;

    await expect(
      service.asignarAnimales(
        POTRERO_DESTINO_ID,
        TENANT_ID,
        USER_ID,
        { animalIds: ['animal-1'] },
        mockManager,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('adversarial: debe rechazar con BadRequestException si algún animal no existe o pertenece a otro tenant', async () => {
    const potrero = { id: POTRERO_DESTINO_ID, tenantId: TENANT_ID } as Potrero;

    const mockManager = {
      getRepository: vi.fn().mockImplementation((entity) => {
        if (entity === Potrero) {
          return { findOne: vi.fn().mockResolvedValue(potrero) };
        }
        if (entity === Animal) {
          return {
            createQueryBuilder: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnThis(),
              getMany: vi.fn().mockResolvedValue([]), // Ningún animal coincide con el tenant
            }),
          };
        }
        return {};
      }),
    } as unknown as EntityManager;

    await expect(
      service.asignarAnimales(
        POTRERO_DESTINO_ID,
        TENANT_ID,
        USER_ID,
        { animalIds: ['animal-ajeno'] },
        mockManager,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
