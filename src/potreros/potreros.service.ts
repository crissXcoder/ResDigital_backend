import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Potrero } from './entities/potrero.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { Evento } from '../eventos/entities/evento.entity.js';
import { EventoMovimiento } from './entities/evento-movimiento.entity.js';
import { CreatePotreroDto } from './dto/create-potrero.dto.js';
import { UpdatePotreroDto } from './dto/update-potrero.dto.js';
import { AsignarAnimalesDto } from './dto/asignar-animales.dto.js';
import { hoyEnZona } from '../reproductivo/services/reproductive-calculation.service.js';
import { calcularUaAnimal } from './constants/ua-factors.js';

@Injectable()
export class PotrerosService {
  async findAll(tenantId: string, manager: EntityManager) {
    const potreros = await manager.getRepository(Potrero).find({
      where: { tenantId },
      relations: { animales: true },
      order: { nombre: 'ASC' },
    });

    return potreros.map((potrero) => this.calcularEstadoPotrero(potrero));
  }

  async findOne(id: string, tenantId: string, manager: EntityManager) {
    const potrero = await manager.getRepository(Potrero).findOne({
      where: { id, tenantId },
      relations: { animales: true },
    });

    if (!potrero) {
      throw new NotFoundException(`Potrero con ID ${id} no encontrado`);
    }

    return this.calcularEstadoPotrero(potrero);
  }

  async create(
    tenantId: string,
    data: CreatePotreroDto,
    manager: EntityManager,
  ) {
    const repo = manager.getRepository(Potrero);
    const potrero = repo.create({
      ...data,
      tenantId,
    });
    return repo.save(potrero);
  }

  async update(
    id: string,
    tenantId: string,
    data: UpdatePotreroDto,
    manager: EntityManager,
  ) {
    const repo = manager.getRepository(Potrero);
    const potrero = await repo.findOne({ where: { id, tenantId } });
    if (!potrero) throw new NotFoundException('Potrero no encontrado');

    repo.merge(potrero, data);
    return repo.save(potrero);
  }

  async remove(id: string, tenantId: string, manager: EntityManager) {
    const repo = manager.getRepository(Potrero);
    const potrero = await repo.findOne({ where: { id, tenantId } });
    if (!potrero) throw new NotFoundException('Potrero no encontrado');

    // La FK animal.potrero_id es ON DELETE NO ACTION: sin esta comprobación el
    // borrado reventaba con un error de integridad referencial y salía como 500.
    const animalesAsignados = await manager.count(Animal, {
      where: { potreroId: id, tenantId },
    });
    if (animalesAsignados > 0) {
      throw new ConflictException(
        `No se puede eliminar el potrero '${potrero.nombre}': todavía tiene ${animalesAsignados} animal(es) asignado(s). Movelos a otro potrero primero.`,
      );
    }

    return repo.remove(potrero);
  }

