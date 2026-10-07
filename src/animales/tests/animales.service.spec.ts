import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityManager } from 'typeorm';
import { AnimalesService } from '../animales.service.js';
import { Animal } from '../entities/animal.entity.js';
import { ConflictException, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Evento } from '../../eventos/entities/evento.entity.js';
import { EventoBaja } from '../entities/evento-baja.entity.js';
import { DocumentoAnimal } from '../entities/documento-animal.entity.js';
import { AnimalDocumentStorageService } from '../animal-document-storage.service.js';
import { runAfterRollbackCallbacks } from '../../auth/interceptors/rls-transaction.interceptor.js';

describe('AnimalesService - findAll y Búsqueda Global (DASH-T002)', () => {
  let service: AnimalesService;
  let mockEntityManager: EntityManager;
  let mockQueryBuilder: any;
  let documentStorage: Pick<AnimalDocumentStorageService, 'validateObject' | 'removeObject'>;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    documentStorage = {
      validateObject: vi.fn().mockResolvedValue(undefined),
      removeObject: vi.fn().mockResolvedValue(undefined),
    };
    service = new AnimalesService(documentStorage as AnimalDocumentStorageService);

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
      query: vi.fn().mockResolvedValue([]),
      queryRunner: { isTransactionActive: true, data: {} },
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
      expect(documentStorage.validateObject).toHaveBeenCalledWith(validPath);
    });

    it('does not register a path already referenced by another document row', async () => {
      vi.mocked(mockEntityManager.query)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: DOCUMENT_ID }]);

      await expect(
        service.createDocumento(
          ANIMAL_ID,
          TENANT_A,
          { tipo: 'Vacuna Aftosa', objectPath: validPath },
          mockEntityManager,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(documentStorage.validateObject).not.toHaveBeenCalled();
      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });

    it('removes the verified object after the document insert transaction rolls back', async () => {
      vi.mocked(mockEntityManager.save).mockRejectedValueOnce(
        new Error('simulated document insert failure'),
      );

      await expect(
        service.createDocumento(
          ANIMAL_ID,
          TENANT_A,
          { tipo: 'Vacuna Aftosa', objectPath: validPath },
          mockEntityManager,
        ),
      ).rejects.toThrow('simulated document insert failure');
      expect(documentStorage.removeObject).not.toHaveBeenCalled();

      const queryRunner = mockEntityManager.queryRunner!;
      await runAfterRollbackCallbacks(queryRunner);
      expect(documentStorage.removeObject).toHaveBeenCalledWith(validPath);
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
      expect(documentStorage.validateObject).not.toHaveBeenCalled();
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
      expect(documentStorage.validateObject).not.toHaveBeenCalled();
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
      expect(documentStorage.validateObject).not.toHaveBeenCalled();
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
      expect(documentStorage.validateObject).not.toHaveBeenCalled();
    });
  });
});

