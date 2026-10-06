/**
 * ==============================================================================
 * ResDigital — MOD-02 Sanitario: Seed de Catálogos Veterinarios
 * ==============================================================================
 *
 * Inserta los medicamentos oficiales de Costa Rica y padecimientos comunes
 * asociados al tenant de desarrollo "Finca Demo ResDigital".
 *
 * Es IDEMPOTENTE: si los registros ya existen (por nombre_comercial + tenant_id),
 * no se duplican.
 *
 * Ejecución: pnpm --filter backend seed:sanitary
 * Requiere: que el seed:dev (MOD-00) haya corrido primero (tenant + usuarios).
 * ==============================================================================
 */

import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../data-source.js';

if (process.env.NODE_ENV === 'production') {
  console.error(
    '❌ [ERROR CRÍTICO] Intento de ejecutar seed:sanitary en ambiente de PRODUCCIÓN detectado.',
  );
  process.exit(1);
}

const NOMBRE_FINCA_DEMO = 'Finca Demo ResDigital';

/**
 * Valores de retiro verificados — fuente:
 * Obsidian → 02-Arquitectura/Reglas-de-Negocio-Ganaderas.md
 *
 * ┌─────────────────────────────────────────────────┬──────────┬──────────┐
 * │ Medicamento                                     │ Leche    │ Carne    │
 * ├─────────────────────────────────────────────────┼──────────┼──────────┤
 * │ Cefalexina 200 Intramamaria                     │  5 días  │  4 días  │
 * │ Oxitetraciclina L.A. 20%                        │  7 días  │ 28 días  │
 * │ Ivermectina 1%                                   │ 28 días  │ 35 días  │
 * │ Penicilina G Procaínica + Estreptomicina         │  4 días  │ 30 días  │
 * └─────────────────────────────────────────────────┴──────────┴──────────┘
 */
interface MedicamentoSeed {
  nombreComercial: string;
  principioActivo: string;
  viaAdministracion: string;
  diasRetiroLecheDefault: number;
  diasRetiroCarneDefault: number;
}

const MEDICAMENTOS_SEED: MedicamentoSeed[] = [
  {
    nombreComercial: 'Cefalexina 200 Intramamaria',
    principioActivo: 'Cefalexina',
    viaAdministracion: 'Intramamaria',
    diasRetiroLecheDefault: 5,
    diasRetiroCarneDefault: 4,
  },
  {
    nombreComercial: 'Oxitetraciclina L.A. 20%',
    principioActivo: 'Oxitetraciclina',
    viaAdministracion: 'Intramuscular',
    diasRetiroLecheDefault: 7,
    diasRetiroCarneDefault: 28,
  },
  {
    nombreComercial: 'Ivermectina 1%',
    principioActivo: 'Ivermectina',
    viaAdministracion: 'Subcutánea',
    diasRetiroLecheDefault: 28,
    diasRetiroCarneDefault: 35,
  },
  {
    nombreComercial: 'Penicilina G Procaínica + Estreptomicina',
    principioActivo: 'Penicilina G + Estreptomicina',
    viaAdministracion: 'Intramuscular',
    diasRetiroLecheDefault: 4,
    diasRetiroCarneDefault: 30,
  },
];

interface PadecimientoSeed {
  nombre: string;
  categoria: string;
  /** nombre_comercial del medicamento sugerido (se resuelve a UUID tras insertar medicamentos) */
  medicamentoSugeridoNombre: string | null;
}

const PADECIMIENTOS_SEED: PadecimientoSeed[] = [
  {
    nombre: 'Mastitis clínica',
    categoria: 'Ubre',
    medicamentoSugeridoNombre: 'Cefalexina 200 Intramamaria',
  },
  {
    nombre: 'Mastitis subclínica',
    categoria: 'Ubre',
    medicamentoSugeridoNombre: 'Cefalexina 200 Intramamaria',
  },
  {
    nombre: 'Anaplasmosis',
    categoria: 'Hemoparásito',
    medicamentoSugeridoNombre: 'Oxitetraciclina L.A. 20%',
  },
  {
    nombre: 'Parasitosis interna',
    categoria: 'Parasitario',
    medicamentoSugeridoNombre: 'Ivermectina 1%',
  },
  {
    nombre: 'Parasitosis externa (garrapatas/nuche)',
    categoria: 'Parasitario',
    medicamentoSugeridoNombre: 'Ivermectina 1%',
  },
  {
    nombre: 'Neumonía bacteriana',
    categoria: 'Respiratorio',
    medicamentoSugeridoNombre: 'Penicilina G Procaínica + Estreptomicina',
  },
  {
    nombre: 'Infección podal (gabarro)',
    categoria: 'Podal',
    medicamentoSugeridoNombre: 'Penicilina G Procaínica + Estreptomicina',
  },
  {
    nombre: 'Metritis/Endometritis',
    categoria: 'Reproductivo',
    medicamentoSugeridoNombre: null,
  },
  {
    nombre: 'Diarrea neonatal',
    categoria: 'Digestivo',
    medicamentoSugeridoNombre: null,
  },
  {
    nombre: 'Timpanismo (empaste)',
    categoria: 'Digestivo',
    medicamentoSugeridoNombre: null,
  },
];

