import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityManager } from 'typeorm';
import { AnimalesService } from '../animales.service.js';
import { Animal } from '../entities/animal.entity.js';

describe('AnimalesService - findAll y Búsqueda Global (DASH-T002)', () => {
  let service: AnimalesService;
  let mockEntityManager: EntityManager;
  let mockQueryBuilder: any;

  const TENANT_A = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    service = new AnimalesService();

    mockQueryBuilder = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };

    mockEntityManager = {
      createQueryBuilder: vi.fn().mockReturnValue(mockQueryBuilder),
      findOne: vi.fn(),
      find: vi.fn(),
      create: vi.fn(),
      save: vi.fn(),
      merge: vi.fn(),
    } as unknown as EntityManager;
  });

  it('aislamiento de tenant: siempre filtra animal.tenant_id = :tenantId', async () => {
    await service.findAll(TENANT_A, {}, mockEntityManager);

    expect(mockEntityManager.createQueryBuilder).toHaveBeenCalledWith(
      Animal,
      'animal',
    );
    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      'animal.tenant_id = :tenantId',
      { tenantId: TENANT_A },
    );
    expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
      'animal.arete_interno',
      'ASC',
    );
  });

  it('búsqueda global (buscar): filtra por arete, nombre o DIIO con ILIKE', async () => {
    await service.findAll(TENANT_A, { buscar: '104' }, mockEntityManager);

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      '(animal.arete_interno ILIKE :termino OR animal.nombre ILIKE :termino OR animal.numero_oficial_diio ILIKE :termino)',
      { termino: '%104%' },
    );
  });

  it('búsqueda global (buscar): hace trim de espacios en blanco', async () => {
    await service.findAll(
      TENANT_A,
      { buscar: '  Canela  ' },
      mockEntityManager,
    );

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      '(animal.arete_interno ILIKE :termino OR animal.nombre ILIKE :termino OR animal.numero_oficial_diio ILIKE :termino)',
      { termino: '%Canela%' },
    );
  });

  it('búsqueda con string vacío o solo espacios: no agrega condición andWhere de búsqueda', async () => {
    await service.findAll(TENANT_A, { buscar: '   ' }, mockEntityManager);

    expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
  });

  it('permite combinar filtro de activo y búsqueda global', async () => {
    await service.findAll(
      TENANT_A,
      { activo: 'true', buscar: 'CR-001' },
      mockEntityManager,
    );

    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'animal.activo = :activo',
      { activo: true },
    );
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      '(animal.arete_interno ILIKE :termino OR animal.nombre ILIKE :termino OR animal.numero_oficial_diio ILIKE :termino)',
      { termino: '%CR-001%' },
    );
  });
});

