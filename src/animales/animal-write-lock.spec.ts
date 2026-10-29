import { expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { lockAnimalsForWrite } from './animal-write-lock.js';

it('bloquea un conjunto deduplicado en orden y siempre limita por tenant', async () => {
  const query = vi.fn().mockResolvedValue([]);
  const manager = { query } as unknown as EntityManager;
  await lockAnimalsForWrite(manager, 'finca-A', ['b', 'a', 'b']);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('tenant_id = $1'), ['finca-A', ['a', 'b']]);
  expect(query.mock.calls[0][0]).toContain('ORDER BY id FOR UPDATE');
  query.mockClear();
  await lockAnimalsForWrite(manager, 'finca-A', []);
  expect(query).not.toHaveBeenCalled();
});
