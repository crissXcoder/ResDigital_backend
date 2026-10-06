import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AnimalDocumentStorageService } from './animal-document-storage.service.js';
import { registerAfterRollbackCallback } from '../auth/interceptors/rls-transaction.interceptor.js';
import { Animal } from './entities/animal.entity.js';
import { DocumentoAnimal } from './entities/documento-animal.entity.js';
import type { CreateAnimalDto } from './dto/create-animal.dto.js';
import type { UpdateAnimalDto } from './dto/update-animal.dto.js';
import type { BajaAnimalDto } from './dto/baja-animal.dto.js';
import {
  ANIMAL_DOCUMENT_OBJECT_PATH_REGEX,
  type CreateDocumentoDto,
} from './dto/create-documento.dto.js';
import type { QueryAnimalDto } from './dto/query-animal.dto.js';

@Injectable()
export class AnimalesService {
  constructor(private readonly documentStorage: AnimalDocumentStorageService) {}

  async findAll(
    tenantId: string,
    query: QueryAnimalDto,
    manager: EntityManager,
  ) {
    const qb = manager
      .createQueryBuilder(Animal, 'animal')
      .leftJoinAndSelect('animal.raza', 'raza')
      .leftJoinAndSelect('animal.potrero', 'potrero')
      .where('animal.tenant_id = :tenantId', { tenantId });

    if (query.activo !== undefined) {
      qb.andWhere('animal.activo = :activo', {
        activo: query.activo === 'true',
      });
    }

    if (query.categoria) {
      qb.andWhere('animal.categoria = :categoria', {
        categoria: query.categoria,
      });
    }

    if (query.arete) {
      qb.andWhere('animal.arete_interno ILIKE :arete', {
        arete: `%${query.arete}%`,
      });
    }

    if (query.buscar && query.buscar.trim()) {
      const termino = `%${query.buscar.trim()}%`;
      qb.andWhere(
        '(animal.arete_interno ILIKE :termino OR animal.nombre ILIKE :termino OR animal.numero_oficial_diio ILIKE :termino)',
        { termino },
      );
    }

    qb.orderBy('animal.arete_interno', 'ASC');

    return qb.getMany();
  }

  async findOne(id: string, tenantId: string, manager: EntityManager) {
    const animal = await manager.findOne(Animal, {
      where: { id, tenantId },
      relations: { raza: true, madre: true, padre: true, potrero: true },
    });

    if (!animal) {
      throw new NotFoundException(`Animal con ID ${id} no encontrado`);
    }

    return animal;
  }

  /**
   * Convierte a null las cadenas vacías de los campos opcionales.
   *
   * El frontend envía `''` en vez de omitir el campo cuando el usuario deja un
   * input en blanco, y Postgres rechaza `''` en columnas uuid, date y numeric.
   */
  private normalizarOpcionales(
    dto: CreateAnimalDto | UpdateAnimalDto,
  ): Record<string, unknown> {
    const CAMPOS_OPCIONALES = [
      'madreId',
      'padreId',
      'pesoActualKg',
      'valorCompraCrc',
      'fechaNacimiento',
      'fechaCompra',
      'potreroId',
      'numeroOficialDiio',
    ];

    const payload: Record<string, unknown> = { ...dto };
    for (const campo of CAMPOS_OPCIONALES) {
      if (payload[campo] === '') {
        payload[campo] = null;
      }
    }

    if (typeof payload.areteInterno === 'string') {
      payload.areteInterno = payload.areteInterno.trim();
    }

    if (typeof payload.numeroOficialDiio === 'string') {
      const trimmed = payload.numeroOficialDiio.trim();
      payload.numeroOficialDiio = trimmed === '' ? null : trimmed;
    }

    return payload;
  }

  async create(
    tenantId: string,
    createAnimalDto: CreateAnimalDto,
    manager: EntityManager,
  ) {
    const normalizado = this.normalizarOpcionales(createAnimalDto);

    if (normalizado.areteInterno) {
      const existenteArete = await manager.findOne(Animal, {
        where: {
          tenantId,
          areteInterno: normalizado.areteInterno as string,
        },
        select: { id: true },
      });
      if (existenteArete) {
        throw new ConflictException(
          `Ya existe un animal con el arete interno "${normalizado.areteInterno}" en esta finca.`,
        );
      }
    }

    if (normalizado.numeroOficialDiio) {
      const existenteDiio = await manager.findOne(Animal, {
        where: {
          tenantId,
          numeroOficialDiio: normalizado.numeroOficialDiio as string,
        },
        select: { id: true },
      });
      if (existenteDiio) {
        throw new ConflictException(
          `Ya existe un animal registrado con el número oficial DIIO "${normalizado.numeroOficialDiio}" en esta finca.`,
        );
      }
    }

    const animal = manager.create(Animal, {
      ...normalizado,
      tenantId,
    });
    return manager.save(animal);
  }

