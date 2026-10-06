import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { Animal } from '../../animales/entities/animal.entity.js';
import { Evento } from '../../eventos/entities/evento.entity.js';
import { EventoServicio } from '../entities/evento-servicio.entity.js';
import { EventoDiagnostico } from '../entities/evento-diagnostico.entity.js';
import { EventoParto } from '../entities/evento-parto.entity.js';
import { EventoSecado } from '../entities/evento-secado.entity.js';
import { ReproductiveCalculationService } from './reproductive-calculation.service.js';
import type {
  EstadoReproductivo,
  EstadoReproductivoInfo,
  HitoReproductivo,
  ResumenServicioActivo,
  ResumenDiagnosticoActivo,
  ResumenPartoActivo,
  ResumenSecadoActivo,
} from '../interfaces/reproductive-state.interface.js';

export interface EventoHistoricoReproductivo {
  evento: Evento;
  servicio?: EventoServicio | null;
  diagnostico?: EventoDiagnostico | null;
  parto?: EventoParto | null;
  secado?: EventoSecado | null;
}

const TIPOS_REPRODUCTIVOS = ['SERVICIO', 'DIAGNOSTICO', 'PARTO', 'SECADO'];

@Injectable()
export class ReproductiveStateService {
  private readonly logger = new Logger(ReproductiveStateService.name);

  constructor(
    private readonly calculationService: ReproductiveCalculationService,
  ) {}

  /**
   * Calcula el estado reproductivo actual de un animal al vuelo a partir de su
   * historial de eventos inmutables (append-only), excluyendo los revertidos.
   *
   * NUNCA lee ni escribe una columna de estado en la tabla animal: el estado
   * siempre se deriva. Ver Patron-Evento-Estado-Alerta.md.
   *
   * `manager` es obligatorio a propósito. Antes había un fallback a
   * `this.dataSource.manager`, que corre fuera de la transacción del
   * RlsTransactionInterceptor y por lo tanto sin contexto de tenant ni rol
   * `authenticated`. Exigir el manager transaccional elimina esa puerta de
   * escape de raíz en vez de confiar en que nadie la use.
   */
  async calcularEstado(
    animalId: string,
    tenantId: string,
    manager: EntityManager,
  ): Promise<EstadoReproductivoInfo> {
    const animal = await manager.findOne(Animal, {
      where: { id: animalId, tenantId },
      relations: { raza: true },
    });

    if (!animal) {
      throw new NotFoundException(`Animal con ID '${animalId}' no encontrado.`);
    }

    if (animal.sexo?.toLowerCase() !== 'hembra') {
      throw new BadRequestException(
        `El animal con arete '${animal.areteInterno}' es de sexo '${animal.sexo}' y no posee ciclo reproductivo. Solo las hembras registran eventos reproductivos.`,
      );
    }

    const eventosHistoricos = await this.cargarHistorial(
      [animalId],
      tenantId,
      manager,
    );

    return this.derivarEstadoDesdeEventos(
      animal,
      eventosHistoricos.get(animalId) ?? [],
    );
  }

  /**
   * Versión en lote de `calcularEstado`.
   *
   * Sigue siendo cálculo al vuelo —no cachea ningún estado, no toca ninguna
   * columna de estado— pero resuelve todo el conjunto con un número fijo de
   * consultas en vez de una cascada por animal.
   *
   * Contexto: `obtenerProximosEventos` llamaba a `calcularEstado` dentro de un
   * bucle con `await` secuencial, y cada llamada hacía 2 consultas más una por
   * cada evento del historial. Con 200 hembras y ~10 eventos cada una eso son
   * más de 2000 viajes en serie a la base, todos dentro de la misma transacción
   * HTTP abierta. Acá son 6 consultas en total, independientemente del tamaño
   * del hato.
   *
   * Patron-Evento-Estado-Alerta.md acepta el costo del cálculo al vuelo para la
   * escala del proyecto (20-200 animales por finca) y desaconseja la columna de
   * caché para el MVP. Esto respeta esa decisión: solo elimina viajes
   * redundantes, no cambia el patrón.
   */
  async calcularEstadosBatch(
    animales: Animal[],
    tenantId: string,
    manager: EntityManager,
  ): Promise<Map<string, EstadoReproductivoInfo>> {
    const resultado = new Map<string, EstadoReproductivoInfo>();
    if (animales.length === 0) return resultado;

    const historiales = await this.cargarHistorial(
      animales.map((a) => a.id),
      tenantId,
      manager,
    );

    for (const animal of animales) {
      if (animal.sexo?.toLowerCase() !== 'hembra') continue;
      resultado.set(
        animal.id,
        this.derivarEstadoDesdeEventos(
          animal,
          historiales.get(animal.id) ?? [],
        ),
      );
    }

    return resultado;
  }

