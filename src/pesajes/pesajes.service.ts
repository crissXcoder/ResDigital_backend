import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Pesaje } from './entities/pesaje.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { CreatePesajeDto } from './dto/create-pesaje.dto.js';

@Injectable()
export class PesajesService {
  async create(
    tenantId: string,
    createDto: CreatePesajeDto,
    manager: EntityManager,
  ) {
    // Se verifica el animal ANTES de escribir: si no existe o es de otra finca,
    // la petición falla con 404 en vez de dejar un pesaje huérfano.
    const animal = await manager.findOne(Animal, {
      where: { id: createDto.animalId, tenantId },
    });
    if (!animal) {
      throw new NotFoundException(
        `Animal con ID '${createDto.animalId}' no encontrado en esta finca.`,
      );
    }

    const newPesaje = manager.create(Pesaje, {
      ...createDto,
      tenantId,
    });
    const savedPesaje = await manager.save(newPesaje);

    // Sincronizar el peso actual del animal.
    // La comparación explícita contra null/undefined es necesaria: con un
    // `if (createDto.pesoActualKg)` un peso de 0 es falsy y no se sincronizaba.
    if (
      createDto.pesoActualKg !== undefined &&
      createDto.pesoActualKg !== null
    ) {
      animal.pesoActualKg = createDto.pesoActualKg;
      await manager.save(animal);
    }

    return savedPesaje;
  }

  findAllByAnimal(tenantId: string, animalId: string, manager: EntityManager) {
    return manager.find(Pesaje, {
      where: { tenantId, animalId },
      order: { fecha: 'DESC', createdAt: 'DESC' },
    });
  }
}
