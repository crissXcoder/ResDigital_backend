import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Animal } from './entities/animal.entity.js';
import { DocumentoAnimal } from './entities/documento-animal.entity.js';
import type { CreateAnimalDto } from './dto/create-animal.dto.js';
import type { UpdateAnimalDto } from './dto/update-animal.dto.js';
import type { BajaAnimalDto } from './dto/baja-animal.dto.js';
import type { CreateDocumentoDto } from './dto/create-documento.dto.js';
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

    const doc = manager.create(DocumentoAnimal, {
      tenantId,
      animalId,
      tipo: docDto.tipo,
      archivoUrl: docDto.archivoUrl,
    });

    return manager.save(doc);
  }
}
