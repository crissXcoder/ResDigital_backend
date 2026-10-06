import {
  Injectable,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type {
  AuthenticatedUser,
  RolUsuario,
} from '../interfaces/authenticated-user.interface.js';
import type { InviteUserDto } from '../dto/invite-user.dto.js';
import { RolesService } from './roles.service.js';
import { AuditAuthService } from './audit-auth.service.js';
import { registerAfterCommitCallback } from '../interceptors/rls-transaction.interceptor.js';

export interface InvitacionRecord {
  id: string;
  tenantId: string;
  correo: string;
  rolPredefinido: RolUsuario;
  invitadoPor: string;
  estado: 'PENDIENTE' | 'ACEPTADA' | 'CANCELADA';
  createdAt: string;
}

export interface InviteUserResult {
  success: true;
  invitacionId: string;
  rolAsignado: RolUsuario;
  emailSent: boolean | null;
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly rolesService: RolesService,
    private readonly auditService: AuditAuthService,
    private readonly configService: ConfigService,
  ) {}

  async inviteUser(
    inviter: AuthenticatedUser,
    dto: InviteUserDto,
    entityManager: EntityManager,
  ): Promise<InviteUserResult> {
    if (inviter.rol !== 'propietario') {
      throw new ForbiddenException(
        'Solo el propietario tiene autorización para invitar usuarios a la finca.',
      );
    }
    this.requireTransactionManager(entityManager);

    const record: InvitacionRecord = {
      id: randomUUID(),
      tenantId: inviter.tenantId,
      correo: dto.correo.toLowerCase().trim(),
      rolPredefinido: dto.rol,
      invitadoPor: inviter.userId,
      estado: 'PENDIENTE',
      createdAt: new Date().toISOString(),
    };

    const persistedRows = await entityManager.query<{ id: string }[]>(
      `INSERT INTO public.invitacion (
        id, tenant_id, correo, rol, invitado_por, estado, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (correo, tenant_id) DO UPDATE
        SET rol = EXCLUDED.rol,
            invitado_por = EXCLUDED.invitado_por,
            estado = 'PENDIENTE'
      RETURNING id;`,
      [
        record.id,
        record.tenantId,
        record.correo,
        record.rolPredefinido,
        record.invitadoPor,
        record.estado,
        record.createdAt,
      ],
    );
    if (!persistedRows[0]?.id) {
      throw new Error('La base de datos no confirmó la invitación.');
    }
    record.id = persistedRows[0].id;

    await this.auditService.logEvent(
      inviter.tenantId,
      'INVITACION_ENVIADA',
      {
        correoInvitado: record.correo,
        rolAsignado: record.rolPredefinido,
        invitadoPor: inviter.userId,
      },
      inviter.userId,
      entityManager,
    );

    const result: InviteUserResult = {
      success: true,
      invitacionId: record.id,
      rolAsignado: record.rolPredefinido,
      emailSent: null,
    };

    registerAfterCommitCallback(entityManager, async () => {
      result.emailSent = await this.triggerSupabaseAdminInvite(
        record.correo,
        record.tenantId,
        record.rolPredefinido,
        dto.nombreCompleto,
      );
    });

    return result;
  }

  async confirmInvitation(
    invitedUserId: string,
    tenantId: string,
    correo: string,
    untrustedClientPayload: Record<string, unknown>,
    entityManager: EntityManager,
  ): Promise<{ success: true; userId: string; rolFinal: RolUsuario }> {
    this.requireTransactionManager(entityManager);
    if ('rol' in untrustedClientPayload && untrustedClientPayload['rol']) {
      this.logger.warn(
        'Se descartó un intento de asignar el rol desde el payload del cliente.',
      );
    }

    const cleanEmail = correo.toLowerCase().trim();
    const invitationRows = await entityManager.query<
      { id: string; rol: RolUsuario }[]
    >(
      `SELECT id, rol
         FROM public.invitacion
        WHERE correo = $1 AND tenant_id = $2 AND estado = 'PENDIENTE'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE;`,
      [cleanEmail, tenantId],
    );
    const invitation = invitationRows[0];
    if (!invitation) {
      throw new NotFoundException(
        'No se encontró una invitación pendiente válida para este correo y finca.',
      );
    }

    await this.rolesService.assignRole(
      invitedUserId,
      tenantId,
      invitation.rol,
      invitedUserId,
      entityManager,
    );

    const acceptedRows = await entityManager.query<{ id: string }[]>(
      `UPDATE public.invitacion
          SET estado = 'ACEPTADA'
        WHERE id = $1 AND tenant_id = $2 AND estado = 'PENDIENTE'
      RETURNING id;`,
      [invitation.id, tenantId],
    );
    if (!acceptedRows[0]) {
      throw new ConflictException(
        'La invitación ya fue procesada; actualizá la pantalla e intentá de nuevo.',
      );
    }

    await this.auditService.logEvent(
      tenantId,
      'INVITACION_ACEPTADA',
      {
        userId: invitedUserId,
        correo: cleanEmail,
        rolFinalAsignado: invitation.rol,
      },
      invitedUserId,
      entityManager,
    );

    return {
      success: true,
      userId: invitedUserId,
      rolFinal: invitation.rol,
    };
  }

  private async triggerSupabaseAdminInvite(
    correo: string,
    tenantId: string,
    rol: RolUsuario,
    nombreCompleto?: string,
  ): Promise<boolean> {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );

    if (!supabaseUrl || !serviceRoleKey) {
      this.logger.error(
        'No se envió la invitación porque falta la configuración de Supabase Auth.',
      );
      return false;
    }

    try {
      const response = await fetch(
        `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/invite`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            email: correo,
            data: { nombre_completo: nombreCompleto || '' },
            app_metadata: { tenant_id: tenantId, rol },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!response.ok) {
        this.logger.error(
          `Supabase Auth rechazó el envío de invitación (HTTP ${response.status}).`,
        );
        return false;
      }
      return true;
    } catch {
      this.logger.error('No se pudo completar la solicitud a Supabase Auth.');
      return false;
    }
  }

  private requireTransactionManager(
    entityManager: EntityManager | undefined,
  ): void {
    if (!entityManager?.queryRunner?.isTransactionActive) {
      throw new Error(
        'La operación de invitación requiere una transacción PostgreSQL activa.',
      );
    }
  }
}
