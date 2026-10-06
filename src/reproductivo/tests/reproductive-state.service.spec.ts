import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  ReproductiveStateService,
  type EventoHistoricoReproductivo,
} from '../services/reproductive-state.service.js';
import { Evento } from '../../eventos/entities/evento.entity.js';
import { EventoServicio } from '../entities/evento-servicio.entity.js';
import { EventoDiagnostico } from '../entities/evento-diagnostico.entity.js';
import { EventoParto } from '../entities/evento-parto.entity.js';
import { EventoSecado } from '../entities/evento-secado.entity.js';
import { ReproductiveCalculationService } from '../services/reproductive-calculation.service.js';

describe('ReproductiveStateService (Máquina de Estados al Vuelo)', () => {
  let service: ReproductiveStateService;

  const mockVaca = {
    id: 'vaca-uuid-1',
    areteInterno: '104',
    sexo: 'Hembra',
    raza: { nombre: 'Holstein', diasGestacion: 281 },
  };

  const mockToro = {
    id: 'toro-uuid-1',
    areteInterno: '001',
    sexo: 'Macho',
    raza: { nombre: 'Brahman', diasGestacion: 293 },
  };

  beforeEach(() => {
    // Ya no recibe un DataSource: `calcularEstado` exige que le pasen el
    // EntityManager transaccional, así que el servicio no puede abrir conexiones
    // por su cuenta fuera del contexto RLS.
    service = new ReproductiveStateService(
      new ReproductiveCalculationService(),
    );
  });

  it('1. Estado inicial: Animal hembra sin eventos inicia en "Vacía"', () => {
    const estado = service.derivarEstadoDesdeEventos(mockVaca, []);
    expect(estado.estadoActual).toBe('Vacía');
    expect(estado.servicioActivo).toBeUndefined();
  });

  it('2. Validación de sexo: Animal macho arroja BadRequestException y no posee ciclo', () => {
    expect(() => service.derivarEstadoDesdeEventos(mockToro, [])).toThrow(
      BadRequestException,
    );
    expect(() => service.derivarEstadoDesdeEventos(mockToro, [])).toThrow(
      /no posee ciclo reproductivo/i,
    );
  });

  it('3. Servicio sin diagnóstico: deja el estado en "Servida", NUNCA en "Preñada"', () => {
    const evS: Evento = {
      id: 'evento-s1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'SERVICIO',
      fechaEvento: '2026-02-01',
      fechaRegistro: new Date('2026-02-01T10:00:00Z'),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const detS: EventoServicio = {
      eventoId: 'evento-s1',
      evento: evS,
      tipoServicio: 'Inseminación Artificial',
      toroOPajilla: 'Titan (CRC-B-001)',
      responsable: 'Dr. Veterinario',
      palpacionFecha: '2026-03-13',
      secadoFecha: '2026-09-10',
      avisoPartoFecha: '2026-10-25',
      avisoPartoUrgenteFecha: '2026-11-06',
      fpp: '2026-11-09',
    };

    const estado = service.derivarEstadoDesdeEventos(mockVaca, [
      { evento: evS, servicio: detS },
    ]);

    expect(estado.estadoActual).toBe('Servida');
    expect(estado.servicioActivo).toBeDefined();
    expect(estado.servicioActivo?.fpp).toBe('2026-11-09');
  });

  it('4. Diagnóstico positivo: confirma preñez y transiciona a "Preñada"', () => {
    const evS: Evento = {
      id: 's1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'SERVICIO',
      fechaEvento: '2026-01-01',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const detS: EventoServicio = {
      eventoId: 's1',
      evento: evS,
      tipoServicio: 'Monta Natural',
      toroOPajilla: 'Toro Campeón',
      responsable: 'Peón',
      palpacionFecha: '2026-02-10',
      secadoFecha: '2026-08-10',
      avisoPartoFecha: '2026-09-24',
      avisoPartoUrgenteFecha: '2026-10-06',
      fpp: '2026-10-09',
    };

    const evD: Evento = {
      id: 'd1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'DIAGNOSTICO',
      fechaEvento: '2026-02-10',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const detD: EventoDiagnostico = {
      eventoId: 'd1',
      evento: evD,
      eventoServicioId: 's1',
      eventoServicio: evS,
      metodo: 'Palpación',
      resultado: 'Preñada',
    };

    const estado = service.derivarEstadoDesdeEventos(mockVaca, [
      { evento: evS, servicio: detS },
      { evento: evD, diagnostico: detD },
    ]);

    expect(estado.estadoActual).toBe('Preñada');
    expect(estado.ultimoDiagnostico?.resultado).toBe('Preñada');
    // 'Aviso Parto Urgente' (FPP-3) es un hito propio, separado de 'Aviso Parto'
    // (FPP-15), tal como lo pide Reglas-de-Negocio-Ganaderas.md.
    expect(estado.proximosHitos?.map((h) => h.tipo)).toEqual([
      'Secado',
      'Aviso Parto',
      'Aviso Parto Urgente',
      'Parto FPP',
    ]);
  });

  it('5. Rama Diagnóstico Negativo: palpación inicial negativa retorna de "Servida" a "Vacía"', () => {
    const evS: Evento = {
      id: 's1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'SERVICIO',
      fechaEvento: '2026-01-01',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const detS: EventoServicio = {
      eventoId: 's1',
      evento: evS,
      tipoServicio: 'Inseminación Artificial',
      toroOPajilla: 'Pajilla-01',
      responsable: 'Dr. Vet',
      palpacionFecha: '2026-02-10',
      secadoFecha: '2026-08-10',
      avisoPartoFecha: '2026-09-24',
      avisoPartoUrgenteFecha: '2026-10-06',
      fpp: '2026-10-09',
    };

    const evD: Evento = {
      id: 'd1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'DIAGNOSTICO',
      fechaEvento: '2026-02-10',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: 'Diagnóstico negativo',
      animal: mockVaca as any,
    };
    const detD: EventoDiagnostico = {
      eventoId: 'd1',
      evento: evD,
      eventoServicioId: 's1',
      eventoServicio: evS,
      metodo: 'Palpación',
      resultado: 'Vacía',
    };

    const estado = service.derivarEstadoDesdeEventos(mockVaca, [
      { evento: evS, servicio: detS },
      { evento: evD, diagnostico: detD },
    ]);

    expect(estado.estadoActual).toBe('Vacía');
    expect(estado.servicioActivo).toBeUndefined();
    expect(estado.ultimoDiagnostico?.resultado).toBe('Vacía');
    expect(estado.proximosHitos).toEqual([]);
  });

  it('6. Rama Aborto / Pérdida Gestacional: Vaca diagnosticada "Preñada" sufre aborto detectado por diagnóstico posterior "Vacía"', () => {
    // Servicio
    const evS: Evento = {
      id: 's1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'SERVICIO',
      fechaEvento: '2026-01-01',
      fechaRegistro: new Date('2026-01-01T08:00:00Z'),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const detS: EventoServicio = {
      eventoId: 's1',
      evento: evS,
      tipoServicio: 'Inseminación Artificial',
      toroOPajilla: 'Pajilla-01',
      responsable: 'Dr. Vet',
      palpacionFecha: '2026-02-10',
      secadoFecha: '2026-08-10',
      avisoPartoFecha: '2026-09-24',
      avisoPartoUrgenteFecha: '2026-10-06',
      fpp: '2026-10-09',
    };

    // Primer diagnóstico a los 40 días: Preñada
    const evD1: Evento = {
      id: 'd1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'DIAGNOSTICO',
      fechaEvento: '2026-02-10',
      fechaRegistro: new Date('2026-02-10T09:00:00Z'),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: 'Gestación confirmada',
      animal: mockVaca as any,
    };
    const detD1: EventoDiagnostico = {
      eventoId: 'd1',
      evento: evD1,
      eventoServicioId: 's1',
      eventoServicio: evS,
      metodo: 'Ecografía',
      resultado: 'Preñada',
    };

    // Segundo diagnóstico a los 90 días tras sangrado: Pérdida embrionaria / Aborto detectado -> Vacía
    const evD2: Evento = {
      id: 'd2',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'DIAGNOSTICO',
      fechaEvento: '2026-04-01',
      fechaRegistro: new Date('2026-04-01T10:00:00Z'),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: 'Aborto confirmado por ecografía, útero vacío',
      animal: mockVaca as any,
    };
    const detD2: EventoDiagnostico = {
      eventoId: 'd2',
      evento: evD2,
      eventoServicioId: 's1',
      eventoServicio: evS,
      metodo: 'Ecografía',
      resultado: 'Vacía',
    };

    const historia: EventoHistoricoReproductivo[] = [
      { evento: evS, servicio: detS },
      { evento: evD1, diagnostico: detD1 },
      { evento: evD2, diagnostico: detD2 },
    ];

    const estado = service.derivarEstadoDesdeEventos(mockVaca, historia);

    expect(estado.estadoActual).toBe('Vacía');
    expect(estado.servicioActivo).toBeUndefined(); // Se canceló el ciclo
    expect(estado.ultimoDiagnostico?.eventoId).toBe('d2');
    expect(estado.ultimoDiagnostico?.resultado).toBe('Vacía');
    expect(estado.proximosHitos).toEqual([]);
  });

  it('7. Rama Aborto Tardío en Parto: Parto con facilidad "Aborto" culmina la gestación y regresa a "Vacía"', () => {
    const evS: Evento = {
      id: 's1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'SERVICIO',
      fechaEvento: '2026-01-01',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const detS: EventoServicio = {
      eventoId: 's1',
      evento: evS,
      tipoServicio: 'Inseminación Artificial',
      toroOPajilla: 'Pajilla',
      responsable: 'Vet',
      palpacionFecha: '2026-02-10',
      secadoFecha: '2026-08-10',
      avisoPartoFecha: '2026-09-24',
      avisoPartoUrgenteFecha: '2026-10-06',
      fpp: '2026-10-09',
    };

    const evD: Evento = {
      id: 'd1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'DIAGNOSTICO',
      fechaEvento: '2026-02-10',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const detD: EventoDiagnostico = {
      eventoId: 'd1',
      evento: evD,
      eventoServicioId: 's1',
      eventoServicio: evS,
      metodo: 'Palpación',
      resultado: 'Preñada',
    };

    const evP: Evento = {
      id: 'p1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'PARTO',
      fechaEvento: '2026-06-15',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: 'Feto expulsado prematuramente',
      animal: mockVaca as any,
    };
    const detP: EventoParto = {
      eventoId: 'p1',
      evento: evP,
      eventoServicioId: 's1',
      eventoServicio: evS,
      criaAnimalId: null,
      criaAnimal: null,
      facilidadParto: 'Aborto',
      observaciones: 'Aborto infeccioso en mes 5',
    };

    const estado = service.derivarEstadoDesdeEventos(mockVaca, [
      { evento: evS, servicio: detS },
      { evento: evD, diagnostico: detD },
      { evento: evP, parto: detP },
    ]);

    expect(estado.estadoActual).toBe('Vacía');
    expect(estado.servicioActivo).toBeUndefined();
    expect(estado.ultimoParto?.facilidadParto).toBe('Aborto');
  });

  it('8. Secado: transiciona formalmente a "En Secado" antes del parto', () => {
    const evS: Evento = {
      id: 's1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'SERVICIO',
      fechaEvento: '2026-01-01',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const detS: EventoServicio = {
      eventoId: 's1',
      evento: evS,
      tipoServicio: 'Monta Natural',
      toroOPajilla: 'Toro',
      responsable: 'Vet',
      palpacionFecha: '2026-02-10',
      secadoFecha: '2026-08-10',
      avisoPartoFecha: '2026-09-24',
      avisoPartoUrgenteFecha: '2026-10-06',
      fpp: '2026-10-09',
    };

    const evD: Evento = {
      id: 'd1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'DIAGNOSTICO',
      fechaEvento: '2026-02-10',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const detD: EventoDiagnostico = {
      eventoId: 'd1',
      evento: evD,
      eventoServicioId: 's1',
      eventoServicio: evS,
      metodo: 'Ecografía',
      resultado: 'Preñada',
    };

    const evSec: Evento = {
      id: 'sec1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'SECADO',
      fechaEvento: '2026-08-10',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const detSec: EventoSecado = { eventoId: 'sec1', evento: evSec };

    const estado = service.derivarEstadoDesdeEventos(mockVaca, [
      { evento: evS, servicio: detS },
      { evento: evD, diagnostico: detD },
      { evento: evSec, secado: detSec },
    ]);

    expect(estado.estadoActual).toBe('En Secado');
    expect(estado.servicioActivo).toBeDefined();
  });

  it('9. Evento de corrección: ignora el evento marcado revertido = true y computa exclusivamente con el nuevo', () => {
    // Evento original (erróneamente marcado como revertido)
    const evOriginal: Evento = {
      id: 'ev-erroneo',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'SERVICIO',
      fechaEvento: '2026-01-01',
      fechaRegistro: new Date('2026-01-01T08:00:00Z'),
      usuarioId: 'u1',
      revertido: true, // MARCADO REVERTIDO
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: 'Fecha incorrecta reportada',
      animal: mockVaca as any,
    };
    const detOriginal: EventoServicio = {
      eventoId: 'ev-erroneo',
      evento: evOriginal,
      tipoServicio: 'Monta Natural',
      toroOPajilla: 'Toro Equivocado',
      responsable: 'Peon 1',
      palpacionFecha: '2026-02-10',
      secadoFecha: '2026-08-10',
      avisoPartoFecha: '2026-09-24',
      avisoPartoUrgenteFecha: '2026-10-06',
      fpp: '2026-10-09',
    };

    // Evento de corrección activo
    const evCorregido: Evento = {
      id: 'ev-corregido',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'SERVICIO',
      fechaEvento: '2026-01-15',
      fechaRegistro: new Date('2026-01-16T08:00:00Z'),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: 'ev-erroneo',
      eventoCorrige: evOriginal,
      notas: 'Corrección con fecha real',
      animal: mockVaca as any,
    };
    const detCorregido: EventoServicio = {
      eventoId: 'ev-corregido',
      evento: evCorregido,
      tipoServicio: 'Inseminación Artificial',
      toroOPajilla: 'Titan-Correcto',
      responsable: 'Dr. Roberto',
      palpacionFecha: '2026-02-24',
      secadoFecha: '2026-08-24',
      avisoPartoFecha: '2026-10-08',
      avisoPartoUrgenteFecha: '2026-10-20',
      fpp: '2026-10-23',
    };

    const estado = service.derivarEstadoDesdeEventos(mockVaca, [
      { evento: evOriginal, servicio: detOriginal },
      { evento: evCorregido, servicio: detCorregido },
    ]);

    expect(estado.estadoActual).toBe('Servida');
    expect(estado.servicioActivo?.eventoId).toBe('ev-corregido');
    expect(estado.servicioActivo?.toroOPajilla).toBe('Titan-Correcto');
    expect(estado.servicioActivo?.fpp).toBe('2026-10-23');
  });

  it('10. Retorno de celo (segundo servicio sin diagnóstico previo) actualiza el ciclo activo con la nueva fecha', () => {
    const s1: Evento = {
      id: 's1',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'SERVICIO',
      fechaEvento: '2026-01-01',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const det1: EventoServicio = {
      eventoId: 's1',
      evento: s1,
      tipoServicio: 'Inseminación Artificial',
      toroOPajilla: 'Toro 1',
      responsable: 'Vet',
      palpacionFecha: '2026-02-10',
      secadoFecha: '2026-08-10',
      avisoPartoFecha: '2026-09-24',
      avisoPartoUrgenteFecha: '2026-10-06',
      fpp: '2026-10-09',
    };

    const s2: Evento = {
      id: 's2',
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo: 'SERVICIO',
      fechaEvento: '2026-01-22',
      fechaRegistro: new Date(),
      usuarioId: 'u1',
      revertido: false,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    };
    const det2: EventoServicio = {
      eventoId: 's2',
      evento: s2,
      tipoServicio: 'Inseminación Artificial',
      toroOPajilla: 'Toro 2',
      responsable: 'Vet',
      palpacionFecha: '2026-03-03',
      secadoFecha: '2026-09-01',
      avisoPartoFecha: '2026-10-15',
      avisoPartoUrgenteFecha: '2026-10-27',
      fpp: '2026-10-30',
    };

    const estado = service.derivarEstadoDesdeEventos(mockVaca, [
      { evento: s1, servicio: det1 },
      { evento: s2, servicio: det2 },
    ]);

    expect(estado.estadoActual).toBe('Servida');
    expect(estado.servicioActivo?.eventoId).toBe('s2');
    expect(estado.servicioActivo?.toroOPajilla).toBe('Toro 2');
    expect(estado.servicioActivo?.fpp).toBe('2026-10-30');
  });

  // ---------------------------------------------------------------------------
  // Fábricas para los casos de abajo.
  // ---------------------------------------------------------------------------

  const evento = (
    id: string,
    tipo: string,
    fechaEvento: string,
    revertido = false,
  ): Evento =>
    ({
      id,
      tenantId: 't1',
      animalId: mockVaca.id,
      tipo,
      fechaEvento,
      fechaRegistro: new Date(`${fechaEvento}T08:00:00Z`),
      usuarioId: 'u1',
      revertido,
      eventoCorrigeId: null,
      eventoCorrige: null,
      notas: null,
      animal: mockVaca as any,
    }) as Evento;

  const servicioDe = (ev: Evento): EventoServicio =>
    ({
      eventoId: ev.id,
      evento: ev,
      tipoServicio: 'Inseminación Artificial',
      toroOPajilla: 'Titan',
      responsable: 'Vet',
      palpacionFecha: '2026-02-10',
      secadoFecha: '2026-08-10',
      avisoPartoFecha: '2026-09-24',
      avisoPartoUrgenteFecha: '2026-10-06',
      fpp: '2026-10-09',
    }) as EventoServicio;

  const diagnosticoDe = (
    ev: Evento,
    resultado: 'Preñada' | 'Vacía',
  ): EventoDiagnostico =>
    ({
      eventoId: ev.id,
      evento: ev,
      eventoServicioId: 's1',
      eventoServicio: ev,
      metodo: 'Palpación',
      resultado,
    }) as EventoDiagnostico;

  const secadoDe = (ev: Evento): EventoSecado =>
    ({ eventoId: ev.id, evento: ev }) as EventoSecado;

  const partoDe = (ev: Evento): EventoParto =>
    ({
      eventoId: ev.id,
      evento: ev,
      eventoServicioId: 's1',
      eventoServicio: ev,
      criaAnimalId: null,
      criaAnimal: null,
      facilidadParto: 'Normal',
      observaciones: null,
    }) as EventoParto;

  describe('11. Hitos de aviso de parto (Reglas-de-Negocio-Ganaderas.md: dos alertas separadas)', () => {
    const cicloPrenada = () => {
      const evS = evento('s1', 'SERVICIO', '2026-01-01');
      const evD = evento('d1', 'DIAGNOSTICO', '2026-02-10');
      return [
        { evento: evS, servicio: servicioDe(evS) },
        { evento: evD, diagnostico: diagnosticoDe(evD, 'Preñada') },
      ];
    };

    it('caso normal: estando "Preñada" emite los DOS avisos de parto, y solo el de FPP-3 viene marcado urgente', () => {
      const estado = service.derivarEstadoDesdeEventos(
        mockVaca,
        cicloPrenada(),
        '2026-09-01',
      );

      const avisoNormal = estado.proximosHitos?.find(
        (h) => h.tipo === 'Aviso Parto',
      );
      const avisoUrgente = estado.proximosHitos?.find(
        (h) => h.tipo === 'Aviso Parto Urgente',
      );

      expect(avisoNormal?.fecha).toBe('2026-09-24'); // FPP - 15
      expect(avisoNormal?.urgente).toBe(false);

      expect(avisoUrgente?.fecha).toBe('2026-10-06'); // FPP - 3
      expect(avisoUrgente?.urgente).toBe(true);
    });

    it('caso límite: los dos avisos siguen presentes en estado "En Secado", no solo en "Preñada"', () => {
      const evSec = evento('sec1', 'SECADO', '2026-08-10');
      const estado = service.derivarEstadoDesdeEventos(
        mockVaca,
        [...cicloPrenada(), { evento: evSec, secado: secadoDe(evSec) }],
        '2026-09-01',
      );

      expect(estado.estadoActual).toBe('En Secado');
      expect(estado.proximosHitos?.map((h) => h.tipo)).toEqual([
        'Aviso Parto',
        'Aviso Parto Urgente',
        'Parto FPP',
      ]);
      expect(
        estado.proximosHitos?.filter((h) => h.urgente).map((h) => h.tipo),
      ).toEqual(['Aviso Parto Urgente']);
    });
  });

  describe('12. Eventos sin fila de detalle: no cambian el estado y dejan advertencia', () => {
    for (const tipo of ['SERVICIO', 'DIAGNOSTICO', 'PARTO', 'SECADO']) {
      it(`un evento ${tipo} sin detalle no altera el estado y genera exactamente una advertencia`, () => {
        const ev = evento(`x-${tipo}`, tipo, '2026-03-01');
        const estado = service.derivarEstadoDesdeEventos(mockVaca, [
          { evento: ev },
        ]);

        expect(estado.estadoActual).toBe('Vacía');
        expect(estado.advertencias).toHaveLength(1);
        expect(estado.advertencias?.[0]).toContain(
          'no tiene su fila de detalle',
        );
      });
    }

    it('caso límite: un SERVICIO sin detalle ya no deja el animal "Servida" sin hitos (regresión)', () => {
      const ev = evento('s-sin-detalle', 'SERVICIO', '2026-03-01');
      const estado = service.derivarEstadoDesdeEventos(mockVaca, [
        { evento: ev },
      ]);

      expect(estado.estadoActual).not.toBe('Servida');
      expect(estado.servicioActivo).toBeUndefined();
      expect(estado.proximosHitos).toEqual([]);
    });
  });

  describe('13. Higiene del ciclo tras el parto', () => {
    it('caso normal: el parto limpia ultimoSecado, para que no se arrastre al ciclo siguiente', () => {
      const evS = evento('s1', 'SERVICIO', '2026-01-01');
      const evD = evento('d1', 'DIAGNOSTICO', '2026-02-10');
      const evSec = evento('sec1', 'SECADO', '2026-08-10');
      const evP = evento('p1', 'PARTO', '2026-10-09');

      const estado = service.derivarEstadoDesdeEventos(mockVaca, [
        { evento: evS, servicio: servicioDe(evS) },
        { evento: evD, diagnostico: diagnosticoDe(evD, 'Preñada') },
        { evento: evSec, secado: secadoDe(evSec) },
        { evento: evP, parto: partoDe(evP) },
      ]);

      expect(estado.estadoActual).toBe('Vacía');
      expect(estado.ultimoSecado).toBeUndefined();
      expect(estado.servicioActivo).toBeUndefined();
      expect(estado.ultimoParto?.eventoId).toBe('p1');
    });

    it('caso límite: un secado sobre una vaca solo "Servida" no transiciona ni se registra', () => {
      const evS = evento('s1', 'SERVICIO', '2026-01-01');
      const evSec = evento('sec1', 'SECADO', '2026-03-01');

      const estado = service.derivarEstadoDesdeEventos(mockVaca, [
        { evento: evS, servicio: servicioDe(evS) },
        { evento: evSec, secado: secadoDe(evSec) },
      ]);

      expect(estado.estadoActual).toBe('Servida');
      expect(estado.ultimoSecado).toBeUndefined();
      expect(estado.advertencias?.[0]).toContain('preñez confirmada');
    });
  });

  describe('14. diasEnEstado', () => {
    it('caso normal: cuenta los días desde el evento que fijó el estado actual', () => {
      const evS = evento('s1', 'SERVICIO', '2026-02-01');
      const estado = service.derivarEstadoDesdeEventos(
        mockVaca,
        [{ evento: evS, servicio: servicioDe(evS) }],
        '2026-02-16',
      );
      expect(estado.diasEnEstado).toBe(15);
    });

    it('caso límite: el mismo día del evento da 0, no 1 ni undefined', () => {
      const evS = evento('s1', 'SERVICIO', '2026-02-01');
      const estado = service.derivarEstadoDesdeEventos(
        mockVaca,
        [{ evento: evS, servicio: servicioDe(evS) }],
        '2026-02-01',
      );
      expect(estado.diasEnEstado).toBe(0);
    });

    it('caso límite: sin ningún evento no hay fecha de referencia, así que queda indefinido', () => {
      const estado = service.derivarEstadoDesdeEventos(mockVaca, []);
      expect(estado.diasEnEstado).toBeUndefined();
    });
  });
});
