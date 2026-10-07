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

describe('PotrerosService - Separación de Estado Operativo y Carga Derivada (POT-T002)', () => {
  let service: PotrerosService;
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    service = new PotrerosService();
  });

  it('adversarial: un estadoManual de "DISPONIBLE" no debe ocultar la alerta si el potrero está sobrecargado', async () => {
    // 5 vacas (5 UA) en 1 ha con capacidad de 2 UA/ha -> sobrecargado (5 > 2)
    const potreroSobrecargado = {
      id: 'potrero-1',
      tenantId: TENANT_ID,
      nombre: 'Potrero El Alto',
      areaHa: 1,
      capacidadRecomendadaUaHa: 2,
      diasDescansoRecomendados: 30,
      estadoManual: 'DISPONIBLE',
      animales: [
        { id: '1', categoria: 'Vaca' },
        { id: '2', categoria: 'Vaca' },
        { id: '3', categoria: 'Vaca' },
        { id: '4', categoria: 'Vaca' },
        { id: '5', categoria: 'Vaca' },
      ],
    } as unknown as Potrero;

    const mockManager = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(potreroSobrecargado),
      }),
    } as unknown as EntityManager;

    const resultado = await service.findOne('potrero-1', TENANT_ID, mockManager);

    // Verificación de invariantes POT-T002
    expect(resultado.sobrecargado).toBe(true);
    expect(resultado.estadoCarga).toBe('SOBRECARGADO');
    expect(resultado.estadoOperativo).toBe('DISPONIBLE');
    // El label manual no debe ocultar la alerta; estadoCalculado se reporta como SOBRECARGADO
    expect(resultado.estadoCalculado).toBe('SOBRECARGADO');
    expect(resultado.cargaActualUaHa).toBe(5);
  });

  it('calcula estadoCarga como "ÓPTIMO" cuando la carga está dentro de la capacidad recomendada', async () => {
    // 1 vaca (1 UA) en 2 ha con capacidad de 1.5 UA/ha -> carga 0.5 <= 1.5
    const potreroOptimo = {
      id: 'potrero-2',
      tenantId: TENANT_ID,
      nombre: 'Potrero El Valle',
      areaHa: 2,
      capacidadRecomendadaUaHa: 1.5,
      diasDescansoRecomendados: 30,
      estadoManual: null,
      animales: [{ id: '1', categoria: 'Vaca' }],
    } as unknown as Potrero;

    const mockManager = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(potreroOptimo),
      }),
    } as unknown as EntityManager;

    const resultado = await service.findOne('potrero-2', TENANT_ID, mockManager);

    expect(resultado.sobrecargado).toBe(false);
    expect(resultado.estadoCarga).toBe('ÓPTIMO');
    expect(resultado.estadoOperativo).toBe('OCUPADO');
    expect(resultado.estadoCalculado).toBe('OCUPADO');
    expect(resultado.cargaActualUaHa).toBe(0.5);
  });

  it('deriva estadoOperativo como "EN RECUPERACIÓN" si no tiene animales y no ha cumplido el descanso', async () => {
    // Hace 5 días que ingresó / descansando, requiere 30 días
    const fechaReciente = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const potreroEnDescanso = {
      id: 'potrero-3',
      tenantId: TENANT_ID,
      nombre: 'Potrero Descanso',
      areaHa: 5,
      capacidadRecomendadaUaHa: 2,
      diasDescansoRecomendados: 30,
      fechaUltimoIngreso: fechaReciente,
      estadoManual: null,
      animales: [],
    } as unknown as Potrero;

    const mockManager = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(potreroEnDescanso),
      }),
    } as unknown as EntityManager;

    const resultado = await service.findOne('potrero-3', TENANT_ID, mockManager);

    expect(resultado.sobrecargado).toBe(false);
    expect(resultado.estadoCarga).toBe('SIN_CARGA');
    expect(resultado.estadoOperativo).toBe('EN RECUPERACIÓN');
    expect(resultado.estadoCalculado).toBe('EN RECUPERACIÓN');
  });

  it('respeta estadoManual (ej. "EN MANTENIMIENTO") en estadoOperativo cuando no hay sobrecarga', async () => {
    const potreroMantenimiento = {
      id: 'potrero-4',
      tenantId: TENANT_ID,
      nombre: 'Potrero Cercas',
      areaHa: 5,
      capacidadRecomendadaUaHa: 2,
      diasDescansoRecomendados: 30,
      estadoManual: 'EN MANTENIMIENTO',
      animales: [],
    } as unknown as Potrero;

    const mockManager = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(potreroMantenimiento),
      }),
    } as unknown as EntityManager;

    const resultado = await service.findOne('potrero-4', TENANT_ID, mockManager);

    expect(resultado.sobrecargado).toBe(false);
    expect(resultado.estadoCarga).toBe('SIN_CARGA');
    expect(resultado.estadoOperativo).toBe('EN MANTENIMIENTO');
    expect(resultado.estadoCalculado).toBe('EN MANTENIMIENTO');
  });
});

