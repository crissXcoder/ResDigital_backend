import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In, LessThanOrEqual, MoreThan, type EntityManager } from 'typeorm';
import { Evento } from '../eventos/entities/evento.entity.js';
import { EventoTratamiento } from '../tratamientos/entities/evento-tratamiento.entity.js';
import { addCalendarDays, todayIsoDate } from '../tratamientos/retiro-calc.js';
import { EventoProduccionLeche } from './entities/evento-produccion-leche.entity.js';
import { resolverDisposicion } from './disposicion-calc.js';
import {
  LactanciaService,
  bloquearAnimalProduccion,
  buscarAnimal,
  esHembra,
} from './lactancia.service.js';
import type {
  AnulacionProduccionResponseDto,
  AnularProduccionDto,
  CreateProduccionLecheDto,
  ProduccionLecheResponseDto,
  ResumenProduccionDiaDto,
  ResumenProduccionDto,
} from './dto/produccion-leche.dto.js';

export const MAX_DIAS_RESUMEN = 366;
const DIAS_RESUMEN_POR_DEFECTO = 30;

export interface FilaResumen {
  fecha: string;
  producidos: string | number | null;
  comercializables: string | number | null;
  descarte: string | number | null;
  registros: string | number;
}

const redondear = (litros: number) => Math.round(litros * 10) / 10;

function diasEntre(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split('-').map(Number);
  const [y2, m2, d2] = hasta.split('-').map(Number);
  const ms =
    Date.UTC(y2 ?? 0, (m2 ?? 1) - 1, d2 ?? 1) -
    Date.UTC(y1 ?? 0, (m1 ?? 1) - 1, d1 ?? 1);
  return Math.round(ms / 86_400_000);
}

/** Valida y completa el rango del resumen; devuelve null en `error` si es válido. */
export function resolverRango(
  desde: string | undefined,
  hasta: string | undefined,
  hoy: string,
): { desde: string; hasta: string; error: string | null } {
  const fin = hasta ?? hoy;
  const inicio = desde ?? addCalendarDays(fin, -(DIAS_RESUMEN_POR_DEFECTO - 1));
  if (inicio > fin) {
    return { desde: inicio, hasta: fin, error: '`desde` no puede ser posterior a `hasta`.' };
  }
  if (diasEntre(inicio, fin) + 1 > MAX_DIAS_RESUMEN) {
    return {
      desde: inicio,
      hasta: fin,
      error: `El rango no puede superar ${MAX_DIAS_RESUMEN} días.`,
    };
  }
  return { desde: inicio, hasta: fin, error: null };
}

export function sumarResumen(
  desde: string,
  hasta: string,
  filas: FilaResumen[],
): ResumenProduccionDto {
  const porFecha: ResumenProduccionDiaDto[] = filas.map((f) => ({
    fecha: f.fecha,
    litrosProducidos: redondear(Number(f.producidos ?? 0)),
    litrosComercializables: redondear(Number(f.comercializables ?? 0)),
    litrosDescarte: redondear(Number(f.descarte ?? 0)),
    registros: Number(f.registros),
  }));
  const total = (campo: keyof Omit<ResumenProduccionDiaDto, 'fecha'>) =>
    porFecha.reduce((acc, d) => acc + d[campo], 0);
  return {
    desde,
    hasta,
    litrosProducidos: redondear(total('litrosProducidos')),
    litrosComercializables: redondear(total('litrosComercializables')),
    litrosDescarte: redondear(total('litrosDescarte')),
    registros: total('registros'),
    porFecha,
  };
}

function toResponse(
  evento: Evento,
  detalle: EventoProduccionLeche,
  fechaLiberacionLeche: string | null,
): ProduccionLecheResponseDto {
  return {
    id: evento.id,
    animalId: evento.animalId,
    fecha: evento.fechaEvento,
    turno: detalle.turno,
    litros: Number(detalle.litros),
    disposicion: detalle.disposicion,
    tratamientoEventoId: detalle.tratamientoEventoId,
    fechaLiberacionLeche,
    revertido: evento.revertido,
    usuarioId: evento.usuarioId,
    notas: evento.notas,
    fechaRegistro: evento.fechaRegistro,
  };
}

@Injectable()
export class ProduccionLecheService {
  constructor(private readonly lactancia: LactanciaService) {}

