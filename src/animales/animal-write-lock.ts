import type { EntityManager } from 'typeorm';

/** Compartido por todos los dominios: Animal ordenado antes de Evento/detalles. */
export async function lockAnimalsForWrite(manager: EntityManager, tenantId: string, animalIds: readonly string[]): Promise<void> {
  const ids = [...new Set(animalIds)].sort();
  if (ids.length === 0) return;
  await manager.query('SELECT id FROM animal WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE', [tenantId, ids]);
}
