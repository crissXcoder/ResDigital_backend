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