describe('AnimalesService - Unicidad y Normalización DIIO (HATO-T002)', () => {
  let service: AnimalesService;
  let mockEntityManager: EntityManager;

  const TENANT_A = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    service = new AnimalesService();

    mockEntityManager = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((_entity, data) => ({ ...data, id: 'nuevo-id' })),
      save: vi.fn().mockImplementation((data) => Promise.resolve(data)),
      merge: vi.fn().mockImplementation((_entity, target, source) => Object.assign(target, source)),
    } as unknown as EntityManager;
  });

  it('normaliza DIIO vacío ("") o espacios a null para permitir múltiples registros sin DIIO', async () => {
    const dto: any = {
      nombre: 'Vaca 1',
      areteInterno: 'A001',
      numeroOficialDiio: '   ',
      sexo: 'Hembra',
      razaId: 'raza-uuid',
      categoria: 'Vaca',
    };

    const resultado = await service.create(TENANT_A, dto, mockEntityManager);

    expect(mockEntityManager.create).toHaveBeenCalledWith(
      Animal,
      expect.objectContaining({
        tenantId: TENANT_A,
        areteInterno: 'A001',
        numeroOficialDiio: null,
      }),
    );
    expect(resultado.numeroOficialDiio).toBeNull();
  });

  it('normaliza DIIO con espacios haciéndole trim', async () => {
    const dto: any = {
      nombre: 'Vaca 2',
      areteInterno: 'A002',
      numeroOficialDiio: '  CR-987654  ',
      sexo: 'Hembra',
      razaId: 'raza-uuid',
      categoria: 'Vaca',
    };

    await service.create(TENANT_A, dto, mockEntityManager);

    expect(mockEntityManager.create).toHaveBeenCalledWith(
      Animal,
      expect.objectContaining({
        numeroOficialDiio: 'CR-987654',
      }),
    );
  });

  it('lanza ConflictException (409) si ya existe un animal con el mismo DIIO en el tenant', async () => {
    vi.mocked(mockEntityManager.findOne).mockImplementation(async (_entity: any, options: any) => {
      if (options?.where?.numeroOficialDiio === 'CR-12345678') {
        return { id: 'animal-existente-uuid' } as Animal;
      }
      return null;
    });

    const dto: any = {
      nombre: 'Toro 1',
      areteInterno: 'T001',
      numeroOficialDiio: 'CR-12345678',
      sexo: 'Macho',
      razaId: 'raza-uuid',
      categoria: 'Toro',
    };

    await expect(
      service.create(TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError(
      'Ya existe un animal registrado con el número oficial DIIO "CR-12345678" en esta finca.',
    );
  });

  it('lanza ConflictException (409) si ya existe un animal con el mismo arete interno en el tenant', async () => {
    vi.mocked(mockEntityManager.findOne).mockImplementation(async (_entity: any, options: any) => {
      if (options?.where?.areteInterno === 'A001') {
        return { id: 'animal-existente-uuid' } as Animal;
      }
      return null;
    });

    const dto: any = {
      nombre: 'Vaca 3',
      areteInterno: 'A001',
      sexo: 'Hembra',
      razaId: 'raza-uuid',
      categoria: 'Vaca',
    };

    await expect(
      service.create(TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError(
      'Ya existe un animal con el arete interno "A001" en esta finca.',
    );
  });

  it('en update: permite conservar el mismo DIIO del propio animal sin dar colisión', async () => {
    const animalActual = {
      id: 'mi-animal-uuid',
      tenantId: TENANT_A,
      areteInterno: 'A005',
      numeroOficialDiio: 'CR-55555',
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValueOnce(animalActual);

    const dto: any = {
      nombre: 'Vaca 5 Modificada',
      numeroOficialDiio: 'CR-55555',
    };

    const resultado = await service.update(
      'mi-animal-uuid',
      TENANT_A,
      dto,
      mockEntityManager,
    );

    expect(resultado).toBeDefined();
    expect(mockEntityManager.save).toHaveBeenCalled();
  });

  it('en update: rechaza con ConflictException si se cambia el DIIO a uno que ya pertenece a otro animal', async () => {
    const animalActual = {
      id: 'mi-animal-uuid',
      tenantId: TENANT_A,
      areteInterno: 'A005',
      numeroOficialDiio: 'CR-55555',
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockImplementation(async (_entity: any, options: any) => {
      if (options?.where?.id === 'mi-animal-uuid') {
        return animalActual;
      }
      if (options?.where?.numeroOficialDiio === 'CR-99999') {
        return { id: 'otro-animal-uuid' } as Animal;
      }
      return null;
    });

    const dto: any = {
      numeroOficialDiio: 'CR-99999',
    };

    await expect(
      service.update('mi-animal-uuid', TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError(
      'Ya existe un animal registrado con el número oficial DIIO "CR-99999" en esta finca.',
    );
  });

  it('permite registrar el mismo DIIO en fincas (tenants) diferentes', async () => {
    const TENANT_B = '22222222-2222-2222-2222-222222222222';

    // En TENANT_A existe CR-777777, pero en TENANT_B no existe
    vi.mocked(mockEntityManager.findOne).mockImplementation(async (_entity: any, options: any) => {
      if (options?.where?.tenantId === TENANT_A && options?.where?.numeroOficialDiio === 'CR-777777') {
        return { id: 'animal-en-tenant-a' } as Animal;
      }
      return null;
    });

    const dto: any = {
      nombre: 'Vaca de Finca B',
      areteInterno: 'B001',
      numeroOficialDiio: 'CR-777777',
      sexo: 'Hembra',
      razaId: 'raza-uuid',
      categoria: 'Vaca',
    };

    const resultado = await service.create(TENANT_B, dto, mockEntityManager);

    expect(resultado).toBeDefined();
    expect(mockEntityManager.create).toHaveBeenCalledWith(
      Animal,
      expect.objectContaining({
        tenantId: TENANT_B,
        numeroOficialDiio: 'CR-777777',
      }),
    );
  });
});