  async asignarAnimales(
    id: string,
    tenantId: string,
    userIdOrAnimalIds: string | string[],
    dtoOrManager: AsignarAnimalesDto | EntityManager,
    maybeManager?: EntityManager,
  ) {
    let userId: string;
    let dto: AsignarAnimalesDto;
    let manager: EntityManager;

    if (Array.isArray(userIdOrAnimalIds)) {
      userId = '00000000-0000-0000-0000-000000000000';
      dto = { animalIds: userIdOrAnimalIds };
      manager = dtoOrManager as EntityManager;
    } else {
      userId = userIdOrAnimalIds;
      dto = dtoOrManager as AsignarAnimalesDto;
      manager = maybeManager as EntityManager;
    }

    const repoPotrero = manager.getRepository(Potrero);
    const repoAnimal = manager.getRepository(Animal);
    const repoEvento = manager.getRepository(Evento);
    const repoEventoMovimiento = manager.getRepository(EventoMovimiento);

    const potrero = await repoPotrero.findOne({ where: { id, tenantId } });
    if (!potrero) throw new NotFoundException('Potrero no encontrado');

    const fechaEvento = dto.fecha ? dto.fecha.slice(0, 10) : hoyEnZona();

    if (dto.animalIds && dto.animalIds.length > 0) {
      const idsUnicos = [...new Set(dto.animalIds)];

      const animales = await repoAnimal
        .createQueryBuilder('animal')
        .where('animal.id IN (:...ids) AND animal.tenant_id = :tenantId', {
          ids: idsUnicos,
          tenantId,
        })
        .getMany();

      if (animales.length !== idsUnicos.length) {
        throw new BadRequestException(
          'Uno o más animales proporcionados no existen o no pertenecen al tenant actual.',
        );
      }

      // Registro atómico de trazabilidad histórica para cada animal movilizado
      for (const animal of animales) {
        const potreroAnteriorId = animal.potreroId ?? null;

        // 1. Crear evento maestro
        const evento = repoEvento.create({
          tenantId,
          animalId: animal.id,
          tipo: 'MOVIMIENTO',
          fechaEvento,
          usuarioId: userId,
          notas: dto.motivo ?? null,
        });
        await repoEvento.save(evento);

        // 2. Crear detalle específico del movimiento con origen y destino
        const eventoMovimiento = repoEventoMovimiento.create({
          eventoId: evento.id,
          potreroOrigenId: potreroAnteriorId,
          potreroDestinoId: id,
          motivo: dto.motivo ?? null,
        });
        await repoEventoMovimiento.save(eventoMovimiento);

        // 3. Actualizar la caché de ubicación actual del animal
        animal.potreroId = id;
        await repoAnimal.save(animal);
      }
    }

    // Actualizar fecha de último ingreso en el potrero destino
    potrero.fechaUltimoIngreso = fechaEvento;
    await repoPotrero.save(potrero);

    return this.findOne(id, tenantId, manager);
  }

  async obtenerMovimientosPotrero(
    potreroId: string,
    tenantId: string,
    manager: EntityManager,
  ) {
    const potrero = await manager.getRepository(Potrero).findOne({
      where: { id: potreroId, tenantId },
    });
    if (!potrero) throw new NotFoundException('Potrero no encontrado');

    const movimientos = await manager
      .getRepository(EventoMovimiento)
      .createQueryBuilder('em')
      .innerJoinAndSelect('em.evento', 'evento')
      .innerJoinAndSelect('evento.animal', 'animal')
      .leftJoinAndSelect('em.potreroOrigen', 'origen')
      .leftJoinAndSelect('em.potreroDestino', 'destino')
      .where('evento.tenant_id = :tenantId', { tenantId })
      .andWhere(
        '(em.potrero_origen_id = :potreroId OR em.potrero_destino_id = :potreroId)',
        { potreroId },
      )
      .andWhere('evento.revertido = false')
      .orderBy('evento.fecha_evento', 'DESC')
      .addOrderBy('evento.fecha_registro', 'DESC')
      .getMany();

    return movimientos.map((m) => ({
      id: m.eventoId,
      tipo: m.potreroDestinoId === potreroId ? 'INGRESO' : 'SALIDA',
      fechaEvento: m.evento.fechaEvento,
      fechaRegistro: m.evento.fechaRegistro,
      usuarioId: m.evento.usuarioId,
      motivo: m.motivo,
      animal: {
        id: m.evento.animal.id,
        areteInterno: m.evento.animal.areteInterno,
        nombre: m.evento.animal.nombre,
      },
      potreroOrigen: m.potreroOrigen
        ? { id: m.potreroOrigen.id, nombre: m.potreroOrigen.nombre }
        : null,
      potreroDestino: {
        id: m.potreroDestino.id,
        nombre: m.potreroDestino.nombre,
      },
    }));
  }

