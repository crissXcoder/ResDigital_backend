import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { RolUsuario } from '../interfaces/authenticated-user.interface.js';
import { AuditAuthService } from './audit-auth.service.js';

const ROLES_PERMITIDOS: readonly RolUsuario[] = [
  'propietario',
  'administrador',
  'peon',
  'veterinario',
] as const;

/** Único servicio autorizado para mutar el rol asociado a un usuario. */
@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(private readonly auditService: AuditAuthService) {}

  async assignRole(
    userId: string,
    tenantId: string,
    rol: RolUsuario,
    modifiedBy: string | undefined,
    entityManager: EntityManager,
  ): Promise<void> {
    if (!ROLES_PERMITIDOS.includes(rol)) {
      throw new BadRequestException(
        `Rol '${rol}' inválido. Los roles permitidos son: ${ROLES_PERMITIDOS.join(', ')}`,
      );
    }
    if (!entityManager?.queryRunner?.isTransactionActive) {
      throw new Error(
        'La asignación de roles requiere una transacción PostgreSQL activa.',
      );
    }

    const result = await entityManager.query<{ id: string }[]>(
      `UPDATE public.usuario
          SET rol = $1
        WHERE id = $2 AND tenant_id = $3
      RETURNING id;`,
      [rol, userId, tenantId],
    );
    if (!result[0]) {
      throw new NotFoundException(
        'No se encontró el usuario dentro de la finca indicada.',
      );
    }

    await this.auditService.logEvent(
      tenantId,
      'CAMBIO_ROL',
      {
        userId,
        nuevoRol: rol,
        modificadoPor: modifiedBy || 'SISTEMA',
      },
      modifiedBy,
      entityManager,
    );

    this.logger.log(`Se actualizó el rol asignado: ${rol}.`);
  }
}
