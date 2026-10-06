import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';
import {
  RlsTransactionInterceptor,
  type RequestWithRls,
  registerAfterRollbackCallback,
} from '../interceptors/rls-transaction.interceptor.js';

const validIdentity = {
  session_role: 'resdigital_app',
  current_role: 'resdigital_app',
  is_superuser: false,
  bypasses_rls: false,
  has_role_memberships: false,
  can_create_public: false,
  owns_public_table: false,
};

function createInterceptor(identity = validIdentity) {
  const query = vi.fn().mockResolvedValue(undefined);
  const createQueryRunner = vi.fn();
  const runner = {
    connect: vi.fn().mockResolvedValue(undefined),
    startTransaction: vi.fn().mockResolvedValue(undefined),
    query,
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    isTransactionActive: true,
    isReleased: false,
    data: {},
    manager: {},
  } as unknown as QueryRunner;
  const dataSource = {
    isInitialized: true,
    query: vi.fn().mockResolvedValue([identity]),
    createQueryRunner: createQueryRunner.mockReturnValue(runner),
  } as unknown as DataSource;

  return {
    interceptor: new RlsTransactionInterceptor(dataSource),
    dataSource,
    createQueryRunner,
    runner,
    query,
  };
}

function createContext(user?: AuthenticatedUser) {
  const request: RequestWithRls = { user } as RequestWithRls;
  return {
    request,
    context: {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as never,
  };
}

const authenticatedUser: AuthenticatedUser = {
  userId: 'd9428888-122b-4a0a-9c01-4d4b4ac91da9',
  tenantId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  rol: 'propietario',
  email: 'owner@example.test',
  rawClaims: {
    sub: 'untrusted-sub',
    tenant_id: 'untrusted-tenant',
    role: 'user',
  },
};

describe('RlsTransactionInterceptor', () => {
  it('refuses to start when the connection bypasses RLS or owns domain tables', async () => {
    const { interceptor } = createInterceptor({
      ...validIdentity,
      bypasses_rls: true,
    });

    await expect(interceptor.onModuleInit()).rejects.toThrow(
      /DATABASE_URL debe autenticar directamente como resdigital_app/,
    );
  });

  it('sets a normalized tenant claim and the dedicated database role per request', async () => {
    const { interceptor, query } = createInterceptor();
    const { context, request } = createContext(authenticatedUser);
    const next = { handle: () => of('ok') } as never;

    await interceptor.onModuleInit();
    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toBe('ok');

    expect(query).toHaveBeenCalledWith('SET LOCAL ROLE resdigital_app;');
    const claimsCall = query.mock.calls.find(
      ([, parameters]) => parameters?.[0] === 'request.jwt.claims',
    );
    expect(JSON.parse(claimsCall?.[1]?.[1] as string)).toMatchObject({
      sub: authenticatedUser.userId,
      tenant_id: authenticatedUser.tenantId,
      rol: authenticatedUser.rol,
    });
    expect(request.entityManager).toBeDefined();
  });

  it('rejects missing or invalid tenant context before opening a database connection', () => {
    const { interceptor, createQueryRunner } = createInterceptor();
    const { context } = createContext({ ...authenticatedUser, tenantId: '' });

    expect(() =>
      interceptor.intercept(context, { handle: () => of('unsafe') } as never),
    ).toThrow(ForbiddenException);
    expect(createQueryRunner).not.toHaveBeenCalled();
  });

  it('runs storage compensation only after transaction rollback', async () => {
    const { interceptor, runner } = createInterceptor();
    const { context } = createContext(authenticatedUser);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    Object.assign(runner.manager, { queryRunner: runner });
    const next = {
      handle: () => {
        registerAfterRollbackCallback(
          (runner.manager as EntityManager),
          cleanup,
        );
        return throwError(() => new Error('simulated handler failure'));
      },
    } as never;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow('simulated handler failure');
    expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('preserves the stored object when the commit outcome is ambiguous', async () => {
    const { interceptor, runner } = createInterceptor();
    const { context } = createContext(authenticatedUser);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    Object.assign(runner.manager, { queryRunner: runner });
    vi.mocked(runner.commitTransaction).mockRejectedValueOnce(
      new Error('simulated connection loss during commit'),
    );
    const next = {
      handle: () => {
        registerAfterRollbackCallback(runner.manager as EntityManager, cleanup);
        return of('response');
      },
    } as never;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow('simulated connection loss during commit');
    expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
  });
});
