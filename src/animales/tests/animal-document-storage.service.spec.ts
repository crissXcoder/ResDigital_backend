import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AnimalDocumentStorageService } from '../animal-document-storage.service.js';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

const PDF_SIGNATURE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

function createService(file: Blob | null) {
  const remove = vi.fn().mockResolvedValue({ error: null });
  const download = vi.fn().mockResolvedValue({
    data: file,
    error: file ? null : new Error('missing'),
  });
  vi.mocked(createClient).mockReturnValue({
    storage: { from: () => ({ download, remove }) },
  } as never);
  const config = new ConfigService({
    SUPABASE_URL: 'https://storage.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-key',
  });
  return {
    service: new AnimalDocumentStorageService(config),
    download,
    remove,
  };
}

describe('AnimalDocumentStorageService', () => {
  it('accepts PDF bytes and rejects extension/content mismatch', async () => {
    const { service } = createService(new Blob([PDF_SIGNATURE]));
    await expect(
      service.validateObject('tenant/animal/categoria/documento.pdf'),
    ).resolves.toBeUndefined();
    await expect(
      service.validateObject('tenant/animal/categoria/documento.png'),
    ).rejects.toThrow(/contenido.*no coincide/i);
  });

  it('rejects an empty file and a file over the configured 10 MiB maximum', async () => {
    const empty = createService(new Blob([]));
    await expect(
      empty.service.validateObject('tenant/animal/categoria/documento.pdf'),
    ).rejects.toThrow(/vacío/i);

    const oversized = createService(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]));
    await expect(
      oversized.service.validateObject('tenant/animal/categoria/documento.pdf'),
    ).rejects.toThrow(/supera el límite/i);
  });

  it('removes only the exact object path requested for compensation', async () => {
    const { service, remove } = createService(null);
    await service.removeObject('tenant/animal/categoria/documento.pdf');
    expect(remove).toHaveBeenCalledWith(['tenant/animal/categoria/documento.pdf']);
  });
});