  async update(
    id: string,
    tenantId: string,
    updateAnimalDto: UpdateAnimalDto,
    manager: EntityManager,
  ) {
    const animal = await this.findOne(id, tenantId, manager);
    const normalizado = this.normalizarOpcionales(updateAnimalDto);

    if (
      normalizado.areteInterno &&
      normalizado.areteInterno !== animal.areteInterno
    ) {
      const existenteArete = await manager.findOne(Animal, {
        where: {
          tenantId,
          areteInterno: normalizado.areteInterno as string,
        },
        select: { id: true },
      });
      if (existenteArete && existenteArete.id !== id) {
        throw new ConflictException(
          `Ya existe un animal con el arete interno "${normalizado.areteInterno}" en esta finca.`,
        );
      }
    }

    if (
      normalizado.numeroOficialDiio &&
      normalizado.numeroOficialDiio !== animal.numeroOficialDiio
    ) {
      const existenteDiio = await manager.findOne(Animal, {
        where: {
          tenantId,
          numeroOficialDiio: normalizado.numeroOficialDiio as string,
        },
        select: { id: true },
      });
      if (existenteDiio && existenteDiio.id !== id) {
        throw new ConflictException(
          `Ya existe un animal registrado con el número oficial DIIO "${normalizado.numeroOficialDiio}" en esta finca.`,
        );
      }
    }

    manager.merge(Animal, animal, normalizado);
    return manager.save(animal);
  }

  async darDeBaja(
    id: string,
    tenantId: string,
    bajaDto: BajaAnimalDto,
    manager: EntityManager,
  ) {
    const animal = await this.findOne(id, tenantId, manager);

    if (!animal.activo) {
      throw new ConflictException('El animal ya está de baja.');
    }

    // Los campos opcionales se normalizan a null: las columnas son nullable, y
    // asignar `undefined` hace que TypeORM omita la columna en el UPDATE en vez
    // de limpiarla.
    animal.activo = false;
    animal.tipoBaja = bajaDto.tipoBaja;
    animal.motivoBaja = bajaDto.motivoBaja ?? null;
    animal.fechaBaja = bajaDto.fechaBaja;
    animal.precioVentaCrc = bajaDto.precioVentaCrc ?? null;
    animal.pesoFinalKg = bajaDto.pesoFinalKg ?? null;

    return await manager.save(animal);
  }

  async getDocumentos(
    animalId: string,
    tenantId: string,
    manager: EntityManager,
  ) {
    // Verificar que el animal existe y pertenece al tenant
    await this.findOne(animalId, tenantId, manager);

    return manager.find(DocumentoAnimal, {
      where: { animalId, tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async createDocumento(
    animalId: string,
    tenantId: string,
    docDto: CreateDocumentoDto,
    manager: EntityManager,
  ) {
    // Verificar que el animal existe y pertenece al tenant
    await this.findOne(animalId, tenantId, manager);

    if (
      typeof docDto.objectPath !== 'string' ||
      !ANIMAL_DOCUMENT_OBJECT_PATH_REGEX.test(docDto.objectPath)
    ) {
      throw new BadRequestException('La ruta del documento no es válida.');
    }

    const [objectTenantId, objectAnimalId] = docDto.objectPath.split('/');
    if (objectTenantId !== tenantId || objectAnimalId !== animalId) {
      throw new ForbiddenException(
        'La ruta del documento no corresponde a este animal.',
      );
    }

    const category = docDto.tipo.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!docDto.tipo.trim() || category !== docDto.objectPath.split('/')[2]) {
      throw new BadRequestException(
        'La categoría del documento no coincide con la ruta del archivo.',
      );
    }

    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0));',
      [docDto.objectPath],
    );
    const existingDocument = await manager.query<{ id: string }[]>(
      `SELECT id FROM public.documento_animal
       WHERE tenant_id = $1 AND object_path = $2
       LIMIT 1;`,
      [tenantId, docDto.objectPath],
    );
    if (existingDocument.length > 0) {
      throw new ConflictException('El documento ya está registrado.');
    }

    registerAfterRollbackCallback(manager, () =>
      this.documentStorage.removeObject(docDto.objectPath),
    );
    await this.documentStorage.validateObject(docDto.objectPath);

    const doc = manager.create(DocumentoAnimal, {
      tenantId,
      animalId,
      tipo: docDto.tipo,
      objectPath: docDto.objectPath,
      archivoUrl: null,
    });

    return manager.save(doc);
  }
}