describe('PotrerosService - Cálculo UA Configurable (POT-T003)', () => {
  let service: PotrerosService;
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    service = new PotrerosService();
  });

  it('calcula UA explícitas para cada una de las 7 categorías oficiales sin peso registrado', async () => {
    // Toro: 1.25, Vaca: 1.0, Novillo mayor: 0.8, Novilla: 0.7, Novillo: 0.6, Ternera: 0.35, Ternero: 0.35
    // Suma esperada = 1.25 + 1.0 + 0.8 + 0.7 + 0.6 + 0.35 + 0.35 = 5.05 UA
    const potreroCategorias = {
      id: 'potrero-cat',
      tenantId: TENANT_ID,
      nombre: 'Potrero Variado',
      areaHa: 10,
      capacidadRecomendadaUaHa: 1.5,
      animales: [
        { id: '1', categoria: 'Toro', pesoActualKg: null },
        { id: '2', categoria: 'Vaca', pesoActualKg: null },
        { id: '3', categoria: 'Novillo mayor', pesoActualKg: null },
        { id: '4', categoria: 'Novilla', pesoActualKg: null },
        { id: '5', categoria: 'Novillo', pesoActualKg: null },
        { id: '6', categoria: 'Ternera', pesoActualKg: null },
        { id: '7', categoria: 'Ternero', pesoActualKg: null },
      ],
    } as unknown as Potrero;

    const mockManager = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(potreroCategorias),
      }),
    } as unknown as EntityManager;

    const resultado = await service.findOne('potrero-cat', TENANT_ID, mockManager);

    expect(resultado.uaTotal).toBe(5.05);
    expect(resultado.desgloseUa).toEqual({
      porPeso: 0,
      porCategoria: 5.05,
      total: 5.05,
    });
    // 5.05 UA en 10 ha = 0.51 UA/ha
    expect(resultado.cargaActualUaHa).toBe(0.51);
    expect(resultado.sobrecargado).toBe(false);
    expect(resultado.estadoCarga).toBe('ÓPTIMO');

    // Cada animal enriquecido con su UA calculada y método
    const toro = resultado.animales?.find((a) => a.id === '1');
    expect(toro).toMatchObject({ uaCalculada: 1.25, metodoCalculoUa: 'CATEGORIA' });

    const ternero = resultado.animales?.find((a) => a.id === '7');
    expect(ternero).toMatchObject({ uaCalculada: 0.35, metodoCalculoUa: 'CATEGORIA' });
  });

  it('calcula UA por biomasa real (pesoActualKg / 450) cuando el animal tiene peso registrado', async () => {
    // 1 toro de 585 kg -> 585 / 450 = 1.30 UA
    // 1 novillo de 450 kg -> 450 / 450 = 1.00 UA
    // 1 ternero de 225 kg -> 225 / 450 = 0.50 UA
    // Suma esperada = 2.80 UA
    const potreroPesos = {
      id: 'potrero-pesos',
      tenantId: TENANT_ID,
      nombre: 'Potrero Balanza',
      areaHa: 2,
      capacidadRecomendadaUaHa: 2.0,
      animales: [
        { id: 't1', categoria: 'Toro', pesoActualKg: 585 },
        { id: 'n1', categoria: 'Novillo', pesoActualKg: 450 },
        { id: 'c1', categoria: 'Ternero', pesoActualKg: 225 },
      ],
    } as unknown as Potrero;

    const mockManager = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(potreroPesos),
      }),
    } as unknown as EntityManager;

    const resultado = await service.findOne('potrero-pesos', TENANT_ID, mockManager);

    expect(resultado.uaTotal).toBe(2.8);
    expect(resultado.desgloseUa).toEqual({
      porPeso: 2.8,
      porCategoria: 0,
      total: 2.8,
    });
    // 2.8 UA / 2 ha = 1.4 UA/ha
    expect(resultado.cargaActualUaHa).toBe(1.4);

    const animal1 = resultado.animales?.find((a) => a.id === 't1');
    expect(animal1).toMatchObject({ uaCalculada: 1.3, metodoCalculoUa: 'PESO' });

    const animal3 = resultado.animales?.find((a) => a.id === 'c1');
    expect(animal3).toMatchObject({ uaCalculada: 0.5, metodoCalculoUa: 'PESO' });
  });

  it('soporta cálculo híbrido combinando animales pesados y sin pesar en el mismo potrero', async () => {
    // Animal 1: Vaca pesada de 540 kg -> 540 / 450 = 1.20 UA (PESO)
    // Animal 2: Vaca sin peso registrado -> 1.00 UA (CATEGORIA)
    // Total = 2.20 UA
    const potreroHibrido = {
      id: 'potrero-hib',
      tenantId: TENANT_ID,
      nombre: 'Potrero Híbrido',
      areaHa: 1,
      capacidadRecomendadaUaHa: 2.0,
      animales: [
        { id: 'v1', categoria: 'Vaca', pesoActualKg: 540 },
        { id: 'v2', categoria: 'Vaca', pesoActualKg: null },
      ],
    } as unknown as Potrero;

    const mockManager = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(potreroHibrido),
      }),
    } as unknown as EntityManager;

    const resultado = await service.findOne('potrero-hib', TENANT_ID, mockManager);

    expect(resultado.uaTotal).toBe(2.2);
    expect(resultado.desgloseUa).toEqual({
      porPeso: 1.2,
      porCategoria: 1.0,
      total: 2.2,
    });
    // 2.2 UA en 1 ha > 2.0 capacidad -> sobrecargado
    expect(resultado.sobrecargado).toBe(true);
    expect(resultado.estadoCarga).toBe('SOBRECARGADO');
    expect(resultado.estadoCalculado).toBe('SOBRECARGADO');
  });

  it('adversarial: pesos nulos, negativos, cero o mayores a 2000kg hacen fallback a categoría', async () => {
    const potreroAdversarial = {
      id: 'potrero-adv',
      tenantId: TENANT_ID,
      nombre: 'Potrero Defensivo',
      areaHa: 5,
      capacidadRecomendadaUaHa: 1.5,
      animales: [
        { id: 'p0', categoria: 'Vaca', pesoActualKg: 0 }, // Cero -> fallback Vaca (1.0)
        { id: 'pNeg', categoria: 'Toro', pesoActualKg: -200 }, // Negativo -> fallback Toro (1.25)
        { id: 'pAbsurdo', categoria: 'Novilla', pesoActualKg: 99999 }, // Fuera de rango -> fallback Novilla (0.7)
      ],
    } as unknown as Potrero;

    const mockManager = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(potreroAdversarial),
      }),
    } as unknown as EntityManager;

    const resultado = await service.findOne('potrero-adv', TENANT_ID, mockManager);

    // Suma esperada = 1.0 + 1.25 + 0.7 = 2.95 UA
    expect(resultado.uaTotal).toBe(2.95);
    expect(resultado.desgloseUa?.porCategoria).toBe(2.95);
    expect(resultado.desgloseUa?.porPeso).toBe(0);

    const a0 = resultado.animales?.find((a) => a.id === 'p0');
    expect(a0).toMatchObject({ uaCalculada: 1.0, metodoCalculoUa: 'CATEGORIA' });

    const aNeg = resultado.animales?.find((a) => a.id === 'pNeg');
    expect(aNeg).toMatchObject({ uaCalculada: 1.25, metodoCalculoUa: 'CATEGORIA' });

    const aAbs = resultado.animales?.find((a) => a.id === 'pAbsurdo');
    expect(aAbs).toMatchObject({ uaCalculada: 0.7, metodoCalculoUa: 'CATEGORIA' });
  });

  it('adversarial: categorías desconocidas o no catalogadas usan fallback seguro de 0.50 UA', async () => {
    const potreroDesconocido = {
      id: 'potrero-desc',
      tenantId: TENANT_ID,
      nombre: 'Potrero Desconocido',
      areaHa: 2,
      capacidadRecomendadaUaHa: 1.0,
      animales: [
        { id: 'x1', categoria: 'Bufalo', pesoActualKg: null },
        { id: 'x2', categoria: null, pesoActualKg: null },
      ],
    } as unknown as Potrero;

    const mockManager = {
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(potreroDesconocido),
      }),
    } as unknown as EntityManager;

    const resultado = await service.findOne('potrero-desc', TENANT_ID, mockManager);

    // Fallback: 0.5 + 0.5 = 1.0 UA
    expect(resultado.uaTotal).toBe(1.0);
    expect(resultado.animales?.[0]).toMatchObject({ uaCalculada: 0.5, metodoCalculoUa: 'CATEGORIA' });
    expect(resultado.animales?.[1]).toMatchObject({ uaCalculada: 0.5, metodoCalculoUa: 'CATEGORIA' });
  });
});

