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
}

export interface InviteUserResult {
  success: true;
  invitacionId: string;
  rolAsignado: RolUsuario;
  emailSent: boolean | null;
  expiresAt: string;
}

export interface InvitationSummary {
  invitacionId: string;
  correo: string;
  rol: RolUsuario;
  estado: 'PENDIENTE' | 'ACEPTADA' | 'CANCELADA' | 'EXPIRADA';
  createdAt: string;
  expiresAt: string;
}

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

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

    const email = dto.correo.toLowerCase().trim();
    await entityManager.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0));",
      [`invitacion:${email}`],
    );
    const pendingElsewhere = await entityManager.query<{ tenant_id: string }[]>(
      "SELECT tenant_id FROM public.invitacion WHERE correo = $1 AND tenant_id <> $2 AND estado = 'PENDIENTE' LIMIT 1;",
      [email, inviter.tenantId],
    );
    if (pendingElsewhere[0]) {
      throw new ConflictException('Este correo ya tiene una invitación pendiente para otra finca.');
    }
    const existingUser = await entityManager.query<{ id: string }[]>(
      'SELECT id FROM public.usuario WHERE lower(correo) = $1 LIMIT 1;',
      [email],
    );
    if (existingUser[0]) {
      throw new ConflictException('Este correo ya pertenece a una cuenta de ResDigital.');
    }

    const record: InvitacionRecord = {
      id: randomUUID(),
      tenantId: inviter.tenantId,
      correo: email,
      rolPredefinido: dto.rol,
      invitadoPor: inviter.userId,
      estado: 'PENDIENTE',
    };

    const persistedRows = await entityManager.query<{ id: string; created_at: string | Date }[]>(
      `INSERT INTO public.invitacion (
        id, tenant_id, correo, rol, invitado_por, estado
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (correo, tenant_id) DO UPDATE
        SET rol = EXCLUDED.rol,
            invitado_por = EXCLUDED.invitado_por,
            estado = 'PENDIENTE',
            created_at = now()
      RETURNING id, created_at;`,
      [
        record.id,
        record.tenantId,
        record.correo,
        record.rolPredefinido,
        record.invitadoPor,
        record.estado,
      ],
    );
    if (!persistedRows[0]?.id || !persistedRows[0].created_at) {
      throw new Error('La base de datos no confirmó la invitación.');
    }
    record.id = persistedRows[0].id;
    const createdAt = new Date(persistedRows[0].created_at).toISOString();

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
      expiresAt: new Date(Date.parse(createdAt) + INVITATION_TTL_MS).toISOString(),
    };

    registerAfterCommitCallback(entityManager, async () => {
      result.emailSent = await this.triggerSupabaseAdminInvite(
        record.correo,
        record.id,
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
      { id: string; rol: RolUsuario; created_at: string | Date }[]
    >(
      `SELECT id, rol, created_at
         FROM public.invitacion
        WHERE id = $1 AND correo = $2 AND tenant_id = $3 AND estado = 'PENDIENTE'
          AND created_at > now() - interval '24 hours'
        LIMIT 1
        FOR UPDATE;`,
      [String(untrustedClientPayload['invitacionId'] ?? ''), cleanEmail, tenantId],
    );
    const invitation = invitationRows[0];
    if (!invitation) {
      throw new NotFoundException(
        'La invitación no está vigente o ya fue utilizada. Solicitá una nueva al propietario.',
      );
    }

    await this.rolesService.assignRole(
      invitedUserId,
      tenantId,
      invitation.rol,
      invitedUserId,
      entityManager,
    );

    await entityManager.query(
      `UPDATE public.usuario
          SET nombre_completo = $1
        WHERE id = $2 AND tenant_id = $3 AND activo = true;`,
      [String(untrustedClientPayload['nombreCompleto'] ?? '').trim(), invitedUserId, tenantId],
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

  async listInvitations(
    tenantId: string,
    entityManager: EntityManager,
  ): Promise<InvitationSummary[]> {
    this.requireTransactionManager(entityManager);
    const rows = await entityManager.query<{
      id: string;
      correo: string;
      rol: RolUsuario;
      estado: 'PENDIENTE' | 'ACEPTADA' | 'CANCELADA';
      created_at: string | Date;
      ahora: string | Date;
    }[]>(
      `SELECT id, correo, rol, estado, created_at, now() AS ahora
         FROM public.invitacion
        WHERE tenant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 50;`,
      [tenantId],
    );

    return rows.map((row) => {
      const createdAt = new Date(row.created_at).toISOString();
      const expiresAt = new Date(Date.parse(createdAt) + INVITATION_TTL_MS).toISOString();
      return {
        invitacionId: row.id,
        correo: row.correo,
        rol: row.rol,
        estado: row.estado === 'PENDIENTE' && Date.parse(expiresAt) <= Date.parse(new Date(row.ahora).toISOString())
          ? 'EXPIRADA'
          : row.estado,
        createdAt,
        expiresAt,
      };
    });
  }

  private async triggerSupabaseAdminInvite(
    correo: string,
    invitacionId: string,
    nombreCompleto?: string,
  ): Promise<boolean> {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.configService.get<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');

    if (!supabaseUrl || !serviceRoleKey) {
      this.logger.error(
        'No se envió la invitación porque falta la configuración de Supabase Auth.',
      );
      return false;
    }

    try {
      const inviteUrl = new URL(
        '/auth/v1/invite',
        supabaseUrl.replace(/\/+$/, ''),
      );
      if (frontendUrl) {
        inviteUrl.searchParams.set(
          'redirect_to',
          new URL('/aceptar-invitacion', frontendUrl).toString(),
        );
      }
      const response = await fetch(
        inviteUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            email: correo,
            data: { nombre_completo: nombreCompleto || '', invitacion_id: invitacionId },
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
