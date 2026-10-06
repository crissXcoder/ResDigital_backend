import {
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';

/**
 * Decorador de parámetro para inyectar el usuario autenticado (request.user) tipado.
 * Ejemplo: getPerfil(@CurrentUser() user: AuthenticatedUser)
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
