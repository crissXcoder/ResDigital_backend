import type { EntityManager } from 'typeorm';
import { Evento } from '../eventos/entities/evento.entity.js';
import { EventoTratamiento } from '../tratamientos/entities/evento-tratamiento.entity.js';
import { EventoProduccionLeche } from './entities/evento-produccion-leche.entity.js';
import { resolverDisposicion } from './disposicion-calc.js';

export interface ProduccionCorregida {
  idAnterior: string;
  idNuevo: string;
  disposicionAnterior: EventoProduccionLeche['disposicion'];
  disposicionNueva: EventoProduccionLeche['disposicion'];
}

export async function reconcileProductionDisposition(
  manager: EntityManager,
  tenantId: string,
  animalId: string,
  usuarioId: string,
  motivo: string,
): Promise<ProduccionCorregida[]> {
  const tratamientos = await manager.find(EventoTratamiento, {
    relations: { evento: true },
    where: { evento: { tenantId, animalId, tipo: 'TRATAMIENTO', revertido: false } },
  });
  const producciones = await manager.find(EventoProduccionLeche, {
    relations: { evento: true },
    where: { evento: { tenantId, animalId, tipo: 'PRODUCCION_LECHE', revertido: false } },
  });
  const corregidas: ProduccionCorregida[] = [];
  for (const detalle of producciones) {
    const fecha = detalle.evento.fechaEvento;
    const nueva = resolverDisposicion(tratamientos.map((t) => ({
      eventoId: t.eventoId,
      fechaAplicacion: t.evento.fechaEvento,
      fechaLiberacionLeche: t.fechaLiberacionLeche,
    })), fecha);
    if (nueva.disposicion === detalle.disposicion && nueva.tratamientoEventoId === detalle.tratamientoEventoId) continue;
    const original = detalle.evento;
    original.revertido = true;
    await manager.save(Evento, original);
    const version = await manager.save(Evento, manager.create(Evento, {
      tenantId,
      animalId,
      tipo: 'PRODUCCION_LECHE',
      fechaEvento: fecha,
      usuarioId,
      revertido: false,
      eventoCorrigeId: original.id,
      notas: `Reconciliación sanitaria (${motivo})${original.notas ? ` · ${original.notas}` : ''}`,
    }));
    await manager.save(EventoProduccionLeche, manager.create(EventoProduccionLeche, {
      eventoId: version.id,
      turno: detalle.turno,
      litros: detalle.litros,
      disposicion: nueva.disposicion,
      tratamientoEventoId: nueva.tratamientoEventoId,
    }));
    corregidas.push({
      idAnterior: original.id,
      idNuevo: version.id,
      disposicionAnterior: detalle.disposicion,
      disposicionNueva: nueva.disposicion,
    });
  }
  return corregidas;
}
