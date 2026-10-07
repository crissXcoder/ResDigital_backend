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
import { Evento } from '../eventos/entities/evento.entity.js';
import { EventoBaja } from './entities/evento-baja.entity.js';
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

  /**
   * Recorre la línea de ascendencia de un progenitor candidato para verificar
   * si el animal actual figura entre sus ancestros, lo que crearía un ciclo genealógico.
   */
  private async detectarCicloAncestros(
    animalId: string,
    progenitorCandidatoId: string,
    tenantId: string,
    manager: EntityManager,
  ): Promise<boolean> {
    const visitados = new Set<string>();
    const cola: string[] = [progenitorCandidatoId];
    let niveles = 0;
    const MAX_PROFUNDIDAD = 50;

    while (cola.length > 0 && niveles < MAX_PROFUNDIDAD) {
      const actualId = cola.shift()!;
      if (actualId === animalId) {
        return true;
      }
      if (visitados.has(actualId)) {
        continue;
      }
      visitados.add(actualId);

      const actual = await manager.findOne(Animal, {
        where: { id: actualId, tenantId },
        select: { id: true, madreId: true, padreId: true },
      });

      if (actual) {
        if (actual.madreId && !visitados.has(actual.madreId)) {
          if (actual.madreId === animalId) return true;
          cola.push(actual.madreId);
        }
        if (actual.padreId && !visitados.has(actual.padreId)) {
          if (actual.padreId === animalId) return true;
          cola.push(actual.padreId);
        }
      }
      niveles++;
    }

    return false;
  }

  /**
   * Valida reglas biológicas, aislamiento de tenant y ausencia de ciclos
   * genealógicos para madreId y padreId.
   */
  private async validarGenealogia(
    animalId: string | null,
    tenantId: string,
    madreId: string | null | undefined,
    padreId: string | null | undefined,
    manager: EntityManager,
  ): Promise<void> {
    // 1. Auto-parentesco (no puede ser su propio padre ni su propia madre)
    if (animalId) {
      if (madreId && madreId === animalId) {
        throw new BadRequestException('Un animal no puede ser su propia madre.');
      }
      if (padreId && padreId === animalId) {
        throw new BadRequestException('Un animal no puede ser su propio padre.');
      }
    }

    // 2. Validación de Madre
    if (madreId) {
      const madre = await manager.findOne(Animal, {
        where: { id: madreId, tenantId },
        select: { id: true, sexo: true },
      });

      if (!madre) {
        throw new BadRequestException(
          'La vaca madre especificada no existe en esta finca.',
        );
      }

      if (madre.sexo !== 'Hembra') {
        throw new BadRequestException(
          'La madre especificada debe ser de sexo Hembra.',
        );
      }

      if (animalId) {
        const hayCiclo = await this.detectarCicloAncestros(
          animalId,
          madreId,
          tenantId,
          manager,
        );
        if (hayCiclo) {
          throw new BadRequestException(
            'No se puede asignar como madre a un descendiente del animal (ciclo genealógico detectado).',
          );
        }
      }
    }

    // 3. Validación de Padre
    if (padreId) {
      const padre = await manager.findOne(Animal, {
        where: { id: padreId, tenantId },
        select: { id: true, sexo: true },
      });

      if (!padre) {
        throw new BadRequestException(
          'El toro padre especificado no existe en esta finca.',
        );
      }

      if (padre.sexo !== 'Macho') {
        throw new BadRequestException(
          'El padre especificado debe ser de sexo Macho.',
        );
      }

      if (animalId) {
        const hayCiclo = await this.detectarCicloAncestros(
          animalId,
          padreId,
          tenantId,
          manager,
        );
        if (hayCiclo) {
          throw new BadRequestException(
            'No se puede asignar como padre a un descendiente del animal (ciclo genealógico detectado).',
          );
        }
      }
    }
  }

  /**
   * Valida que la fecha de compra no sea anterior a la fecha de nacimiento.
   */
  private validarCronologia(
    fechaNacimiento: string | null | undefined,
    fechaCompra: string | null | undefined,
  ): void {
    if (!fechaNacimiento || !fechaCompra) return;

    const nac = fechaNacimiento.slice(0, 10);
    const comp = fechaCompra.slice(0, 10);

    if (comp < nac) {
      throw new BadRequestException(
        'La fecha de compra no puede ser anterior a la fecha de nacimiento del animal.',
      );
    }
  }

  async create(
    tenantId: string,
    createAnimalDto: CreateAnimalDto,
    manager: EntityManager,
  ) {
    const normalizado = this.normalizarOpcionales(createAnimalDto);

    this.validarCronologia(
      normalizado.fechaNacimiento as string | null | undefined,
      normalizado.fechaCompra as string | null | undefined,
    );

    await this.validarGenealogia(
      null,
      tenantId,
      normalizado.madreId as string | null | undefined,
      normalizado.padreId as string | null | undefined,
      manager,
    );

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

    const fechaNacimientoEfectiva =
      normalizado.fechaNacimiento !== undefined
        ? (normalizado.fechaNacimiento as string | null | undefined)
        : animal.fechaNacimiento;
    const fechaCompraEfectiva =
      normalizado.fechaCompra !== undefined
        ? (normalizado.fechaCompra as string | null | undefined)
        : animal.fechaCompra;

    this.validarCronologia(fechaNacimientoEfectiva, fechaCompraEfectiva);

    if (animal.fechaBaja) {
      const baja = animal.fechaBaja.slice(0, 10);
      if (
        fechaNacimientoEfectiva &&
        baja < fechaNacimientoEfectiva.slice(0, 10)
      ) {
        throw new BadRequestException(
          'La fecha de nacimiento no puede ser posterior a la fecha de baja del animal.',
        );
      }
      if (fechaCompraEfectiva && baja < fechaCompraEfectiva.slice(0, 10)) {
        throw new BadRequestException(
          'La fecha de compra no puede ser posterior a la fecha de baja del animal.',
        );
      }
    }

    if (normalizado.madreId !== undefined || normalizado.padreId !== undefined) {
      const nuevaMadreId =
        normalizado.madreId !== undefined
          ? (normalizado.madreId as string | null | undefined)
          : animal.madreId;
      const nuevoPadreId =
        normalizado.padreId !== undefined
          ? (normalizado.padreId as string | null | undefined)
          : animal.padreId;

      await this.validarGenealogia(
        id,
        tenantId,
        nuevaMadreId,
        nuevoPadreId,
        manager,
      );
    }

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
    actorUserId?: string,
  ) {
    const animal = await this.findOne(id, tenantId, manager);

    if (!animal.activo) {
      throw new ConflictException('El animal ya está de baja.');
    }

    const bajaFecha = bajaDto.fechaBaja.slice(0, 10);
    if (
      animal.fechaNacimiento &&
      bajaFecha < animal.fechaNacimiento.slice(0, 10)
    ) {
      throw new BadRequestException(
        'La fecha de baja no puede ser anterior a la fecha de nacimiento del animal.',
      );
    }
    if (animal.fechaCompra && bajaFecha < animal.fechaCompra.slice(0, 10)) {
      throw new BadRequestException(
        'La fecha de baja no puede ser anterior a la fecha de compra del animal.',
      );
    }

    // 1. Crear evento inmutable base en public.evento
    const repoEvento = manager.getRepository(Evento);
    const evento = repoEvento.create({
      tenantId,
      animalId: animal.id,
      tipo: 'BAJA',
      fechaEvento: bajaFecha,
      usuarioId: actorUserId || '00000000-0000-0000-0000-000000000000',
      notas: bajaDto.motivoBaja ?? null,
    });
    const eventoGuardado = await repoEvento.save(evento);

    // 2. Crear detalle específico del evento en public.evento_baja
    const repoEventoBaja = manager.getRepository(EventoBaja);
    const eventoBaja = repoEventoBaja.create({
      eventoId: eventoGuardado.id,
      tipoBaja: bajaDto.tipoBaja,
      motivo: bajaDto.motivoBaja ?? null,
      precioVentaCrc: bajaDto.precioVentaCrc ?? null,
      pesoFinalKg: bajaDto.pesoFinalKg ?? null,
    });
    await repoEventoBaja.save(eventoBaja);

    // 3. Proyección derivada en la entidad animal:
    // - Animal deja hato activo sin DELETE
    // - Se libera el potrero para que no continúe ocupando carga
    // - Los campos de salida se mantienen sincronizados para lecturas rápidas
    animal.activo = false;
    animal.potreroId = null;
    animal.tipoBaja = bajaDto.tipoBaja;
    animal.motivoBaja = bajaDto.motivoBaja ?? null;
    animal.fechaBaja = bajaDto.fechaBaja;
    animal.precioVentaCrc = bajaDto.precioVentaCrc ?? null;
    animal.pesoFinalKg = bajaDto.pesoFinalKg ?? null;

    return await manager.save(animal);
  }

  async getBajaByAnimal(
    animalId: string,
    tenantId: string,
    manager: EntityManager,
  ) {
    const animal = await this.findOne(animalId, tenantId, manager);

    const eventoBaja = await manager
      .getRepository(EventoBaja)
      .createQueryBuilder('eb')
      .innerJoinAndSelect('eb.evento', 'evento')
      .where('evento.animal_id = :animalId', { animalId })
      .andWhere('evento.tenant_id = :tenantId', { tenantId })
      .andWhere('evento.tipo = :tipo', { tipo: 'BAJA' })
      .andWhere('evento.revertido = false')
      .orderBy('evento.fecha_registro', 'DESC')
      .getOne();

    if (!eventoBaja) {
      if (!animal.activo) {
        return {
          eventoId: null,
          tipoBaja: animal.tipoBaja,
          motivo: animal.motivoBaja,
          fechaBaja: animal.fechaBaja,
          precioVentaCrc: animal.precioVentaCrc,
          pesoFinalKg: animal.pesoFinalKg,
          usuarioId: null,
        };
      }
      throw new NotFoundException('El animal no tiene registro de baja activo.');
    }

    return {
      eventoId: eventoBaja.eventoId,
      tipoBaja: eventoBaja.tipoBaja,
      motivo: eventoBaja.motivo,
      fechaBaja: eventoBaja.evento.fechaEvento,
      fechaRegistro: eventoBaja.evento.fechaRegistro,
      precioVentaCrc: eventoBaja.precioVentaCrc,
      pesoFinalKg: eventoBaja.pesoFinalKg,
      usuarioId: eventoBaja.evento.usuarioId,
    };
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
