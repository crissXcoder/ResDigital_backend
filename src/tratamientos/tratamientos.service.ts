import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Tratamiento } from './entities/tratamiento.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { CreateTratamientoDto } from './dto/create-tratamiento.dto.js';
import { UpdateTratamientoDto } from './dto/update-tratamiento.dto.js';
import {
  computeEstadoSanitario,
  resolveRetiros,
  todayIsoDate,
  type EstadoSanitarioResult,
} from './retiro-calc.js';

@Injectable()
export class TratamientosService {
  async create(
    tenantId: string,
    createDto: CreateTratamientoDto,
    manager: EntityManager,
  ) {
    const animal = await manager.findOne(Animal, {
      where: { id: createDto.animalId, tenantId },
    });
    if (!animal) {
      throw new NotFoundException(
        `Animal con ID '${createDto.animalId}' no encontrado en esta finca.`,
      );
    }

    const retiros = resolveRetiros({
      fecha: createDto.fecha,
      diasRetiro: createDto.diasRetiro,
      diasRetiroLeche: createDto.diasRetiroLeche,
      diasRetiroCarne: createDto.diasRetiroCarne,
    });

    const newEntity = manager.create(Tratamiento, {
      animalId: createDto.animalId,
      farmaco: createDto.farmaco,
      dosis: createDto.dosis,
      via: createDto.via,
      fecha: createDto.fecha,
      diagnostico: createDto.diagnostico,
      veterinario: createDto.veterinario,
      documentoUrl: createDto.documentoUrl ?? null,
      tenantId,
      diasRetiro: retiros.diasRetiro,
      diasRetiroLeche: retiros.diasRetiroLeche,
      diasRetiroCarne: retiros.diasRetiroCarne,
      fechaLiberacionLeche: retiros.fechaLiberacionLeche,
      fechaLiberacionCarne: retiros.fechaLiberacionCarne,
    });
    return manager.save(newEntity);
  }

  findAllByAnimal(tenantId: string, animalId: string, manager: EntityManager) {
    return manager.find(Tratamiento, {
      where: { tenantId, animalId },
      order: { fecha: 'DESC', createdAt: 'DESC' },
    });
  }

  async getEstadoSanitario(
    tenantId: string,
    animalId: string,
    manager: EntityManager,
    fechaReferencia?: string,
  ): Promise<EstadoSanitarioResult> {
    const tratamientos = await this.findAllByAnimal(
      tenantId,
      animalId,
      manager,
    );
    const ref = fechaReferencia?.slice(0, 10) || todayIsoDate();
    return computeEstadoSanitario(
      animalId,
      tratamientos.map((t) => ({
        id: t.id,
        farmaco: t.farmaco,
        fechaLiberacionLeche: t.fechaLiberacionLeche,
        fechaLiberacionCarne: t.fechaLiberacionCarne,
      })),
      ref,
    );
  }

  async update(
    id: string,
    tenantId: string,
    updateDto: UpdateTratamientoDto,
    manager: EntityManager,
  ) {
    const tratamiento = await manager.findOne(Tratamiento, {
      where: { id, tenantId },
    });
    if (!tratamiento) {
      throw new NotFoundException(`Tratamiento con ID ${id} no encontrado`);
    }

    const fecha = updateDto.fecha ?? tratamiento.fecha;
    const retiros = resolveRetiros({
      fecha,
      diasRetiro:
        updateDto.diasRetiro !== undefined
          ? updateDto.diasRetiro
          : tratamiento.diasRetiro,
      diasRetiroLeche:
        updateDto.diasRetiroLeche !== undefined
          ? updateDto.diasRetiroLeche
          : tratamiento.diasRetiroLeche,
      diasRetiroCarne:
        updateDto.diasRetiroCarne !== undefined
          ? updateDto.diasRetiroCarne
          : tratamiento.diasRetiroCarne,
    });

    manager.merge(Tratamiento, tratamiento, {
      ...updateDto,
      fecha,
      diasRetiro: retiros.diasRetiro,
      diasRetiroLeche: retiros.diasRetiroLeche,
      diasRetiroCarne: retiros.diasRetiroCarne,
      fechaLiberacionLeche: retiros.fechaLiberacionLeche,
      fechaLiberacionCarne: retiros.fechaLiberacionCarne,
    });
    return manager.save(tratamiento);
  }
}