  async create(
    tenantId: string,
    usuarioId: string,
    dto: CreateProduccionLecheDto,
    manager: EntityManager,
  ): Promise<ProduccionLecheResponseDto> {
    return manager.transaction(async (trx) => {
      await bloquearAnimalProduccion(trx, dto.animalId);
      const animal = await buscarAnimal(trx, tenantId, dto.animalId);
      const fecha = dto.fecha.slice(0, 10);

      const hoy = todayIsoDate();
      if (fecha > hoy) {
        throw new BadRequestException(
          `La fecha de producción (${fecha}) no puede ser posterior a hoy (${hoy}).`,
        );
      }
      if (!esHembra(animal)) {
        throw new BadRequestException(
          `El animal con arete '${animal.areteInterno}' es macho; solo una hembra en lactancia registra producción de leche.`,
        );
      }
      const lactancia = await this.lactancia.estadoDe(animal, tenantId, trx, fecha);
      if (!lactancia.enLactancia) {
        throw new BadRequestException(
          `El animal con arete '${animal.areteInterno}' no está en lactancia el ${fecha}. Si ya se ordeña, registre primero el inicio de lactancia.`,
        );
      }

      const duplicado = await trx.findOne(EventoProduccionLeche, {
        relations: { evento: true },
        where: {
          turno: dto.turno,
          evento: {
            tenantId,
            animalId: animal.id,
            tipo: 'PRODUCCION_LECHE',
            fechaEvento: fecha,
            revertido: false,
          },
        },
      });
      if (duplicado) {
        throw new ConflictException(
          `Ya hay producción registrada para el turno ${dto.turno} del ${fecha}. Anúlela si necesita registrarla de nuevo.`,
        );
      }

      const tratamientos = await trx.find(EventoTratamiento, {
        relations: { evento: true },
        where: {
          fechaLiberacionLeche: MoreThan(fecha),
          evento: {
            tenantId,
            animalId: animal.id,
            tipo: 'TRATAMIENTO',
            revertido: false,
            fechaEvento: LessThanOrEqual(fecha),
          },
        },
      });
      const disposicion = resolverDisposicion(
        tratamientos.map((t) => ({
          eventoId: t.eventoId,
          fechaAplicacion: t.evento.fechaEvento,
          fechaLiberacionLeche: t.fechaLiberacionLeche,
        })),
        fecha,
      );

      const evento = await trx.save(
        Evento,
        trx.create(Evento, {
          tenantId,
          animalId: animal.id,
          tipo: 'PRODUCCION_LECHE',
          fechaEvento: fecha,
          usuarioId,
          revertido: false,
          eventoCorrigeId: null,
          notas: dto.notas?.trim() || null,
        }),
      );
      const detalle = await trx.save(
        EventoProduccionLeche,
        trx.create(EventoProduccionLeche, {
          eventoId: evento.id,
          turno: dto.turno,
          litros: dto.litros,
          disposicion: disposicion.disposicion,
          tratamientoEventoId: disposicion.tratamientoEventoId,
        }),
      );
      return toResponse(evento, detalle, disposicion.fechaLiberacionLeche);
    });
  }

  async anular(
    tenantId: string,
    usuarioId: string,
    id: string,
    dto: AnularProduccionDto,
    manager: EntityManager,
  ): Promise<AnulacionProduccionResponseDto> {
    return manager.transaction(async (trx) => {
      const original = await trx.findOne(Evento, {
        where: { id, tenantId, tipo: 'PRODUCCION_LECHE' },
        lock: { mode: 'pessimistic_write' },
      });
      const detalle = original
        ? await trx.findOne(EventoProduccionLeche, { where: { eventoId: id } })
        : null;
      if (!original || !detalle) {
        throw new NotFoundException(`Producción con ID '${id}' no encontrada.`);
      }
      if (original.revertido) {
        throw new BadRequestException(`La producción '${id}' ya fue anulada.`);
      }
      await bloquearAnimalProduccion(trx, original.animalId);
      original.revertido = true;
      await trx.save(Evento, original);
      const anulacion = await trx.save(
        Evento,
        trx.create(Evento, {
          tenantId,
          animalId: original.animalId,
          tipo: 'PRODUCCION_LECHE',
          fechaEvento: todayIsoDate(),
          usuarioId,
          revertido: false,
          eventoCorrigeId: original.id,
          notas: dto.motivo,
        }),
      );
      return { id: original.id, eventoAnulacionId: anulacion.id, motivo: dto.motivo };
    });
  }

  async findAllByAnimal(
    tenantId: string,
    animalId: string,
    manager: EntityManager,
  ): Promise<ProduccionLecheResponseDto[]> {
    await buscarAnimal(manager, tenantId, animalId);
    const detalles = await manager.find(EventoProduccionLeche, {
      relations: { evento: true },
      where: { evento: { tenantId, animalId, tipo: 'PRODUCCION_LECHE' } },
      order: { evento: { fechaEvento: 'DESC', fechaRegistro: 'DESC' } },
    });

    const tratamientoIds = [
      ...new Set(
        detalles
          .map((d) => d.tratamientoEventoId)
          .filter((t): t is string => t != null),
      ),
    ];
    const liberaciones = new Map<string, string>();
    if (tratamientoIds.length > 0) {
      const tratamientos = await manager.find(EventoTratamiento, {
        where: { eventoId: In(tratamientoIds) },
      });
      for (const t of tratamientos) {
        liberaciones.set(t.eventoId, t.fechaLiberacionLeche);
      }
    }

    return detalles.map((d) =>
      toResponse(
        d.evento,
        d,
        d.tratamientoEventoId
          ? (liberaciones.get(d.tratamientoEventoId) ?? null)
          : null,
      ),
    );
  }

  async resumen(
    tenantId: string,
    manager: EntityManager,
    desde?: string,
    hasta?: string,
  ): Promise<ResumenProduccionDto> {
    const rango = resolverRango(desde, hasta, todayIsoDate());
    if (rango.error) throw new BadRequestException(rango.error);

    const filas = await manager
      .createQueryBuilder(EventoProduccionLeche, 'd')
      .innerJoin('d.evento', 'e')
      .select(`to_char(e.fecha_evento, 'YYYY-MM-DD')`, 'fecha')
      .addSelect('SUM(d.litros)', 'producidos')
      .addSelect(`SUM(d.litros) FILTER (WHERE d.disposicion = 'COMERCIALIZABLE')`, 'comercializables')
      .addSelect(`SUM(d.litros) FILTER (WHERE d.disposicion = 'DESCARTE')`, 'descarte')
      .addSelect('COUNT(*)', 'registros')
      .where('e.tenant_id = :tenantId', { tenantId })
      .andWhere(`e.tipo = 'PRODUCCION_LECHE'`)
      .andWhere('e.revertido = false')
      .andWhere('e.fecha_evento BETWEEN :desde AND :hasta', {
        desde: rango.desde,
        hasta: rango.hasta,
      })
      .groupBy('e.fecha_evento')
      .orderBy('e.fecha_evento', 'ASC')
      .getRawMany<FilaResumen>();

    return sumarResumen(rango.desde, rango.hasta, filas);
  }
}
