import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';

const jwtVerify = vi.hoisted(() => vi.fn());
const createRemoteJWKSet = vi.hoisted(() => vi.fn(() => 'jwks-keyset'));

vi.mock('jose', () => ({
  jwtVerify,
  createRemoteJWKSet,
}));

import { SupabaseJwtService } from '../services/supabase-jwt.service.js';

describe('SupabaseJwtService', () => {
  let service: SupabaseJwtService;

  beforeEach(() => {
    jwtVerify.mockReset();
    createRemoteJWKSet.mockClear();
    service = new SupabaseJwtService({
      get: (key: string) =>
        key === 'SUPABASE_URL' ? 'https://demo.supabase.co/' : undefined,
    } as ConfigService);
    service.onModuleInit();
  });

  it('verifica ES256 contra el JWKS, el emisor del proyecto y la audiencia authenticated', async () => {
    jwtVerify.mockResolvedValue({ payload: { sub: 'user-1', aud: 'authenticated' } });

    await expect(service.verifyToken('token')).resolves.toMatchObject({
      sub: 'user-1',
    });
    expect(createRemoteJWKSet).toHaveBeenCalledWith(
      new URL('https://demo.supabase.co/auth/v1/.well-known/jwks.json'),
    );
    expect(jwtVerify).toHaveBeenCalledWith('token', 'jwks-keyset', {
      algorithms: ['ES256'],
      issuer: 'https://demo.supabase.co/auth/v1',
      audience: 'authenticated',
    });
  });
});