describe('AnimalesService - Unicidad y Normalización DIIO (HATO-T002)', () => {
  let service: AnimalesService;
  let mockEntityManager: EntityManager;

  const TENANT_A = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    service = new AnimalesService({
      validateObject: vi.fn().mockResolvedValue(undefined),
      removeObject: vi.fn().mockResolvedValue(undefined),
    } as any);

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

describe('AnimalesService - Validaciones Genealógicas (HATO-T003)', () => {
  let service: AnimalesService;
  let mockEntityManager: EntityManager;

  const TENANT_A = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    service = new AnimalesService({
      validateObject: vi.fn().mockResolvedValue(undefined),
      removeObject: vi.fn().mockResolvedValue(undefined),
    } as any);

    mockEntityManager = {
      findOne: vi.fn(),
      find: vi.fn(),
      create: vi.fn().mockImplementation((_entity, data) => ({ ...data, id: 'nuevo-id' })),
      save: vi.fn().mockImplementation(async (data) => data),
      merge: vi.fn().mockImplementation((_entity, target, source) => Object.assign(target, source)),
    } as unknown as EntityManager;
  });

  it('rechaza create si madreId apunta a un animal que es Macho', async () => {
    vi.mocked(mockEntityManager.findOne).mockImplementation(async (_entity: any, options: any) => {
      if (options?.where?.id === 'macho-equivocado-id') {
        return { id: 'macho-equivocado-id', sexo: 'Macho', tenantId: TENANT_A } as Animal;
      }
      return null;
    });

    const dto: any = {
      nombre: 'Ternera 1',
      areteInterno: 'T001',
      sexo: 'Hembra',
      razaId: 'raza-1',
      categoria: 'Ternera',
      madreId: 'macho-equivocado-id',
    };

    await expect(
      service.create(TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError('La madre especificada debe ser de sexo Hembra.');
  });

  it('rechaza create si padreId apunta a un animal que es Hembra', async () => {
    vi.mocked(mockEntityManager.findOne).mockImplementation(async (_entity: any, options: any) => {
      if (options?.where?.id === 'hembra-equivocada-id') {
        return { id: 'hembra-equivocada-id', sexo: 'Hembra', tenantId: TENANT_A } as Animal;
      }
      return null;
    });

    const dto: any = {
      nombre: 'Ternero 2',
      areteInterno: 'T002',
      sexo: 'Macho',
      razaId: 'raza-1',
      categoria: 'Ternero',
      padreId: 'hembra-equivocada-id',
    };

    await expect(
      service.create(TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError('El padre especificado debe ser de sexo Macho.');
  });

  it('aislamiento multi-tenant: rechaza si la madre pertenece a otra finca o no existe', async () => {
    vi.mocked(mockEntityManager.findOne).mockResolvedValue(null);

    const dto: any = {
      nombre: 'Ternera 3',
      areteInterno: 'T003',
      sexo: 'Hembra',
      razaId: 'raza-1',
      categoria: 'Ternera',
      madreId: 'madre-de-otra-finca',
    };

    await expect(
      service.create(TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError('La vaca madre especificada no existe en esta finca.');
  });

  it('aislamiento multi-tenant: rechaza si el padre pertenece a otra finca o no existe', async () => {
    vi.mocked(mockEntityManager.findOne).mockResolvedValue(null);

    const dto: any = {
      nombre: 'Ternero 4',
      areteInterno: 'T004',
      sexo: 'Macho',
      razaId: 'raza-1',
      categoria: 'Ternero',
      padreId: 'padre-de-otra-finca',
    };

    await expect(
      service.create(TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError('El toro padre especificado no existe en esta finca.');
  });

  it('rechaza update si madreId es igual al ID del propio animal (auto-parentesco)', async () => {
    const animalActual = {
      id: 'animal-100',
      tenantId: TENANT_A,
      areteInterno: 'A100',
      sexo: 'Hembra',
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValueOnce(animalActual);

    const dto: any = {
      madreId: 'animal-100',
    };

    await expect(
      service.update('animal-100', TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError('Un animal no puede ser su propia madre.');
  });

  it('rechaza update si padreId es igual al ID del propio animal (auto-parentesco)', async () => {
    const animalActual = {
      id: 'animal-200',
      tenantId: TENANT_A,
      areteInterno: 'A200',
      sexo: 'Macho',
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValueOnce(animalActual);

    const dto: any = {
      padreId: 'animal-200',
    };

    await expect(
      service.update('animal-200', TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError('Un animal no puede ser su propio padre.');
  });

  it('rechaza update si se crea un ciclo genealógico directo (padre/hijo invertido)', async () => {
    // Animal A (Toro Padre original)
    const toroA = {
      id: 'toro-A',
      tenantId: TENANT_A,
      areteInterno: 'A01',
      sexo: 'Macho',
    } as Animal;

    // Animal B (Hijo de Toro A)
    const hijoB = {
      id: 'hijo-B',
      tenantId: TENANT_A,
      areteInterno: 'B01',
      sexo: 'Macho',
      padreId: 'toro-A',
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockImplementation(async (_entity: any, options: any) => {
      const id = options?.where?.id;
      if (id === 'toro-A') return toroA;
      if (id === 'hijo-B') return hijoB;
      return null;
    });

    // Intentamos actualizar toro-A para que su padre sea su propio hijo hijo-B
    const dto: any = {
      padreId: 'hijo-B',
    };

    await expect(
      service.update('toro-A', TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError(
      'No se puede asignar como padre a un descendiente del animal (ciclo genealógico detectado).',
    );
  });

  it('rechaza update si se crea un ciclo genealógico indirecto (abuelo a nieto)', async () => {
    // Toro A es padre de Vaca B. Vaca B es madre de Ternera C.
    const toroA = {
      id: 'toro-A',
      tenantId: TENANT_A,
      areteInterno: 'A01',
      sexo: 'Macho',
    } as Animal;

    const vacaB = {
      id: 'vaca-B',
      tenantId: TENANT_A,
      areteInterno: 'B01',
      sexo: 'Hembra',
      padreId: 'toro-A',
    } as Animal;

    const terneraC = {
      id: 'ternera-C',
      tenantId: TENANT_A,
      areteInterno: 'C01',
      sexo: 'Hembra',
      madreId: 'vaca-B',
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockImplementation(async (_entity: any, options: any) => {
      const id = options?.where?.id;
      if (id === 'toro-A') return toroA;
      if (id === 'vaca-B') return vacaB;
      if (id === 'ternera-C') return terneraC;
      return null;
    });

    // Intentamos asignar a la nieta ternera-C como madre de su abuelo toro-A
    const dto: any = {
      madreId: 'ternera-C',
    };

    await expect(
      service.update('toro-A', TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError(
      'No se puede asignar como madre a un descendiente del animal (ciclo genealógico detectado).',
    );
  });

  it('permite create y update con madre Hembra y padre Macho válidos del mismo tenant', async () => {
    const madre = {
      id: 'vaca-valida',
      tenantId: TENANT_A,
      areteInterno: 'V10',
      sexo: 'Hembra',
    } as Animal;

    const padre = {
      id: 'toro-valido',
      tenantId: TENANT_A,
      areteInterno: 'T20',
      sexo: 'Macho',
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockImplementation(async (_entity: any, options: any) => {
      const id = options?.where?.id;
      if (id === 'vaca-valida') return madre;
      if (id === 'toro-valido') return padre;
      return null;
    });

    const createDto: any = {
      nombre: 'Cría Exitosa',
      areteInterno: 'CR01',
      sexo: 'Hembra',
      razaId: 'raza-uuid',
      categoria: 'Ternera',
      madreId: 'vaca-valida',
      padreId: 'toro-valido',
    };

    const resultado = await service.create(TENANT_A, createDto, mockEntityManager);

    expect(resultado).toBeDefined();
    expect(mockEntityManager.save).toHaveBeenCalled();
  });
});

describe('AnimalesService - Validaciones de Cronología (HATO-T004)', () => {
  let service: AnimalesService;
  let mockEntityManager: EntityManager;
  const TENANT_A = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    service = new AnimalesService({
      validateObject: vi.fn().mockResolvedValue(undefined),
      removeObject: vi.fn().mockResolvedValue(undefined),
    } as any);
    mockEntityManager = {
      findOne: vi.fn(),
      find: vi.fn(),
      create: vi.fn((_entity, val) => val),
      save: vi.fn((val) => Promise.resolve(val)),
      merge: vi.fn((_entity, dest, src) => Object.assign(dest, src)),
      getRepository: vi.fn().mockReturnValue({
        create: vi.fn((val) => val),
        save: vi.fn((val) => Promise.resolve({ id: 'mock-id-evento', ...val })),
      }),
    } as unknown as EntityManager;
  });

  it('create: rechaza fechaCompra anterior a fechaNacimiento', async () => {
    const dto: any = {
      nombre: 'Anacrónica',
      areteInterno: '101',
      sexo: 'Hembra',
      razaId: 'r1',
      categoria: 'Vaca',
      fechaNacimiento: '2024-05-10',
      fechaCompra: '2024-05-01', // Antes de nacer
    };

    await expect(
      service.create(TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError(
      'La fecha de compra no puede ser anterior a la fecha de nacimiento del animal.',
    );
  });

  it('create: permite fechaCompra igual o posterior a fechaNacimiento', async () => {
    vi.mocked(mockEntityManager.findOne).mockResolvedValue(null);

    const dto: any = {
      nombre: 'Correcta',
      areteInterno: '102',
      sexo: 'Hembra',
      razaId: 'r1',
      categoria: 'Vaca',
      fechaNacimiento: '2024-05-10',
      fechaCompra: '2024-06-01',
    };

    const result = await service.create(TENANT_A, dto, mockEntityManager);
    expect(result).toBeDefined();
    expect(mockEntityManager.save).toHaveBeenCalled();
  });

  it('update: rechaza fechaCompra anterior a la fechaNacimiento existente', async () => {
    const animalExistente = {
      id: 'a1',
      tenantId: TENANT_A,
      areteInterno: '101',
      fechaNacimiento: '2024-05-10',
      fechaCompra: null,
      activo: true,
    } as unknown as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValue(animalExistente);

    const dto: any = {
      fechaCompra: '2024-01-01', // Anterior al nacimiento preexistente
    };

    await expect(
      service.update('a1', TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError(
      'La fecha de compra no puede ser anterior a la fecha de nacimiento del animal.',
    );
  });

  it('update: rechaza actualizar fechaNacimiento posterior a fechaBaja registrada', async () => {
    const animalDeBaja = {
      id: 'a2',
      tenantId: TENANT_A,
      areteInterno: '102',
      fechaNacimiento: '2023-01-01',
      fechaBaja: '2025-01-01',
      activo: false,
    } as unknown as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValue(animalDeBaja);

    const dto: any = {
      fechaNacimiento: '2025-06-01', // Posterior a la baja
    };

    await expect(
      service.update('a2', TENANT_A, dto, mockEntityManager),
    ).rejects.toThrowError(
      'La fecha de nacimiento no puede ser posterior a la fecha de baja del animal.',
    );
  });

  it('darDeBaja: rechaza fechaBaja anterior a fechaNacimiento', async () => {
    const animal = {
      id: 'a3',
      tenantId: TENANT_A,
      areteInterno: '103',
      fechaNacimiento: '2024-01-01',
      fechaCompra: null,
      activo: true,
    } as unknown as Animal;


    vi.mocked(mockEntityManager.findOne).mockResolvedValue(animal);

    const bajaDto: any = {
      tipoBaja: 'Venta Comercial',
      fechaBaja: '2023-12-31', // Antes de nacer
    };

    await expect(
      service.darDeBaja('a3', TENANT_A, bajaDto, mockEntityManager),
    ).rejects.toThrowError(
      'La fecha de baja no puede ser anterior a la fecha de nacimiento del animal.',
    );
  });

  it('darDeBaja: rechaza fechaBaja anterior a fechaCompra', async () => {
    const animal = {
      id: 'a4',
      tenantId: TENANT_A,
      areteInterno: '104',
      fechaNacimiento: '2023-01-01',
      fechaCompra: '2024-05-01',
      activo: true,
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValue(animal);

    const bajaDto: any = {
      tipoBaja: 'Descarte',
      fechaBaja: '2024-04-01', // Antes de comprarlo
    };

    await expect(
      service.darDeBaja('a4', TENANT_A, bajaDto, mockEntityManager),
    ).rejects.toThrowError(
      'La fecha de baja no puede ser anterior a la fecha de compra del animal.',
    );
  });

  it('darDeBaja: procede exitosamente si fechaBaja es coherente', async () => {
    const animal = {
      id: 'a5',
      tenantId: TENANT_A,
      areteInterno: '105',
      fechaNacimiento: '2023-01-01',
      fechaCompra: '2024-01-01',
      activo: true,
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValue(animal);

    const bajaDto: any = {
      tipoBaja: 'Venta Comercial',
      fechaBaja: '2025-01-01',
      precioVentaCrc: 500000,
      pesoFinalKg: 520,
    };

    const res = await service.darDeBaja('a5', TENANT_A, bajaDto, mockEntityManager);
    expect(res.activo).toBe(false);
    expect(res.tipoBaja).toBe('Venta Comercial');
    expect(mockEntityManager.save).toHaveBeenCalled();
  });
});

describe('AnimalesService - Baja como Evento Histórico (HATO-T005)', () => {
  let service: AnimalesService;
  let mockEntityManager: EntityManager;
  let mockRepoEvento: any;
  let mockRepoEventoBaja: any;
  let eventosGuardados: any[];
  let eventosBajaGuardados: any[];

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const ACTOR_USER_ID = '99999999-9999-9999-9999-999999999999';

  beforeEach(() => {
    service = new AnimalesService({
      validateObject: vi.fn().mockResolvedValue(undefined),
      removeObject: vi.fn().mockResolvedValue(undefined),
    } as any);

    eventosGuardados = [];
    eventosBajaGuardados = [];

    mockRepoEvento = {
      create: vi.fn((dto) => ({ id: 'evt-uuid-1', ...dto })),
      save: vi.fn((evt) => {
        eventosGuardados.push(evt);
        return Promise.resolve(evt);
      }),
    };

    mockRepoEventoBaja = {
      create: vi.fn((dto) => ({ ...dto })),
      save: vi.fn((eb) => {
        eventosBajaGuardados.push(eb);
        return Promise.resolve(eb);
      }),
    };

    mockEntityManager = {
      findOne: vi.fn(),
      save: vi.fn((val) => Promise.resolve(val)),
      getRepository: vi.fn((entity: any) => {
        if (entity === Evento) return mockRepoEvento;
        if (entity === EventoBaja) return mockRepoEventoBaja;
        return {
          create: vi.fn((v) => v),
          save: vi.fn((v) => Promise.resolve(v)),
        };
      }),
    } as unknown as EntityManager;
  });

  it('darDeBaja: persiste Evento y EventoBaja, libera potrero y registra usuarioId del actor', async () => {
    const animal = {
      id: 'animal-uuid-1',
      tenantId: TENANT_A,
      areteInterno: '1001',
      fechaNacimiento: '2023-01-01',
      fechaCompra: null,
      potreroId: 'potrero-uuid-9',
      activo: true,
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValue(animal);

    const bajaDto: any = {
      tipoBaja: 'Venta Comercial',
      motivoBaja: 'Venta a subasta ganadera',
      fechaBaja: '2026-03-15',
      precioVentaCrc: 850000,
      pesoFinalKg: 480.5,
    };

    const resultado = await service.darDeBaja(
      'animal-uuid-1',
      TENANT_A,
      bajaDto,
      mockEntityManager,
      ACTOR_USER_ID,
    );

    // 1. Animal actualizado: inactivo y potrero liberado
    expect(resultado.activo).toBe(false);
    expect(resultado.potreroId).toBeNull();
    expect(resultado.tipoBaja).toBe('Venta Comercial');
    expect(resultado.motivoBaja).toBe('Venta a subasta ganadera');
    expect(resultado.fechaBaja).toBe('2026-03-15');
    expect(resultado.precioVentaCrc).toBe(850000);
    expect(resultado.pesoFinalKg).toBe(480.5);

    // 2. Evento base inmutable
    expect(eventosGuardados).toHaveLength(1);
    expect(eventosGuardados[0]).toMatchObject({
      tenantId: TENANT_A,
      animalId: 'animal-uuid-1',
      tipo: 'BAJA',
      fechaEvento: '2026-03-15',
      usuarioId: ACTOR_USER_ID,
      notas: 'Venta a subasta ganadera',
    });

    // 3. Detalle inmutable en evento_baja
    expect(eventosBajaGuardados).toHaveLength(1);
    expect(eventosBajaGuardados[0]).toMatchObject({
      eventoId: 'evt-uuid-1',
      tipoBaja: 'Venta Comercial',
      motivo: 'Venta a subasta ganadera',
      precioVentaCrc: 850000,
      pesoFinalKg: 480.5,
    });
  });

  it('darDeBaja: rechaza dar de baja a un animal ya inactivo con ConflictException (409)', async () => {
    const animalYaBaja = {
      id: 'animal-inactivo',
      tenantId: TENANT_A,
      areteInterno: '1002',
      activo: false,
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValue(animalYaBaja);

    const bajaDto: any = {
      tipoBaja: 'Descarte',
      fechaBaja: '2026-03-15',
    };

    await expect(
      service.darDeBaja('animal-inactivo', TENANT_A, bajaDto, mockEntityManager),
    ).rejects.toThrowError(ConflictException);

    expect(eventosGuardados).toHaveLength(0);
    expect(eventosBajaGuardados).toHaveLength(0);
  });

  it('darDeBaja: valida que la fechaBaja no sea previa a nacimiento o compra', async () => {
    const animal = {
      id: 'animal-103',
      tenantId: TENANT_A,
      fechaNacimiento: '2024-01-01',
      fechaCompra: '2024-06-01',
      activo: true,
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValue(animal);

    // Antes de nacer
    await expect(
      service.darDeBaja(
        'animal-103',
        TENANT_A,
        { tipoBaja: 'Fallecimiento', fechaBaja: '2023-12-31' } as any,
        mockEntityManager,
      ),
    ).rejects.toThrowError(BadRequestException);

    // Antes de comprar
    await expect(
      service.darDeBaja(
        'animal-103',
        TENANT_A,
        { tipoBaja: 'Fallecimiento', fechaBaja: '2024-03-01' } as any,
        mockEntityManager,
      ),
    ).rejects.toThrowError(BadRequestException);
  });

  it('getBajaByAnimal: retorna el evento histórico si existe', async () => {
    const animal = {
      id: 'animal-uuid-1',
      tenantId: TENANT_A,
      activo: false,
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValue(animal);

    const mockQueryBuilder = {
      innerJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({
        eventoId: 'evt-uuid-1',
        tipoBaja: 'Venta Comercial',
        motivo: 'Venta realizada',
        precioVentaCrc: 600000,
        pesoFinalKg: 490,
        evento: {
          fechaEvento: '2026-03-10',
          fechaRegistro: new Date('2026-03-10T14:00:00Z'),
          usuarioId: ACTOR_USER_ID,
        },
      }),
    };

    (mockEntityManager.getRepository as any) = vi.fn().mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue(mockQueryBuilder),
    });

    const res = await service.getBajaByAnimal('animal-uuid-1', TENANT_A, mockEntityManager);

    expect(res).toEqual({
      eventoId: 'evt-uuid-1',
      tipoBaja: 'Venta Comercial',
      motivo: 'Venta realizada',
      fechaBaja: '2026-03-10',
      fechaRegistro: new Date('2026-03-10T14:00:00Z'),
      precioVentaCrc: 600000,
      pesoFinalKg: 490,
      usuarioId: ACTOR_USER_ID,
    });
  });

  it('getBajaByAnimal: retorna fallback de campos en animal si no existe evento histórico aún', async () => {
    const animal = {
      id: 'animal-historico',
      tenantId: TENANT_A,
      activo: false,
      tipoBaja: 'Fallecimiento',
      motivoBaja: 'Causas naturales',
      fechaBaja: '2025-05-01',
      precioVentaCrc: null,
      pesoFinalKg: 400,
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValue(animal);

    const mockQueryBuilder = {
      innerJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };

    (mockEntityManager.getRepository as any) = vi.fn().mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue(mockQueryBuilder),
    });

    const res = await service.getBajaByAnimal('animal-historico', TENANT_A, mockEntityManager);

    expect(res).toEqual({
      eventoId: null,
      tipoBaja: 'Fallecimiento',
      motivo: 'Causas naturales',
      fechaBaja: '2025-05-01',
      precioVentaCrc: null,
      pesoFinalKg: 400,
      usuarioId: null,
    });
  });

  it('getBajaByAnimal: lanza NotFoundException si el animal está activo y no tiene baja', async () => {
    const animalActivo = {
      id: 'animal-activo',
      tenantId: TENANT_A,
      activo: true,
    } as Animal;

    vi.mocked(mockEntityManager.findOne).mockResolvedValue(animalActivo);

    const mockQueryBuilder = {
      innerJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };

    (mockEntityManager.getRepository as any) = vi.fn().mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue(mockQueryBuilder),
    });

    await expect(
      service.getBajaByAnimal('animal-activo', TENANT_A, mockEntityManager),
    ).rejects.toThrowError(NotFoundException);
  });
});
