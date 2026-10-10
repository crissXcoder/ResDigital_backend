import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, MoreThan } from 'typeorm';
import { Evento } from '../eventos/entities/evento.entity.js';
import { Animal } from '../animales/entities/animal.entity.js';
import { Medicamento } from '../sanitary/entities/medicamento.entity.js';
import { Padecimiento } from '../sanitary/entities/padecimiento.entity.js';
import { EventoTratamiento } from './entities/evento-tratamiento.entity.js';
import {
  CreateTratamientoDto,
  DatosTratamientoDto,
} from './dto/create-tratamiento.dto.js';
import { CorregirTratamientoDto } from './dto/corregir-tratamiento.dto.js';
import { AnularTratamientoDto } from './dto/anular-tratamiento.dto.js';
import {
  toTratamientoResponse,
  type AnimalEnRetiroDto,
  type TratamientoResponseDto,
} from './dto/tratamiento-response.dto.js';
import {
  computeEstadoSanitario,
  resolveRetiros,
  todayIsoDate,
  validarFechasTratamiento,
  type EstadoSanitarioResult,
} from './retiro-calc.js';
import { validarCompatibilidadSexo } from './compatibilidad-sexo.js';
import { validarDocumentoTratamiento } from './documento-tratamiento.js';

export interface AnulacionResponse {
  id: string;
  eventoAnulacionId: string;
  motivo: string;
}

@Injectable()
export class TratamientosService {
  async create(
    tenantId: string,
    usuarioId: string,
    dto: CreateTratamientoDto,
    manager: EntityManager,
  ): Promise<TratamientoResponseDto> {
    const animal = await this.assertAnimal(tenantId, dto.animalId, manager);
    return manager.transaction((trx) =>
      this.crearEvento(trx, tenantId, usuarioId, animal, dto, null),
    );
  }

  async findAllByAnimal(
    tenantId: string,
    animalId: string,
    manager: EntityManager,
  ): Promise<TratamientoResponseDto[]> {
    await this.assertAnimal(tenantId, animalId, manager);
    const detalles = await this.listarVigentes(tenantId, animalId, manager);
    return detalles.map((d) => toTratamientoResponse(d.evento, d));
  }

  async getEstadoSanitario(
    tenantId: string,
    animalId: string,
    manager: EntityManager,
    fechaReferencia?: string,
  ): Promise<EstadoSanitarioResult> {
    await this.assertAnimal(tenantId, animalId, manager);
    const detalles = await this.listarVigentes(tenantId, animalId, manager);
    return computeEstadoSanitario(
      animalId,
      detalles.map((d) => ({
        id: d.eventoId,
        farmaco: d.productoNombre,
        fechaAplicacion: d.evento.fechaEvento,
        fechaLiberacionLeche: d.fechaLiberacionLeche,
        fechaLiberacionCarne: d.fechaLiberacionCarne,
      })),
      fechaReferencia ?? todayIsoDate(),
    );
  }

  async getRetirosActivos(
    tenantId: string,
    manager: EntityManager,
    fechaReferencia?: string,
  ): Promise<AnimalEnRetiroDto[]> {
    const ref = fechaReferencia ?? todayIsoDate();
    const eventoVigente = {
      tenantId,
      tipo: 'TRATAMIENTO' as const,
      revertido: false,
      animal: { activo: true },
    };
    const detalles = await manager.find(EventoTratamiento, {
      relations: { evento: { animal: true } },
      where: [
        { evento: eventoVigente, fechaLiberacionLeche: MoreThan(ref) },
        { evento: eventoVigente, fechaLiberacionCarne: MoreThan(ref) },
      ],
    });

    const porAnimal = new Map<string, EventoTratamiento[]>();
    for (const d of detalles) {
      const lista = porAnimal.get(d.evento.animalId) ?? [];
      lista.push(d);
      porAnimal.set(d.evento.animalId, lista);
    }

    const resultado: AnimalEnRetiroDto[] = [];
    for (const [animalId, lista] of porAnimal) {
      const animal = lista[0]!.evento.animal;
      const estado = computeEstadoSanitario(
        animalId,
        lista.map((d) => ({
          id: d.eventoId,
          farmaco: d.productoNombre,
          fechaAplicacion: d.evento.fechaEvento,
          fechaLiberacionLeche: d.fechaLiberacionLeche,
          fechaLiberacionCarne: d.fechaLiberacionCarne,
        })),
        ref,
      );
      if (!estado.enRetiro) continue;
      resultado.push({
        animalId,
        arete: animal.areteInterno,
        nombre: animal.nombre,
        fechaLiberacionLeche: estado.liberacionLeche,
        fechaLiberacionCarne: estado.liberacionCarne,
        diasRestantesLeche: estado.liberacionLeche
          ? estado.diasRestantesLeche
          : null,
        diasRestantesCarne: estado.liberacionCarne
          ? estado.diasRestantesCarne
          : null,
        tratamientoReferencia: estado.tratamientoReferencia,
      });
    }
    return resultado.sort((a, b) => a.arete.localeCompare(b.arete));
  }