async function runSanitarySeed() {
  console.log(
    '\n===============================================================================',
  );
  console.log(
    '       🏥 RESDIGITAL — SEED DE CATÁLOGOS SANITARIOS (MOD-02)                 ',
  );
  console.log(
    '===============================================================================\n',
  );

  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();
  console.log('✅ [OK] Conexión a PostgreSQL inicializada.\n');

  // 1. Resolver el tenant_id de la finca demo
  const tenantRows = await dataSource.query<{ id: string }[]>(
    `SELECT id FROM public.tenant WHERE nombre_finca = $1 LIMIT 1;`,
    [NOMBRE_FINCA_DEMO],
  );

  if (!tenantRows || tenantRows.length === 0) {
    console.error(
      `❌ [ERROR] No se encontró el tenant '${NOMBRE_FINCA_DEMO}'. Ejecute seed:dev primero.`,
    );
    await dataSource.destroy();
    process.exit(1);
  }

  const tenantId = tenantRows[0].id;
  console.log(`📍 Tenant demo encontrado: ${tenantId}\n`);

  // 2. Insertar medicamentos (idempotente por nombre_comercial + tenant_id)
  console.log('--- Paso 1: Insertando catálogo de medicamentos ---');
  const medicamentoIdMap = new Map<string, string>();

  for (const med of MEDICAMENTOS_SEED) {
    const existing = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM public.catalogo_medicamento
       WHERE tenant_id = $1 AND nombre_comercial = $2 LIMIT 1;`,
      [tenantId, med.nombreComercial],
    );

    if (existing && existing.length > 0) {
      medicamentoIdMap.set(med.nombreComercial, existing[0].id);
      console.log(
        `  ℹ️ [EXISTE] ${med.nombreComercial} → ${existing[0].id}`,
      );
    } else {
      const inserted = await dataSource.query<{ id: string }[]>(
        `INSERT INTO public.catalogo_medicamento
           (tenant_id, nombre_comercial, principio_activo, via_administracion,
            dias_retiro_leche_default, dias_retiro_carne_default)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id;`,
        [
          tenantId,
          med.nombreComercial,
          med.principioActivo,
          med.viaAdministracion,
          med.diasRetiroLecheDefault,
          med.diasRetiroCarneDefault,
        ],
      );
      medicamentoIdMap.set(med.nombreComercial, inserted[0].id);
      console.log(
        `  ✅ [CREADO] ${med.nombreComercial} (leche: ${med.diasRetiroLecheDefault}d, carne: ${med.diasRetiroCarneDefault}d) → ${inserted[0].id}`,
      );
    }
  }

  // 3. Insertar padecimientos (idempotente por nombre + tenant_id)
  console.log('\n--- Paso 2: Insertando catálogo de padecimientos ---');

  for (const pad of PADECIMIENTOS_SEED) {
    const existing = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM public.catalogo_padecimiento
       WHERE tenant_id = $1 AND nombre = $2 LIMIT 1;`,
      [tenantId, pad.nombre],
    );

    if (existing && existing.length > 0) {
      console.log(`  ℹ️ [EXISTE] ${pad.nombre} → ${existing[0].id}`);
      continue;
    }

    const medicamentoId = pad.medicamentoSugeridoNombre
      ? medicamentoIdMap.get(pad.medicamentoSugeridoNombre) ?? null
      : null;

    const inserted = await dataSource.query<{ id: string }[]>(
      `INSERT INTO public.catalogo_padecimiento
         (tenant_id, nombre, categoria, medicamento_sugerido_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id;`,
      [tenantId, pad.nombre, pad.categoria, medicamentoId],
    );
    const sugerido = pad.medicamentoSugeridoNombre
      ? ` → sugerido: ${pad.medicamentoSugeridoNombre}`
      : '';
    console.log(
      `  ✅ [CREADO] ${pad.nombre} (${pad.categoria})${sugerido} → ${inserted[0].id}`,
    );
  }

  // 4. Resumen
  const medCount = await dataSource.query<{ count: string }[]>(
    `SELECT COUNT(*) as count FROM public.catalogo_medicamento WHERE tenant_id = $1;`,
    [tenantId],
  );
  const padCount = await dataSource.query<{ count: string }[]>(
    `SELECT COUNT(*) as count FROM public.catalogo_padecimiento WHERE tenant_id = $1;`,
    [tenantId],
  );

  console.log('\n===============================================================================');
  console.log(
    `  📊 Resumen: ${medCount[0].count} medicamentos, ${padCount[0].count} padecimientos`,
  );
  console.log('===============================================================================\n');

  await dataSource.destroy();
  console.log('✅ Seed sanitario completado exitosamente.\n');
}

runSanitarySeed().catch((err) => {
  console.error('❌ Error fatal en seed sanitario:', err);
  process.exit(1);
});
