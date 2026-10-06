import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Medicamento } from './entities/medicamento.entity.js';
import { Padecimiento } from './entities/padecimiento.entity.js';

export const MEDICAMENTOS_BASE: Omit<Medicamento, 'id' | 'tenantId'>[] = [
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

export const PADECIMIENTOS_BASE = [
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

/**
 * Servicio de lectura para los catálogos sanitarios.
 * Filtra siempre por `tenant_id` del usuario autenticado.
 * Si DataSource no está inicializado, opera en modo catálogo base en memoria (mismo patrón que AuthModule).
 */
/**
 * Catálogos sanitarios.
 *
 * Cambio importante respecto de la versión anterior: los errores de base de
 * datos ya NO se convierten en un catálogo en memoria.
 *
 * Antes, cualquier fallo (incluido el `EntityMetadataNotFoundError` que se
 * producía siempre, porque SanitaryModule no registraba sus entidades) se
 * atrapaba con un `logger.warn` y se devolvía el catálogo base con UUID
 * inventados. El endpoint respondía 200 y nadie se enteraba de que jamás estaba
 * leyendo la base: un fallo permanente disfrazado de funcionamiento normal.
 *
 * Ahora se distinguen los dos casos:
 *  - Error de consulta: se registra y se propaga. El filtro global lo traduce.
 *  - Tabla vacía: se devuelve el catálogo de referencia con una advertencia,
 *    porque una finca recién creada todavía no tiene catálogo propio y dejar la
 *    pantalla en blanco no ayuda a nadie. Se resuelve con `pnpm seed:sanitary`.
 */
@Injectable()
export class SanitaryService {
  private readonly logger = new Logger(SanitaryService.name);

  async getMedicamentos(
    tenantId: string,
    manager: EntityManager,
  ): Promise<Medicamento[]> {
    const medicamentos = await manager.find(Medicamento, {
      where: { tenantId },
      order: { nombreComercial: 'ASC' },
    });

    if (medicamentos.length > 0) return medicamentos;

    this.logger.warn(
      `La finca ${tenantId} no tiene medicamentos en catalogo_medicamento. Se devuelve el catálogo de referencia; para persistirlo, correr 'pnpm seed:sanitary'.`,
    );
    return this.catalogoBaseMedicamentos(tenantId);
  }

  async getPadecimientos(
    tenantId: string,
    manager: EntityManager,
  ): Promise<Padecimiento[]> {
    const padecimientos = await manager.find(Padecimiento, {
      where: { tenantId },
      relations: { medicamentoSugerido: true },
      order: { nombre: 'ASC' },
    });

    if (padecimientos.length > 0) return padecimientos;

    this.logger.warn(
      `La finca ${tenantId} no tiene padecimientos en catalogo_padecimiento. Se devuelve el catálogo de referencia; para persistirlo, correr 'pnpm seed:sanitary'.`,
    );

    const meds = this.catalogoBaseMedicamentos(tenantId);
    return PADECIMIENTOS_BASE.map((p, index) => {
      const suggestedMed = p.medicamentoSugeridoNombre
        ? meds.find((m) => m.nombreComercial === p.medicamentoSugeridoNombre) ||
          null
        : null;

      return {
        id: `00000000-0000-0000-0000-00000000010${index}`,
        tenantId,
        nombre: p.nombre,
        categoria: p.categoria,
        medicamentoSugeridoId: suggestedMed?.id || null,
        medicamentoSugerido: suggestedMed,
      };
    }) as Padecimiento[];
  }

  /** Catálogo de referencia (valores de Reglas-de-Negocio-Ganaderas.md). */
  private catalogoBaseMedicamentos(tenantId: string): Medicamento[] {
    return MEDICAMENTOS_BASE.map((m, index) => ({
      id: `00000000-0000-0000-0000-00000000000${index + 1}`,
      tenantId,
      ...m,
    })) as Medicamento[];
  }
}
