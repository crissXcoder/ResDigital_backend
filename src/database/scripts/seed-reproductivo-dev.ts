/**
 * ==============================================================================
 * ResDigital — MOD-03 Reproductivo: Seed de Datos de Prueba para Dashboard
 * ==============================================================================
 *
 * Propósito: insertar eventos reproductivos de prueba para que el feed
 * "Calendario Reproductivo" del Dashboard de Karla (MOD-04) muestre datos
 * reales en lugar del mock vacío.
 *
 * Qué inserta (idempotente — se puede correr más de una vez sin duplicar):
 *   - Lola  (#101, Holstein) → Servicio + Diagnóstico Preñada → Palpación en ~4 días
 *   - Manchas (#102, Holstein) → Servicio + Diagnóstico Preñada → Parto en ~11 días
 *
 * Prerequisito: haber corrido seed-dev.ts primero (crea tenant, usuarios y animales).
 *
 * Cómo correr:
 *   cd backend
 *   npx tsx src/database/scripts/seed-reproductivo-dev.ts
 *
 * ADVERTENCIA: SOLO PARA DESARROLLO LOCAL. NUNCA EJECUTAR EN PRODUCCIÓN.
 * ==============================================================================
 */

import { createClient } from '@supabase/supabase-js';

if (process.env.NODE_ENV === 'production') {
  console.error(
    '❌ Intento de ejecutar seed de reproductivo en PRODUCCIÓN. Abortando.',
  );
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '❌ Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el .env',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Devuelve YYYY-MM-DD sumando `dias` a hoy (negativo = pasado). */
function fechaRelativa(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

async function runSeed() {
  console.log(
    '\n==========================================================================',
  );
  console.log(
    '     🐄 RESDIGITAL — SEED REPRODUCTIVO DEV (para Dashboard de Karla)    ',
  );
  console.log(
    '==========================================================================',
  );

  // ── 1. Obtener tenant y usuario propietario ──────────────────────────────────
  const { data: tenantRow } = await supabase
    .from('tenant')
    .select('id')
    .eq('nombre_finca', 'Finca Demo ResDigital')
    .maybeSingle();

  if (!tenantRow) {
    console.error(
      '❌ Tenant "Finca Demo ResDigital" no encontrado. Corré seed-dev.ts primero.',
    );
    process.exit(1);
  }
  const tenantId = tenantRow.id;
  console.log(`✅ Tenant encontrado: ${tenantId}`);

  const { data: usuarioRow } = await supabase
    .from('usuario')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('rol', 'propietario')
    .maybeSingle();

  if (!usuarioRow) {
    console.error(
      '❌ Usuario propietario no encontrado. Corré seed-dev.ts primero.',
    );
    process.exit(1);
  }
  const usuarioId = usuarioRow.id;
  console.log(`✅ Usuario propietario encontrado: ${usuarioId}`);

  // ── 2. Obtener animales hembra ───────────────────────────────────────────────
  const { data: animales } = await supabase
    .from('animal')
    .select('id, nombre, arete_interno')
    .eq('tenant_id', tenantId)
    .eq('sexo', 'Hembra')
    .eq('activo', true)
    .in('arete_interno', ['101', '102']);

  if (!animales || animales.length === 0) {
    console.error(
      '❌ No se encontraron animales Lola (#101) ni Manchas (#102). Corré seed-dev.ts primero.',
    );
    process.exit(1);
  }

  const lola = animales.find((a) => a.arete_interno === '101');
  const manchas = animales.find((a) => a.arete_interno === '102');
  console.log(
    `✅ Animales encontrados: ${animales.map((a) => `${a.nombre} (#${a.arete_interno})`).join(', ')}`,
  );

  // ── 3. Helper: insertar servicio + diagnóstico preñada ───────────────────────
  /**
   * Inserta un evento SERVICIO y un evento DIAGNOSTICO (Preñada) para un animal,
   * calculando todos los hitos a partir de la fecha de servicio y los días de
   * gestación de la raza (Holstein = 281 días).
   *
   * Es idempotente: si ya existe un SERVICIO para ese animal con esa fecha, lo omite.
   */
  async function insertarServicioYDiagnostico(params: {
    animalId: string;
    nombreAnimal: string;
    fechaServicio: string; // YYYY-MM-DD
    diasGestacion: number; // de la raza
    etiqueta: string; // para logs
  }) {
    const { animalId, nombreAnimal, fechaServicio, diasGestacion, etiqueta } =
      params;

    // Idempotencia: verificar si ya existe servicio para este animal en esta fecha
    const { data: existente } = await supabase
      .from('evento')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('animal_id', animalId)
      .eq('tipo', 'SERVICIO')
      .eq('fecha_evento', fechaServicio)
      .maybeSingle();

    if (existente) {
      console.log(
        `ℹ️  [${etiqueta}] Servicio del ${fechaServicio} ya existe (ID: ${existente.id}). Omitiendo.`,
      );
      return;
    }

    // Calcular hitos a partir de fechaServicio + diasGestacion
    const fServicio = new Date(fechaServicio);

    const addDias = (base: Date, d: number): string => {
      const r = new Date(base);
      r.setDate(r.getDate() + d);
      return r.toISOString().split('T')[0];
    };

    const fpp = addDias(fServicio, diasGestacion);
    const palpacionFecha = addDias(fServicio, 40);
    const secadoFecha = addDias(new Date(fpp), -60);
    const avisoPartoFecha = addDias(new Date(fpp), -15);
    const avisoPartoUrgenteFecha = addDias(new Date(fpp), -3);

    // Insertar evento base SERVICIO
    const { data: eventoServicio, error: errServicio } = await supabase
      .from('evento')
      .insert({
        tenant_id: tenantId,
        animal_id: animalId,
        tipo: 'SERVICIO',
        fecha_evento: fechaServicio,
        usuario_id: usuarioId,
        revertido: false,
        notas: 'Insertado por seed-reproductivo-dev.ts',
      })
      .select('id')
      .single();

    if (errServicio || !eventoServicio) {
      console.error(
        `❌ [${etiqueta}] Error al insertar evento SERVICIO:`,
        errServicio?.message,
      );
      return;
    }

    // Insertar detalle evento_servicio
    const { error: errDetServicio } = await supabase
      .from('evento_servicio')
      .insert({
        evento_id: eventoServicio.id,
        tipo_servicio: 'Inseminación Artificial',
        toro_o_pajilla: 'Pajilla Demo (SEED)',
        responsable: null,
        fpp,
        palpacion_fecha: palpacionFecha,
        secado_fecha: secadoFecha,
        aviso_parto_fecha: avisoPartoFecha,
        aviso_parto_urgente_fecha: avisoPartoUrgenteFecha,
      });

    if (errDetServicio) {
      console.error(
        `❌ [${etiqueta}] Error al insertar evento_servicio:`,
        errDetServicio.message,
      );
      return;
    }
    console.log(
      `✅ [${etiqueta}] Servicio insertado → FPP: ${fpp}, Palpación: ${palpacionFecha}`,
    );

    // Insertar evento base DIAGNOSTICO
    const { data: eventoDiag, error: errDiag } = await supabase
      .from('evento')
      .insert({
        tenant_id: tenantId,
        animal_id: animalId,
        tipo: 'DIAGNOSTICO',
        fecha_evento: addDias(fServicio, 5), // diagnóstico 5 días después del servicio
        usuario_id: usuarioId,
        revertido: false,
        notas: 'Diagnóstico positivo — insertado por seed-reproductivo-dev.ts',
      })
      .select('id')
      .single();

    if (errDiag || !eventoDiag) {
      console.error(
        `❌ [${etiqueta}] Error al insertar evento DIAGNOSTICO:`,
        errDiag?.message,
      );
      return;
    }

    // Insertar detalle evento_diagnostico
    const { error: errDetDiag } = await supabase
      .from('evento_diagnostico')
      .insert({
        evento_id: eventoDiag.id,
        evento_servicio_id: eventoServicio.id,
        metodo: 'Palpación',
        resultado: 'Preñada',
      });

    if (errDetDiag) {
      console.error(
        `❌ [${etiqueta}] Error al insertar evento_diagnostico:`,
        errDetDiag.message,
      );
      return;
    }
    console.log(`✅ [${etiqueta}] Diagnóstico "Preñada" insertado.`);
    console.log(
      `   └─ ${nombreAnimal} aparecerá en el calendario con Palpación en ${palpacionFecha}`,
    );
  }

  // ── 4. Lola (#101): palpación en ~4 días ────────────────────────────────────
  // Para que la palpación caiga en +4 días, el servicio debe ser hace (40 - 4) = 36 días.
  if (lola) {
    await insertarServicioYDiagnostico({
      animalId: lola.id,
      nombreAnimal: lola.nombre,
      fechaServicio: fechaRelativa(-36), // hace 36 días → palpación en 4 días
      diasGestacion: 281, // Holstein
      etiqueta: `Lola #101`,
    });
  } else {
    console.warn('⚠️  Animal Lola (#101) no encontrado — omitiendo.');
  }

  // ── 5. Manchas (#102): parto en ~11 días ────────────────────────────────────
  // Para que el parto (FPP) caiga en +11 días, el servicio fue hace (281 - 11) = 270 días.
  if (manchas) {
    await insertarServicioYDiagnostico({
      animalId: manchas.id,
      nombreAnimal: manchas.nombre,
      fechaServicio: fechaRelativa(-270), // hace 270 días → FPP en 11 días
      diasGestacion: 281, // Holstein
      etiqueta: `Manchas #102`,
    });
  } else {
    console.warn('⚠️  Animal Manchas (#102) no encontrado — omitiendo.');
  }

  // ── 6. Fin ───────────────────────────────────────────────────────────────────
  console.log(
    '\n==========================================================================',
  );
  console.log('✅ Seed de reproductivo finalizado.');
  console.log('   Abrí el Dashboard en http://localhost:3000/dashboard');
  console.log(
    '   El "Calendario Reproductivo" debería mostrar a Lola y Manchas.',
  );
  console.log(
    '==========================================================================\n',
  );
}

runSeed().catch((err) => {
  console.error('❌ [FATAL] Error inesperado en seed-reproductivo-dev:', err);
  process.exit(1);
});
