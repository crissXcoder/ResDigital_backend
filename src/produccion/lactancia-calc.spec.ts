import { describe, it, expect } from 'vitest';
import { derivarLactancia, type EventoLactancia } from './lactancia-calc.js';

const ev = (
  id: string,
  tipo: EventoLactancia['tipo'],
  fechaEvento: string,
  extra: Partial<EventoLactancia> = {},
): EventoLactancia => ({
  id,
  tipo,
  fechaEvento,
  fechaRegistro: new Date(`${fechaEvento}T12:00:00Z`),
  ...extra,
});

describe('derivarLactancia', () => {
  it('un parto abre la lactancia', () => {
    expect(derivarLactancia([ev('p1', 'PARTO', '2026-08-01')], '2026-09-01')).toEqual({
      enLactancia: true,
      fechaInicio: '2026-08-01',
      eventoInicioId: 'p1',
    });
  });

  it('el secado la cierra solo desde su fecha', () => {
    const eventos = [ev('p1', 'PARTO', '2026-01-10'), ev('s1', 'SECADO', '2026-09-15')];
    expect(derivarLactancia(eventos, '2026-09-20').enLactancia).toBe(false);
    expect(derivarLactancia(eventos, '2026-09-10').enLactancia).toBe(true);
  });

  it('un aborto no abre la lactancia', () => {
    expect(
      derivarLactancia([ev('p1', 'PARTO', '2026-08-01', { esAborto: true })], '2026-09-01')
        .enLactancia,
    ).toBe(false);
  });

  it('un aborto posterior no cierra una lactancia abierta', () => {
    const eventos = [
      ev('i1', 'INICIO_LACTANCIA', '2026-05-01'),
      ev('p1', 'PARTO', '2026-08-01', { esAborto: true }),
    ];
    expect(derivarLactancia(eventos, '2026-09-01').eventoInicioId).toBe('i1');
  });

  it('ignora eventos revertidos', () => {
    expect(
      derivarLactancia([ev('p1', 'PARTO', '2026-08-01', { revertido: true })], '2026-09-01')
        .enLactancia,
    ).toBe(false);
  });

  it('sin eventos no está en lactancia', () => {
    expect(derivarLactancia([], '2026-09-01')).toEqual({
      enLactancia: false,
      fechaInicio: null,
      eventoInicioId: null,
    });
  });

  it('inicio y fin manuales abren y cierran', () => {
    const eventos = [
      ev('i1', 'INICIO_LACTANCIA', '2026-09-01'),
      ev('f1', 'FIN_LACTANCIA', '2026-09-20'),
    ];
    expect(derivarLactancia(eventos, '2026-09-10').fechaInicio).toBe('2026-09-01');
    expect(derivarLactancia(eventos, '2026-09-20').enLactancia).toBe(false);
  });

  it('con la misma fecha decide el registrado después', () => {
    const fin = ev('f1', 'FIN_LACTANCIA', '2026-09-10', {
      fechaRegistro: new Date('2026-09-10T08:00:00Z'),
    });
    const inicio = ev('i1', 'INICIO_LACTANCIA', '2026-09-10', {
      fechaRegistro: new Date('2026-09-10T09:00:00Z'),
    });
    expect(derivarLactancia([inicio, fin], '2026-09-10').enLactancia).toBe(true);
    expect(
      derivarLactancia(
        [inicio, { ...fin, fechaRegistro: new Date('2026-09-10T10:00:00Z') }],
        '2026-09-10',
      ).enLactancia,
    ).toBe(false);
  });
});
