import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, MoreThan } from 'typeorm';
import { Pesaje } from './entities/pesaje.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { CreatePesajeDto } from './dto/create-pesaje.dto.js';
import { todayIsoDate } from '../tratamientos/retiro-calc.js';

@Injectable()
export class PesajesService {
  async create(
    tenantId: string,
    createDto: CreatePesajeDto,
    manager: EntityManager,
  ) {
    // Se verifica el animal ANTES de escribir: si no existe o es de otra finca,
    // la petición falla con 404 en vez de dejar un pesaje huérfano.
    const animal = await this.assertAnimal(tenantId, createDto.animalId, manager);

    const hoy = todayIsoDate();
    if (createDto.fecha > hoy) {
      throw new BadRequestException(
        `La fecha del pesaje (${createDto.fecha}) no puede ser posterior a hoy (${hoy}).`,
      );
    }

    const posterior = await manager.findOne(Pesaje, {
      where: { tenantId, animalId: animal.id, fecha: MoreThan(createDto.fecha) },
    });

    const savedPesaje = await manager.save(
      manager.create(Pesaje, {
        tenantId,
        animalId: animal.id,
        fecha: createDto.fecha,
        pesoActualKg: createDto.pesoActualKg,
      }),
    );

    // Un pesaje retroactivo queda en el historial sin pisar el peso actual.
    if (!posterior) {
      animal.pesoActualKg = createDto.pesoActualKg;
      await manager.save(animal);
    }

    return savedPesaje;
  }

  async findAllByAnimal(tenantId: string, animalId: string, manager: EntityManager) {
    await this.assertAnimal(tenantId, animalId, manager);
    return manager.find(Pesaje, {
      where: { tenantId, animalId },
      order: { fecha: 'DESC', createdAt: 'DESC' },
    });
  }

  private async assertAnimal(
    tenantId: string,
    animalId: string,
    manager: EntityManager,
  ): Promise<Animal> {
    const animal = await manager.findOne(Animal, {
      where: { id: animalId, tenantId },
    });
    if (!animal) {
      throw new NotFoundException(
        `Animal con ID '${animalId}' no encontrado en esta finca.`,
      );
    }
    return animal;
  }
}