  async obtenerMovimientosAnimal(
    animalId: string,
    tenantId: string,
    manager: EntityManager,
  ) {
    const animal = await manager.getRepository(Animal).findOne({
      where: { id: animalId, tenantId },
    });
    if (!animal) throw new NotFoundException('Animal no encontrado');

    const movimientos = await manager
      .getRepository(EventoMovimiento)
      .createQueryBuilder('em')
      .innerJoinAndSelect('em.evento', 'evento')
      .leftJoinAndSelect('em.potreroOrigen', 'origen')
      .leftJoinAndSelect('em.potreroDestino', 'destino')
      .where('evento.tenant_id = :tenantId AND evento.animal_id = :animalId', {
        tenantId,
        animalId,
      })
      .andWhere('evento.revertido = false')
      .orderBy('evento.fecha_evento', 'DESC')
      .addOrderBy('evento.fecha_registro', 'DESC')
      .getMany();

    return movimientos.map((m) => ({
      id: m.eventoId,
      fechaEvento: m.evento.fechaEvento,
      fechaRegistro: m.evento.fechaRegistro,
      usuarioId: m.evento.usuarioId,
      motivo: m.motivo,
      potreroOrigen: m.potreroOrigen
        ? { id: m.potreroOrigen.id, nombre: m.potreroOrigen.nombre }
        : null,
      potreroDestino: {
        id: m.potreroDestino.id,
        nombre: m.potreroDestino.nombre,
      },
    }));
  }


  private calcularEstadoPotrero(potrero: Potrero) {
    let uaTotal = 0;
    let uaPorPeso = 0;
    let uaPorCategoria = 0;

    const animalesEnriquecidos =
      potrero.animales?.map((a) => {
        const { ua, metodo } = calcularUaAnimal(a);
        uaTotal += ua;
        if (metodo === 'PESO') {
          uaPorPeso += ua;
        } else {
          uaPorCategoria += ua;
        }
        return {
          ...a,
          uaCalculada: ua,
          metodoCalculoUa: metodo,
        };
      }) || [];

    uaTotal = Number(uaTotal.toFixed(2));
    uaPorPeso = Number(uaPorPeso.toFixed(2));
    uaPorCategoria = Number(uaPorCategoria.toFixed(2));
    const animalesCount = animalesEnriquecidos.length;

    const areaHa = Number.parseFloat(String(potrero.areaHa));
    const capacidadUaHa = Number.parseFloat(
      String(potrero.capacidadRecomendadaUaHa),
    );

    const cargaActualUaHa = areaHa > 0 ? uaTotal / areaHa : 0;

    // 1. Dimensión de Carga: 100% matemática y no sobreescribible por inputs manuales
    const sobrecargado = capacidadUaHa > 0 ? cargaActualUaHa > capacidadUaHa : cargaActualUaHa > 0;
    let estadoCarga: 'SOBRECARGADO' | 'ÓPTIMO' | 'SIN_CARGA';
    if (sobrecargado) {
      estadoCarga = 'SOBRECARGADO';
    } else if (animalesCount === 0) {
      estadoCarga = 'SIN_CARGA';
    } else {
      estadoCarga = 'ÓPTIMO';
    }

    // 2. Dimensión Operativa: ciclo de rotación y disponibilidad
    let estadoOperativo: string;
    if (potrero.estadoManual) {
      estadoOperativo = potrero.estadoManual.trim().toUpperCase();
    } else if (animalesCount > 0) {
      estadoOperativo = 'OCUPADO';
    } else if (potrero.fechaUltimoIngreso) {
      const daysSince = Math.floor(
        (new Date().getTime() -
          new Date(potrero.fechaUltimoIngreso).getTime()) /
          (1000 * 3600 * 24),
      );
      if (daysSince < potrero.diasDescansoRecomendados) {
        estadoOperativo = 'EN RECUPERACIÓN';
      } else {
        estadoOperativo = 'DISPONIBLE';
      }
    } else {
      estadoOperativo = 'DISPONIBLE';
    }

    // 3. Regla de Negocio Crítica (POT-T002 / MOD-05):
    // El estado de sobrecarga derivado no puede ser anulado por ningún label manual.
    // Si el potrero está sobrecargado, estadoCalculado devuelve 'SOBRECARGADO'.
    const estadoCalculado = sobrecargado ? 'SOBRECARGADO' : estadoOperativo;

    return {
      ...potrero,
      animales: animalesEnriquecidos,
      cargaActualUaHa: Number(cargaActualUaHa.toFixed(2)),
      uaTotal,
      desgloseUa: {
        porPeso: uaPorPeso,
        porCategoria: uaPorCategoria,
        total: uaTotal,
      },
      estadoCalculado,
      estadoCarga,
      estadoOperativo,
      sobrecargado,
      animalesAsignadosCount: animalesCount,
    };
  }
}