  async corregir(
    tenantId: string,
    usuarioId: string,
    id: string,
    dto: CorregirTratamientoDto,
    manager: EntityManager,
  ): Promise<TratamientoResponseDto> {
    return manager.transaction(async (trx) => {
      const { evento: original, detalle } = await this.bloquearVigente(trx, tenantId, id);
      const animal = await this.assertAnimal(tenantId, original.animalId, trx);
      original.revertido = true;
      await trx.save(Evento, original);
      return this.crearEvento(
        trx,
        tenantId,
        usuarioId,
        animal,
        dto,
        original.id,
        detalle.documentoUrl,
      );
    });
  }

  async anular(
    tenantId: string,
    usuarioId: string,
    id: string,
    dto: AnularTratamientoDto,
    manager: EntityManager,
  ): Promise<AnulacionResponse> {
    return manager.transaction(async (trx) => {
      const { evento: original } = await this.bloquearVigente(trx, tenantId, id);
      original.revertido = true;
      await trx.save(Evento, original);
      const anulacion = await trx.save(
        Evento,
        trx.create(Evento, {
          tenantId,
          animalId: original.animalId,
          tipo: 'TRATAMIENTO',
          fechaEvento: todayIsoDate(),
          usuarioId,
          revertido: false,
          eventoCorrigeId: original.id,
          notas: dto.motivo,
        }),
      );
      return {
        id: original.id,
        eventoAnulacionId: anulacion.id,
        motivo: dto.motivo,
      };
    });
  }

  private async crearEvento(
    trx: EntityManager,
    tenantId: string,
    usuarioId: string,
    animal: Animal,
    datos: DatosTratamientoDto,
    eventoCorrigeId: string | null,
    documentoPrevio: string | null = null,
  ): Promise<TratamientoResponseDto> {
    const animalId = animal.id;
    const errorFechas = validarFechasTratamiento({
      fecha: datos.fecha,
      fechaUltimaAdministracion: datos.fechaUltimaAdministracion,
      hoy: todayIsoDate(),
    });
    if (errorFechas) throw new BadRequestException(errorFechas);
    const documento = datos.documentoUrl?.trim() || null;
    const errorDocumento = validarDocumentoTratamiento({
      documento,
      documentoPrevio,
      tenantId,
      animalId,
    });
    if (errorDocumento) throw new BadRequestException(errorDocumento);

    const producto = await this.resolverProducto(trx, tenantId, datos);
    const diagnostico = await this.resolverDiagnostico(trx, tenantId, datos);
    const errorSexo = validarCompatibilidadSexo({
      sexo: animal.sexo,
      diagnostico: diagnostico.texto,
      categoriaPadecimiento: diagnostico.categoria,
      via: datos.via,
      viaMedicamento: producto.via,
    });
    if (errorSexo) throw new BadRequestException(errorSexo);
    const retiros = resolveRetiros({
      fecha: datos.fecha,
      fechaUltimaAdministracion: datos.fechaUltimaAdministracion,
      diasRetiroLeche: datos.diasRetiroLeche,
      diasRetiroCarne: datos.diasRetiroCarne,
    });

    const evento = await trx.save(
      Evento,
      trx.create(Evento, {
        tenantId,
        animalId,
        tipo: 'TRATAMIENTO',
        fechaEvento: datos.fecha.slice(0, 10),
        usuarioId,
        revertido: false,
        eventoCorrigeId,
        notas: null,
      }),
    );

    const detalle = await trx.save(
      EventoTratamiento,
      trx.create(EventoTratamiento, {
        eventoId: evento.id,
        medicamentoId: producto.medicamentoId,
        productoNombre: producto.nombre,
        padecimientoId: diagnostico.padecimientoId,
        diagnostico: diagnostico.texto,
        dosis: datos.dosis,
        via: datos.via ?? null,
        veterinario: datos.veterinario ?? null,
        fechaUltimaAdministracion: retiros.fechaUltimaAdministracion,
        diasRetiroLeche: retiros.diasRetiroLeche,
        diasRetiroCarne: retiros.diasRetiroCarne,
        fechaLiberacionLeche: retiros.fechaLiberacionLeche,
        fechaLiberacionCarne: retiros.fechaLiberacionCarne,
        documentoUrl: documento,
      }),
    );

    return toTratamientoResponse(evento, detalle);
  }

