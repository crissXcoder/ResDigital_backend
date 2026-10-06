import { Injectable } from '@nestjs/common';
import { IsNull, type EntityManager } from 'typeorm';
import { CatalogoRaza } from './entities/catalogo-raza.entity.js';

@Injectable()
export class CatalogosService {
  /**
   * Catálogo híbrido de razas: las globales (tenant_id IS NULL) más las propias
   * de la finca que consulta.
   *
   * Antes este método usaba un `Repository` inyectado globalmente y sin ningún
   * filtro de tenant. Eso tenía dos problemas encadenados:
   *
   *  1. El repositorio global no pasa por la transacción del
   *     RlsTransactionInterceptor, así que no se ejecuta
   *     `SET LOCAL ROLE authenticated` ni se fija el contexto de tenant. La
   *     política `catalogo_raza_select_policy`, que es `TO authenticated`, ni
   *     siquiera se evalúa.
   *  2. Sin cláusula `where`, la consulta pedía todas las filas.
   *
   * Resultado: el endpoint devolvía también las razas privadas de otras fincas.
   * Ahora usa el EntityManager transaccional (RLS activo) y filtra de forma
   * explícita, siguiendo el patrón "filtro en la aplicación + RLS" del resto
   * del proyecto.
   */
  async findAllRazas(
    tenantId: string,
    manager: EntityManager,
  ): Promise<CatalogoRaza[]> {
    return manager.find(CatalogoRaza, {
      where: [{ tenantId: IsNull() }, { tenantId }],
      order: { nombre: 'ASC' },
    });
  }
}