  /**
   * Carga el historial reproductivo de uno o varios animales, agrupado por animal.
   *
   * Hace 1 consulta de eventos + hasta 4 de detalle (una por tipo, con `IN`),
   * en lugar de una consulta por evento.
   *
   * Beneficio secundario de seguridad: las tablas `evento_*` de detalle no
   * tienen columna `tenant_id`, así que consultarlas por `eventoId` dependía
   * únicamente de la política RLS. Acá los ids provienen de una consulta a
   * `evento` ya filtrada por `tenantId`, de modo que el acotamiento por finca
   * queda garantizado por construcción del conjunto, no por una sola capa.
   */
  private async cargarHistorial(
    animalIds: string[],
    tenantId: string,
    manager: EntityManager,
  ): Promise<Map<string, EventoHistoricoReproductivo[]>> {
    const agrupado = new Map<string, EventoHistoricoReproductivo[]>();
    if (animalIds.length === 0) return agrupado;

    const eventos = await manager.find(Evento, {
      where: {
        animalId: In(animalIds),
        tenantId,
        revertido: false,
        tipo: In(TIPOS_REPRODUCTIVOS),
      },
      order: { fechaEvento: 'ASC', fechaRegistro: 'ASC', id: 'ASC' },
    });

    if (eventos.length === 0) return agrupado;

    const idsPorTipo = {
      SERVICIO: [] as string[],
      DIAGNOSTICO: [] as string[],
      PARTO: [] as string[],
      SECADO: [] as string[],
    };

    for (const evento of eventos) {
      const bucket = idsPorTipo[evento.tipo as keyof typeof idsPorTipo];
      if (bucket) bucket.push(evento.id);
    }

    const [servicios, diagnosticos, partos, secados] = await Promise.all([
      idsPorTipo.SERVICIO.length
        ? manager.find(EventoServicio, {
            where: { eventoId: In(idsPorTipo.SERVICIO) },
          })
        : Promise.resolve([]),
      idsPorTipo.DIAGNOSTICO.length
        ? manager.find(EventoDiagnostico, {
            where: { eventoId: In(idsPorTipo.DIAGNOSTICO) },
          })
        : Promise.resolve([]),
      idsPorTipo.PARTO.length
        ? manager.find(EventoParto, {
            where: { eventoId: In(idsPorTipo.PARTO) },
          })
        : Promise.resolve([]),
      idsPorTipo.SECADO.length
        ? manager.find(EventoSecado, {
            where: { eventoId: In(idsPorTipo.SECADO) },
          })
        : Promise.resolve([]),
    ]);

    const porServicio = new Map(servicios.map((d) => [d.eventoId, d]));
    const porDiagnostico = new Map(diagnosticos.map((d) => [d.eventoId, d]));
    const porParto = new Map(partos.map((d) => [d.eventoId, d]));
    const porSecado = new Map(secados.map((d) => [d.eventoId, d]));

    for (const evento of eventos) {
      const item: EventoHistoricoReproductivo = {
        evento,
        servicio: porServicio.get(evento.id) ?? null,
        diagnostico: porDiagnostico.get(evento.id) ?? null,
        parto: porParto.get(evento.id) ?? null,
        secado: porSecado.get(evento.id) ?? null,
      };

      const lista = agrupado.get(evento.animalId);
      if (lista) {
        lista.push(item);
      } else {
        agrupado.set(evento.animalId, [item]);
      }
    }

    return agrupado;
  }