  private async resolverProducto(
    manager: EntityManager,
    tenantId: string,
    datos: DatosTratamientoDto,
  ): Promise<{ medicamentoId: string | null; nombre: string; via: string | null }> {
    if (datos.medicamentoId) {
      const medicamento = await manager.findOne(Medicamento, {
        where: { id: datos.medicamentoId, tenantId },
      });
      if (!medicamento) {
        throw new NotFoundException(
          `Medicamento con ID '${datos.medicamentoId}' no encontrado en el catálogo de esta finca.`,
        );
      }
      return {
        medicamentoId: medicamento.id,
        nombre: medicamento.nombreComercial,
        via: medicamento.viaAdministracion ?? null,
      };
    }
    return { medicamentoId: null, nombre: (datos.farmaco ?? '').trim(), via: null };
  }

  private async resolverDiagnostico(
    manager: EntityManager,
    tenantId: string,
    datos: DatosTratamientoDto,
  ): Promise<{ padecimientoId: string | null; texto: string; categoria: string | null }> {
    if (datos.padecimientoId) {
      const padecimiento = await manager.findOne(Padecimiento, {
        where: { id: datos.padecimientoId, tenantId },
      });
      if (!padecimiento) {
        throw new NotFoundException(
          `Padecimiento con ID '${datos.padecimientoId}' no encontrado en el catálogo de esta finca.`,
        );
      }
      return {
        padecimientoId: padecimiento.id,
        texto: padecimiento.nombre,
        categoria: padecimiento.categoria ?? null,
      };
    }
    return {
      padecimientoId: null,
      texto: (datos.diagnostico ?? '').trim(),
      categoria: null,
    };
  }

  private listarVigentes(
    tenantId: string,
    animalId: string,
    manager: EntityManager,
  ): Promise<EventoTratamiento[]> {
    return manager.find(EventoTratamiento, {
      relations: { evento: true },
      where: {
        evento: { tenantId, animalId, tipo: 'TRATAMIENTO', revertido: false },
      },
      order: { evento: { fechaEvento: 'DESC', fechaRegistro: 'DESC' } },
    });
  }

  /** Carga con bloqueo un tratamiento vigente (con detalle) del tenant. */
  private async bloquearVigente(
    trx: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<{ evento: Evento; detalle: EventoTratamiento }> {
    const original = await trx.findOne(Evento, {
      where: { id, tenantId, tipo: 'TRATAMIENTO' },
      lock: { mode: 'pessimistic_write' },
    });
    const detalle = original
      ? await trx.findOne(EventoTratamiento, { where: { eventoId: id } })
      : null;
    if (!original || !detalle) {
      throw new NotFoundException(`Tratamiento con ID '${id}' no encontrado.`);
    }
    if (original.revertido) {
      throw new ConflictException(
        `El tratamiento '${id}' ya fue corregido o anulado.`,
      );
    }
    return { evento: original, detalle };
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
