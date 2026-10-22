import { describe, expect, it } from 'vitest';
import { aHistorialDto } from '../dto/responses/evento-reproductivo-historial.dto.js';
import type { EventoHistoricoReproductivo } from '../services/reproductive-state.service.js';
import type { Evento } from '../../eventos/entities/evento.entity.js';
import type { EventoParto } from '../entities/evento-parto.entity.js';
import type { Animal } from '../../animales/entities/animal.entity.js';

const eventoBase = (id: string): Evento =>
  ({
    id,
    tenantId: 't1',
    animalId: 'madre-1',
    tipo: 'PARTO',
    fechaEvento: '2026-09-10',
    fechaRegistro: new Date('2026-09-10T12:00:00Z'),
    usuarioId: 'u1',
    revertido: false,
    eventoCorrigeId: null,
    notas: null,
  }) as Evento;

describe('aHistorialDto — detalle de parto', () => {
  it('incluye id y arete de la cría cuando el vínculo está resuelto', () => {
    const dto = aHistorialDto({
      evento: eventoBase('p1'),
      parto: {
        eventoId: 'p1',
        eventoServicioId: null,
        criaAnimalId: 'cria-1',
        criaAnimal: { id: 'cria-1', areteInterno: 'CR-001' } as Animal,
        facilidadParto: 'Normal',
        observaciones: null,
      } as EventoParto,
    } as EventoHistoricoReproductivo);

    expect(dto.detalle).toMatchObject({
      criaAnimalId: 'cria-1',
      criaAreteInterno: 'CR-001',
      facilidadParto: 'Normal',
    });
  });

  it('no inventa cría cuando el parto no tiene animal vinculado', () => {
    const dto = aHistorialDto({
      evento: eventoBase('p2'),
      parto: {
        eventoId: 'p2',
        eventoServicioId: null,
        criaAnimalId: null,
        criaAnimal: null,
        facilidadParto: 'Aborto',
        observaciones: null,
      } as EventoParto,
    } as EventoHistoricoReproductivo);

    expect(dto.detalle).toMatchObject({
      criaAnimalId: null,
      criaAreteInterno: null,
      facilidadParto: 'Aborto',
    });
  });
});