  /**
   * Historial reproductivo completo de un animal, en orden cronológico.
   *
   * A diferencia de la derivación de estado, acá SÍ se incluyen los eventos
   * revertidos: el historial append-only es la fuente de verdad y una
   * corrección tiene que poder verse, marcada como tal.
   */
  async obtenerHistorial(
    animalId: string,
    tenantId: string,
    manager: EntityManager,
  ): Promise<EventoHistoricoReproductivo[]> {
    const animal = await manager.findOne(Animal, {
      where: { id: animalId, tenantId },
      select: { id: true, sexo: true, areteInterno: true },
    });

    if (!animal) {
      throw new NotFoundException(`Animal con ID '${animalId}' no encontrado.`);
    }

    const eventos = await manager.find(Evento, {
      where: { animalId, tenantId, tipo: In(TIPOS_REPRODUCTIVOS) },
      order: { fechaEvento: 'ASC', fechaRegistro: 'ASC', id: 'ASC' },
    });

    if (eventos.length === 0) return [];

    const ids = eventos.map((e) => e.id);
    const [servicios, diagnosticos, partos, secados] = await Promise.all([
      manager.find(EventoServicio, { where: { eventoId: In(ids) } }),
      manager.find(EventoDiagnostico, { where: { eventoId: In(ids) } }),
      manager.find(EventoParto, { where: { eventoId: In(ids) } }),
      manager.find(EventoSecado, { where: { eventoId: In(ids) } }),
    ]);

    const porServicio = new Map(servicios.map((d) => [d.eventoId, d]));
    const porDiagnostico = new Map(diagnosticos.map((d) => [d.eventoId, d]));
    const porParto = new Map(partos.map((d) => [d.eventoId, d]));
    const porSecado = new Map(secados.map((d) => [d.eventoId, d]));

    return eventos.map((evento) => ({
      evento,
      servicio: porServicio.get(evento.id) ?? null,
      diagnostico: porDiagnostico.get(evento.id) ?? null,
      parto: porParto.get(evento.id) ?? null,
      secado: porSecado.get(evento.id) ?? null,
    }));
  }

  /**
   * Máquina de estados pura: recorre la secuencia de eventos y devuelve el
   * estado derivado. Sin E/S, para poder probarla aislada.
   *
   * Transiciones (MOD-03-Reproductivo.md):
   *   Vacía → Servida        al registrar un servicio
   *   Servida → Preñada      diagnóstico positivo
   *   Servida → Vacía        diagnóstico negativo o retorno de celo
   *   Preñada → En Secado    al registrar el secado real
   *   Preñada → Vacía        aborto
   *   En Secado → Vacía      parto
   */
  derivarEstadoDesdeEventos(
    animal: Pick<Animal, 'id' | 'areteInterno' | 'sexo'> & {
      raza?: { nombre?: string; diasGestacion?: number } | null;
    },
    eventosHistoricos: EventoHistoricoReproductivo[],
    fechaReferencia: string = this.calculationService.hoyLocal(),
  ): EstadoReproductivoInfo {
    if (animal.sexo?.toLowerCase() !== 'hembra') {
      throw new BadRequestException(
        `El animal con arete '${animal.areteInterno}' es de sexo '${animal.sexo}' y no posee ciclo reproductivo.`,
      );
    }

    let estadoActual: EstadoReproductivo = 'Vacía';
    let fechaEstadoDesde: string | undefined;
    let servicioActivo: ResumenServicioActivo | undefined;
    let ultimoDiagnostico: ResumenDiagnosticoActivo | undefined;
    let ultimoParto: ResumenPartoActivo | undefined;
    let ultimoSecado: ResumenSecadoActivo | undefined;
    const advertencias: string[] = [];

    const sinDetalle = (evento: Evento): void => {
      // Antes estos eventos se saltaban en silencio y el estado quedaba mal sin
      // que nadie se enterara.
      advertencias.push(
        `El evento ${evento.id} de tipo ${evento.tipo} (${evento.fechaEvento}) no tiene su fila de detalle; se ignoró al derivar el estado.`,
      );
    };

    for (const item of eventosHistoricos) {
      const { evento, servicio, diagnostico, parto, secado } = item;

      if (evento.revertido) continue;

      switch (evento.tipo) {
        case 'SERVICIO': {
          // La asignación de estado va DENTRO del if: antes estaba fuera, así
          // que un servicio sin detalle dejaba al animal en 'Servida' pero sin
          // `servicioActivo`, y por lo tanto sin ningún hito calculado.
          if (!servicio) {
            sinDetalle(evento);
            break;
          }
          estadoActual = 'Servida';
          fechaEstadoDesde = evento.fechaEvento;
          ultimoDiagnostico = undefined; // Un servicio nuevo invalida el diagnóstico anterior
          servicioActivo = {
            eventoId: evento.id,
            fechaServicio: evento.fechaEvento,
            tipoServicio: servicio.tipoServicio,
            toroOPajilla: servicio.toroOPajilla,
            responsable: servicio.responsable,
            fpp: servicio.fpp,
            palpacionFecha: servicio.palpacionFecha,
            secadoFecha: servicio.secadoFecha,
            avisoPartoFecha: servicio.avisoPartoFecha,
            avisoPartoUrgenteFecha: servicio.avisoPartoUrgenteFecha,
            notas: evento.notas,
          };
          break;
        }

        case 'DIAGNOSTICO': {
          if (!diagnostico) {
            sinDetalle(evento);
            break;
          }
          ultimoDiagnostico = {
            eventoId: evento.id,
            fecha: evento.fechaEvento,
            metodo: diagnostico.metodo,
            resultado: diagnostico.resultado,
            eventoServicioId: diagnostico.eventoServicioId,
          };

          if (diagnostico.resultado === 'Preñada') {
            estadoActual = 'Preñada';
            fechaEstadoDesde = evento.fechaEvento;
          } else if (diagnostico.resultado === 'Vacía') {
            estadoActual = 'Vacía';
            fechaEstadoDesde = evento.fechaEvento;
            servicioActivo = undefined;
          }
          break;
        }

        case 'SECADO': {
          if (!secado) {
            sinDetalle(evento);
            break;
          }
          // El secado solo tiene sentido sobre una preñez confirmada. Antes se
          // registraba igual estando 'Servida', dejando al animal marcado como
          // seco pero sin haber transicionado: un estado que se contradice.
          if (estadoActual !== 'Preñada') {
            advertencias.push(
              `Se registró un secado el ${evento.fechaEvento} con el animal en estado '${estadoActual}'. El secado se aplica sobre una preñez confirmada; no se tomó en cuenta.`,
            );
            break;
          }
          ultimoSecado = { eventoId: evento.id, fecha: evento.fechaEvento };
          estadoActual = 'En Secado';
          fechaEstadoDesde = evento.fechaEvento;
          break;
        }

        case 'PARTO': {
          if (!parto) {
            sinDetalle(evento);
            break;
          }
          ultimoParto = {
            eventoId: evento.id,
            fecha: evento.fechaEvento,
            criaAnimalId: parto.criaAnimalId,
            facilidadParto: parto.facilidadParto,
          };
          // El parto (o el aborto) cierra el ciclo: vuelve a 'Vacía'.
          estadoActual = 'Vacía';
          fechaEstadoDesde = evento.fechaEvento;
          servicioActivo = undefined;
          ultimoDiagnostico = undefined;
          // `ultimoSecado` también se limpia: antes no, y la fecha de secado del
          // ciclo anterior se arrastraba al ciclo siguiente.
          ultimoSecado = undefined;
          break;
        }
      }
    }

    const proximosHitos = this.calcularProximosHitos(
      estadoActual,
      servicioActivo,
      fechaReferencia,
    );

    return {
      animalId: animal.id,
      areteInterno: animal.areteInterno,
      sexo: animal.sexo,
      razaNombre: animal.raza?.nombre,
      diasGestacionRaza: animal.raza?.diasGestacion,
      estadoActual,
      diasEnEstado: fechaEstadoDesde
        ? this.calcularDiasRestantes(fechaEstadoDesde, fechaReferencia)
        : undefined,
      servicioActivo,
      ultimoDiagnostico,
      ultimoParto,
      ultimoSecado,
      proximosHitos,
      advertencias,
    };
  }

