import {
  createParamDecorator,
  type ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { RequestWithRls } from '../interceptors/rls-transaction.interceptor.js';

/**
 * Decorador para inyectar el EntityManager transaccional con RLS activo (request.entityManager).
 * Garantiza que las operaciones se ejecuten dentro de la transacción con 'SET LOCAL ROLE authenticated'
 * y las claims del JWT cargadas.
 */
export const CurrentEntityManager = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): EntityManager => {
    const request = ctx.switchToHttp().getRequest<RequestWithRls>();
    const entityManager = request.entityManager;

    if (!entityManager) {
      throw new InternalServerErrorException(
        'RlsTransactionInterceptor no inicializó el EntityManager transaccional para esta petición.',
      );
    }

    return entityManager;
  },
);
