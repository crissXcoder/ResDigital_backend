import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { RolUsuario } from '../interfaces/authenticated-user.interface.js';

export const ROLES_KEY = 'roles';

/**
 * Decorador para especificar los roles permitidos en un controlador o ruta.
 * Ejemplo: @Roles('propietario', 'administrador')
 */
export const Roles = (...roles: RolUsuario[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);
