import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Request } from 'express';
import {
  Controller,
  Get,
  Module,
  UseGuards,
  type INestApplication,
} from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { rateLimit } from 'express-rate-limit';
import { generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { createRateLimitKey } from '../rate-limit-key.js';
import { AuthGuard } from '../guards/auth.guard.js';
import type { SupabaseJwtService } from '../services/supabase-jwt.service.js';

const userA = '8067e391-02ee-42bc-a85c-aeadc2e5c70f';
const userB = 'fe1e27c7-9cd8-405a-9113-b8a3db051fca';
const proxyAddress = '10.0.0.2';

function request(token?: string, forwardedAddress?: string): Request {
  return {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'x-forwarded-for': forwardedAddress,
      'x-real-ip': forwardedAddress,
    },
    socket: { remoteAddress: proxyAddress },
  } as unknown as Request;
}

describe('rate limit key with verified identity', () => {
  let key: ReturnType<typeof createRateLimitKey>;
  let tokenA: string;
  let renewedTokenA: string;
  let tokenB: string;
  let invalidSubjectToken: string;
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const sign = (subject: string, id: string) =>
      new SignJWT({
        tenant_id: 'f4cd22ae-032d-4dfb-8d96-83392f449089',
        rol: 'administrador',
      })
        .setProtectedHeader({ alg: 'ES256' })
        .setSubject(subject)
        .setJti(id)
        .setExpirationTime('5m')
        .sign(privateKey);
    [tokenA, renewedTokenA, tokenB, invalidSubjectToken] = await Promise.all([
      sign(userA, 'initial'),
      sign(userA, 'renewed'),
      sign(userB, 'initial'),
      sign('not-a-uuid', 'invalid-subject'),
    ]);
    const verifier: Pick<SupabaseJwtService, 'verifyToken'> = {
      verifyToken: async (token) =>
        (await jwtVerify(token, publicKey, { algorithms: ['ES256'] })).payload,
    };
    key = createRateLimitKey(verifier);
    const guard = new AuthGuard(
      new Reflector(),
      verifier as SupabaseJwtService,
    );
    @Controller()
    class RateLimitedController {
      @Get('/data')
      @UseGuards(guard)
      getData() {
        return { ok: true };
      }
    }
    @Module({
      controllers: [RateLimitedController],
    })
    class RateLimitTestModule {}
    app = await NestFactory.create(RateLimitTestModule, {
      abortOnError: false,
    });
    app.use(rateLimit({ windowMs: 60000, limit: 2, keyGenerator: key }));
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/data`;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('separates two verified users arriving through the same proxy', async () => {
    expect(await key(request(tokenA))).not.toBe(await key(request(tokenB)));
  });

  it('keeps the same counter when a verified user renews the token', async () => {
    expect(await key(request(tokenA))).toBe(await key(request(renewedTokenA)));
  });

  it('does not let forwarded headers change a verified user counter', async () => {
    expect(await key(request(tokenA, '198.51.100.10'))).toBe(
      await key(request(tokenA, '203.0.113.10')),
    );
  });

  it('does not use the subject of a JWT with a forged signature', async () => {
    const parts = tokenA.split('.');
    const forged = `${parts[0]}.${parts[1]}.invalid`;
    expect(await key(request(forged))).toBe(await key(request()));
    expect(await key(request(forged))).not.toBe(await key(request(tokenA)));
  });

  it('does not let forwarded headers split an anonymous counter', async () => {
    expect(await key(request(undefined, '198.51.100.10'))).toBe(
      await key(request(undefined, '203.0.113.10')),
    );
  });

  it('does not grant an identity to a signed token without a UUID subject', async () => {
    expect(await key(request(invalidSubjectToken))).toBe(await key(request()));
  });

  it('enforces separate HTTP counters and preserves the real AuthGuard rejection', async () => {
    const get = async (token?: string, forwarded = '198.51.100.10') => {
      const response = await fetch(url, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'X-Forwarded-For': forwarded,
          'X-Real-IP': forwarded,
        },
        signal: AbortSignal.timeout(5000),
      });
      await response.text();
      return response.status;
    };
    expect(await get(tokenA)).toBe(200);
    expect(await get(renewedTokenA)).toBe(200);
    expect(await get(tokenA, '203.0.113.10')).toBe(429);
    expect(await get(tokenB)).toBe(200);
    expect(await get()).toBe(401);
    expect(await get('invalid', '203.0.113.10')).toBe(401);
    expect(await get('another-invalid', '192.0.2.10')).toBe(429);
  });
});
