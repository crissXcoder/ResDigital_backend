import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Potrero } from './entities/potrero.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { CreatePotreroDto } from './dto/create-potrero.dto.js';
import { UpdatePotreroDto } from './dto/update-potrero.dto.js';
import { hoyEnZona } from '../reproductivo/services/reproductive-calculation.service.js';

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
    animalIds: string[],
    manager: EntityManager,
  ) {
    const repoPotrero = manager.getRepository(Potrero);
    const repoAnimal = manager.getRepository(Animal);

    const potrero = await repoPotrero.findOne({ where: { id, tenantId } });
    if (!potrero) throw new NotFoundException('Potrero no encontrado');

    if (animalIds && animalIds.length > 0) {
      // Se comparan ids únicos: si el cliente manda el mismo animal dos veces,
      // el UPDATE afecta una sola fila y la comparación contra `length` daba un
      // 400 falso.
      const idsUnicos = [...new Set(animalIds)];

      // Usamos QueryBuilder desde el manager para respetar la transacción RLS
      const result = await repoAnimal
        .createQueryBuilder()
        .update(Animal)
        .set({ potreroId: id })
        .where('id IN (:...ids) AND tenant_id = :tenantId', {
          ids: idsUnicos,
          tenantId,
        })
        .execute();

      if (result.affected !== idsUnicos.length) {
        throw new BadRequestException(
          'Uno o más animales proporcionados no existen o no pertenecen al tenant actual.',
        );
      }
    }

    // Fecha en la zona horaria de la finca, no en UTC: con toISOString() el
    // registro saltaba al día siguiente durante las últimas seis horas de cada
    // día (Costa Rica es UTC-6), y eso corría el cálculo de días de descanso.
    potrero.fechaUltimoIngreso = hoyEnZona();
    await repoPotrero.save(potrero);

    return this.findOne(id, tenantId, manager);
  }

  private calcularEstadoPotrero(potrero: Potrero) {
    let uaTotal = 0;
    potrero.animales?.forEach((a) => {
      if (['Vaca', 'Toro', 'Novillo mayor'].includes(a.categoria)) {
        uaTotal += 1.0;
      } else {
        uaTotal += 0.5;
      }
    });

    // `area_ha` y `capacidad_recomendada_ua_ha` son `numeric` en Postgres, y
    // TypeORM los devuelve como string para no perder precisión. Comparar un
    // string con un número dependía de la coerción implícita de JavaScript, que
    // en `>` funciona pero es frágil y silenciosa. Se convierte de forma
    // explícita.
    const areaHa = Number.parseFloat(String(potrero.areaHa));
    const capacidadUaHa = Number.parseFloat(
      String(potrero.capacidadRecomendadaUaHa),
    );

    const cargaActualUaHa = areaHa > 0 ? uaTotal / areaHa : 0;
    let estadoCalculado = 'DISPONIBLE';

    if (potrero.estadoManual) {
      estadoCalculado = potrero.estadoManual;
    } else {
      if (cargaActualUaHa > capacidadUaHa) {
        estadoCalculado = 'SOBRECARGADO';
      } else if (potrero.animales?.length === 0) {
        if (potrero.fechaUltimoIngreso) {
          const daysSince = Math.floor(
            (new Date().getTime() -
              new Date(potrero.fechaUltimoIngreso).getTime()) /
              (1000 * 3600 * 24),
          );
          if (daysSince < potrero.diasDescansoRecomendados) {
            estadoCalculado = 'EN RECUPERACIÓN';
          }
        }
      }
    }

    return {
      ...potrero,
      cargaActualUaHa: Number(cargaActualUaHa.toFixed(2)),
      uaTotal,
      estadoCalculado,
      animalesAsignadosCount: potrero.animales?.length || 0,
    };
  }
}
