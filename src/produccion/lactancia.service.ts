import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { Animal } from '../animales/entities/animal.entity.js';
import { Evento } from '../eventos/entities/evento.entity.js';
import { EventoParto } from '../reproductivo/entities/evento-parto.entity.js';
import { ReproductiveStateService } from '../reproductivo/services/reproductive-state.service.js';
import { todayIsoDate } from '../tratamientos/retiro-calc.js';
import {
  TIPOS_LACTANCIA,
  derivarLactancia,
  type EstadoLactancia,
  type EventoLactancia,
} from './lactancia-calc.js';
import type {
  EstadoLactanciaDto,
  EventoLactanciaResponseDto,
  HembraEnLactanciaDto,
  RegistrarEventoLactanciaDto,
} from './dto/lactancia.dto.js';

export function esHembra(animal: Pick<Animal, 'sexo'>): boolean {
  return animal.sexo?.toLowerCase() === 'hembra';
}

/** Serializa las escrituras de producción y lactancia de un mismo animal. */
export async function bloquearAnimalProduccion(
  manager: EntityManager,
  animalId: string,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0));', [
    `produccion-animal:${animalId}`,
  ]);
}

export async function buscarAnimal(
  manager: EntityManager,
  tenantId: string,
  animalId: string,
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

@Injectable()
export class LactanciaService {
  constructor(private readonly reproductiveState: ReproductiveStateService) {}

  /** Eventos de lactancia vigentes por animal: 2 consultas sin importar el tamaño del lote. */
  async cargarEventos(
    animalIds: string[],
    tenantId: string,
    manager: EntityManager,
  ): Promise<Map<string, EventoLactancia[]>> {
    const agrupado = new Map<string, EventoLactancia[]>();
    if (animalIds.length === 0) return agrupado;

    const eventos = await manager.find(Evento, {
      where: {
        animalId: In(animalIds),
        tenantId,
        revertido: false,
        tipo: In([...TIPOS_LACTANCIA]),
      },
    });
    const partoIds = eventos.filter((e) => e.tipo === 'PARTO').map((e) => e.id);
    const partos =
      partoIds.length > 0
        ? await manager.find(EventoParto, { where: { eventoId: In(partoIds) } })
        : [];
    const abortos = new Set(
      partos.filter((p) => p.facilidadParto === 'Aborto').map((p) => p.eventoId),
    );

    for (const e of eventos) {
      const lista = agrupado.get(e.animalId) ?? [];
      lista.push({
        id: e.id,
        tipo: e.tipo as EventoLactancia['tipo'],
        fechaEvento: e.fechaEvento,
        fechaRegistro: e.fechaRegistro,
        esAborto: abortos.has(e.id),
      });
      agrupado.set(e.animalId, lista);
    }
    return agrupado;
  }

  async estadoDe(
    animal: Animal,
    tenantId: string,
    manager: EntityManager,
    fecha: string,
  ): Promise<EstadoLactancia> {
    if (!esHembra(animal)) return derivarLactancia([], fecha);
    const eventos = await this.cargarEventos([animal.id], tenantId, manager);
    return derivarLactancia(eventos.get(animal.id) ?? [], fecha);
  }

  async getEstado(
    tenantId: string,
    animalId: string,
    manager: EntityManager,
    fecha?: string,
  ): Promise<EstadoLactanciaDto> {
    const ref = fecha ?? todayIsoDate();
    const animal = await buscarAnimal(manager, tenantId, animalId);
    const estado = await this.estadoDe(animal, tenantId, manager, ref);
    return { animalId, ...estado, fechaReferencia: ref };
  }

  async getActivas(
    tenantId: string,
    manager: EntityManager,
    fecha?: string,
  ): Promise<HembraEnLactanciaDto[]> {
    const ref = fecha ?? todayIsoDate();
    const hembras = (
      await manager.find(Animal, { where: { tenantId, activo: true } })
    ).filter(esHembra);
    const eventos = await this.cargarEventos(
      hembras.map((h) => h.id),
      tenantId,
      manager,
    );

    const resultado: HembraEnLactanciaDto[] = [];
    for (const hembra of hembras) {
      const estado = derivarLactancia(eventos.get(hembra.id) ?? [], ref);
      if (!estado.enLactancia || !estado.fechaInicio) continue;
      resultado.push({
        animalId: hembra.id,
        arete: hembra.areteInterno,
        nombre: hembra.nombre,
        fechaInicio: estado.fechaInicio,
      });
    }
    return resultado.sort((a, b) => a.arete.localeCompare(b.arete));
  }

  async registrarInicio(
    tenantId: string,
    usuarioId: string,
    animalId: string,
    dto: RegistrarEventoLactanciaDto,
    manager: EntityManager,
  ): Promise<EventoLactanciaResponseDto> {
    return manager.transaction(async (trx) => {
      await bloquearAnimalProduccion(trx, animalId);
      const animal = await buscarAnimal(trx, tenantId, animalId);
      if (!esHembra(animal)) {
        throw new BadRequestException(
          `El animal con arete '${animal.areteInterno}' es macho; solo una hembra puede iniciar lactancia.`,
        );
      }
      this.validarFechaNoFutura(dto.fecha);
      const estado = await this.estadoDe(animal, tenantId, trx, dto.fecha);
      if (estado.enLactancia) {
        throw new BadRequestException(
          `El animal con arete '${animal.areteInterno}' ya está en lactancia desde ${estado.fechaInicio}.`,
        );
      }
      return this.guardarEvento(trx, tenantId, usuarioId, animalId, 'INICIO_LACTANCIA', dto);
    });
  }

  async registrarFin(
    tenantId: string,
    usuarioId: string,
    animalId: string,
    dto: RegistrarEventoLactanciaDto,
    manager: EntityManager,
  ): Promise<EventoLactanciaResponseDto> {
    return manager.transaction(async (trx) => {
      await bloquearAnimalProduccion(trx, animalId);
      const animal = await buscarAnimal(trx, tenantId, animalId);
      this.validarFechaNoFutura(dto.fecha);
      const actual = await this.estadoDe(animal, tenantId, trx, todayIsoDate());
      if (!actual.enLactancia || !actual.fechaInicio) {
        throw new BadRequestException(
          `El animal con arete '${animal.areteInterno}' no está en lactancia.`,
        );
      }
      if (dto.fecha < actual.fechaInicio) {
        throw new BadRequestException(
          `La fecha de fin (${dto.fecha}) no puede ser anterior al inicio de la lactancia (${actual.fechaInicio}).`,
        );
      }
      const reproductivo = await this.reproductiveState.calcularEstado(
        animalId,
        tenantId,
        trx,
      );
      if (reproductivo.estadoActual === 'Preñada') {
        throw new BadRequestException(
          'La vaca está preñada: para terminar la lactancia registre el secado en el módulo reproductivo.',
        );
      }
      return this.guardarEvento(trx, tenantId, usuarioId, animalId, 'FIN_LACTANCIA', dto);
    });
  }

  private validarFechaNoFutura(fecha: string): void {
    const hoy = todayIsoDate();
    if (fecha > hoy) {
      throw new BadRequestException(
        `La fecha (${fecha}) no puede ser posterior a hoy (${hoy}).`,
      );
    }
  }

  private async guardarEvento(
    trx: EntityManager,
    tenantId: string,
    usuarioId: string,
    animalId: string,
    tipo: 'INICIO_LACTANCIA' | 'FIN_LACTANCIA',
    dto: RegistrarEventoLactanciaDto,
  ): Promise<EventoLactanciaResponseDto> {
    const evento = await trx.save(
      Evento,
      trx.create(Evento, {
        tenantId,
        animalId,
        tipo,
        fechaEvento: dto.fecha,
        usuarioId,
        revertido: false,
        eventoCorrigeId: null,
        notas: dto.notas?.trim() || null,
      }),
    );
    return {
      id: evento.id,
      animalId,
      tipo,
      fecha: evento.fechaEvento,
      notas: evento.notas,
      usuarioId,
    };
  }
}