  private calcularProximosHitos(
    estadoActual: EstadoReproductivo,
    servicioActivo: ResumenServicioActivo | undefined,
    fechaReferencia: string,
  ): HitoReproductivo[] {
    if (!servicioActivo) return [];

    const hito = (
      tipo: HitoReproductivo['tipo'],
      fecha: string,
      urgente = false,
    ): HitoReproductivo => ({
      tipo,
      fecha,
      diasRestantes: this.calcularDiasRestantes(fechaReferencia, fecha),
      urgente,
    });

    switch (estadoActual) {
      case 'Servida':
        return [hito('Palpación', servicioActivo.palpacionFecha)];

      case 'Preñada':
        return [
          hito('Secado', servicioActivo.secadoFecha),
          hito('Aviso Parto', servicioActivo.avisoPartoFecha),
          // FPP - 3 días. Reglas-de-Negocio-Ganaderas.md pide este aviso
          // separado del de 15 días; se calculaba y se guardaba desde siempre,
          // pero nunca se emitía como hito, así que nadie podía consumirlo.
          hito(
            'Aviso Parto Urgente',
            servicioActivo.avisoPartoUrgenteFecha,
            true,
          ),
          hito('Parto FPP', servicioActivo.fpp),
        ];

      case 'En Secado':
        return [
          hito('Aviso Parto', servicioActivo.avisoPartoFecha),
          hito(
            'Aviso Parto Urgente',
            servicioActivo.avisoPartoUrgenteFecha,
            true,
          ),
          hito('Parto FPP', servicioActivo.fpp),
        ];

      default:
        return [];
    }
  }

  private calcularDiasRestantes(
    fechaDesde: string,
    fechaHasta: string,
  ): number {
    const d1 = new Date(fechaDesde.slice(0, 10)).getTime();
    const d2 = new Date(fechaHasta.slice(0, 10)).getTime();
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  }
}
