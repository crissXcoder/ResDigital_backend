import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
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
    ];

    const payload: Record<string, unknown> = { ...dto };
    for (const campo of CAMPOS_OPCIONALES) {
      if (payload[campo] === '') {
        payload[campo] = null;
      }
    }
    return payload;
  }

  async create(
    tenantId: string,
    createAnimalDto: CreateAnimalDto,
    manager: EntityManager,
  ) {
    // El manejo de la violación de unicidad (23505) ya no vive acá: lo traduce
    // AllExceptionsFilter, que lo convierte en 409 Conflict para todo el
    // proyecto en vez de un 400 distinto por cada servicio.
    const animal = manager.create(Animal, {
      ...this.normalizarOpcionales(createAnimalDto),
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
    manager.merge(Animal, animal, this.normalizarOpcionales(updateAnimalDto));
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
