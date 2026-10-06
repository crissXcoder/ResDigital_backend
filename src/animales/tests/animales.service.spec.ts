import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityManager } from 'typeorm';
import { AnimalesService } from '../animales.service.js';
import { Animal } from '../entities/animal.entity.js';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentoAnimal } from '../entities/documento-animal.entity.js';

describe('AnimalesService - findAll y Búsqueda Global (DASH-T002)', () => {
  let service: AnimalesService;
  let mockEntityManager: EntityManager;
  let mockQueryBuilder: any;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';

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

  describe('createDocumento', () => {
    const ANIMAL_ID = '22222222-2222-4222-8222-222222222222';
    const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
    const validPath = `${TENANT_A}/${ANIMAL_ID}/vacuna-aftosa/${DOCUMENT_ID}.pdf`;

    beforeEach(() => {
      vi.mocked(mockEntityManager.findOne).mockResolvedValue({
        id: ANIMAL_ID,
        tenantId: TENANT_A,
      } as Animal);
      vi.mocked(mockEntityManager.create).mockImplementation((_entity, value) => value as never);
      vi.mocked(mockEntityManager.save).mockImplementation(async (value) => value as never);
    });

    it('persists a canonical path scoped to the requested tenant and animal', async () => {
      const result = await service.createDocumento(
        ANIMAL_ID,
        TENANT_A,
        { tipo: 'Vacuna Aftosa', objectPath: validPath },
        mockEntityManager,
      );

      expect(mockEntityManager.create).toHaveBeenCalledWith(DocumentoAnimal, {
        tenantId: TENANT_A,
        animalId: ANIMAL_ID,
        tipo: 'Vacuna Aftosa',
        objectPath: validPath,
        archivoUrl: null,
      });
      expect(result).toMatchObject({ objectPath: validPath, archivoUrl: null });
    });

    it('rejects a path for another animal with the same tenant', async () => {
      const otherAnimalId = '55555555-5555-4555-8555-555555555555';
      const path = `${TENANT_A}/${otherAnimalId}/vacuna-aftosa/${DOCUMENT_ID}.pdf`;

      await expect(
        service.createDocumento(
          ANIMAL_ID,
          TENANT_A,
          { tipo: 'Vacuna Aftosa', objectPath: path },
          mockEntityManager,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });

    it('rejects a canonical path from another tenant', async () => {
      const otherTenantPath = `44444444-4444-4444-8444-444444444444/${ANIMAL_ID}/vacuna-aftosa/${DOCUMENT_ID}.pdf`;

      await expect(
        service.createDocumento(
          ANIMAL_ID,
          TENANT_A,
          { tipo: 'Vacuna Aftosa', objectPath: otherTenantPath },
          mockEntityManager,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });

    it('does not persist a path outside the canonical shape', async () => {
      await expect(
        service.createDocumento(
          ANIMAL_ID,
          TENANT_A,
          { tipo: 'Vacuna Aftosa', objectPath: `${validPath}/extra` },
          mockEntityManager,
        ),
      ).rejects.toThrow('La ruta del documento no es válida.');
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });

    it('does not create a document when the requested animal does not exist', async () => {
      vi.mocked(mockEntityManager.findOne).mockResolvedValue(null);

      await expect(
        service.createDocumento(
          ANIMAL_ID,
          TENANT_A,
          { tipo: 'Vacuna Aftosa', objectPath: validPath },
          mockEntityManager,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });
  });
});
