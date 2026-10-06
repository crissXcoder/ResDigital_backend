import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type {
  AuthenticatedUser,
  RolUsuario,
} from '../interfaces/authenticated-user.interface.js';
import type { InviteUserDto } from '../dto/invite-user.dto.js';
import { RolesService } from './roles.service.js';
import { AuditAuthService } from './audit-auth.service.js';

export interface InvitacionRecord {
  id: string;
  tenantId: string;
  correo: string;
  rolPredefinido: RolUsuario;
  invitadoPor: string;
  estado: 'PENDIENTE' | 'ACEPTADA' | 'CANCELADA';
  createdAt: string;
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  // Registro en memoria de invitaciones (respaldo / tests unitarios / fallback de BD)
  private readonly pendingInvitations: Map<string, InvitacionRecord> = new Map();

  constructor(
    private readonly rolesService: RolesService,
    private readonly auditService: AuditAuthService,
    private readonly configService: ConfigService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  /**
   * Envía una invitación para unirse a una finca con un rol específico.
   * Valida permisos del invitador y fija el rol en un canal protegido (app_metadata / BD).
   */
  async inviteUser(
    inviter: AuthenticatedUser,
    dto: InviteUserDto,
    entityManager?: EntityManager,
  ): Promise<{ success: boolean; invitacionId: string; rolAsignado: RolUsuario }> {
    // 1. Solo el propietario administra usuarios e invitaciones.
    if (inviter.rol !== 'propietario') {
      throw new ForbiddenException(
        'Solo el propietario tiene autorización para invitar usuarios a la finca.',
      );
    }

    const invitacionId = randomUUID();
    const record: InvitacionRecord = {
      id: invitacionId,
      tenantId: inviter.tenantId,
      correo: dto.correo.toLowerCase().trim(),
      rolPredefinido: dto.rol,
      invitadoPor: inviter.userId,
      estado: 'PENDIENTE',
      createdAt: new Date().toISOString(),
    };

    // 2. Persistir invitación
    this.pendingInvitations.set(record.correo, record);

    const manager = entityManager || this.dataSource?.manager;
    if (manager && this.dataSource?.isInitialized) {
      try {
        await manager.query(
          `INSERT INTO public.invitacion (
            id, tenant_id, correo, rol, invitado_por, estado, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (correo, tenant_id) DO UPDATE
            SET rol = EXCLUDED.rol, estado = 'PENDIENTE';`,
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
      } catch (error) {
        this.logger.debug(
          `Aviso: No se pudo persistir en tabla invitacion (se mantiene en memoria): ${(error as Error).message}`,
        );
      }
    }

    // 3. Notificar a Supabase Auth via Admin API con app_metadata protegida
    await this.triggerSupabaseAdminInvite(
      record.correo,
      record.tenantId,
      record.rolPredefinido,
      dto.nombreCompleto,
    );

    // 4. Registrar auditoría con hash encadenado
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

    this.logger.log(
      `Invitación registrada para '${record.correo}' con rol '${record.rolPredefinido}' en finca '${inviter.tenantId}'`,
    );

    return {
      success: true,
      invitacionId: record.id,
      rolAsignado: record.rolPredefinido,
    };
  }

  /**
   * Confirma la aceptación de una invitación y aplica el rol legítimo.
   *
   * DEFENSA ANTI MASS-ASSIGNMENT (Patrón Energisa):
   * Si el payload entrante contiene un campo 'rol' (ej. { "rol": "propietario" }),
   * este parámetro del atacante es descartado sin excepción. El rol se lee
   * EXCLUSIVAMENTE del registro de invitación establecido por el propietario.
   */
  async confirmInvitation(
    invitedUserId: string,
    tenantId: string,
    correo: string,
    untrustedClientPayload: Record<string, unknown>,
    entityManager?: EntityManager,
  ): Promise<{ success: boolean; userId: string; rolFinal: RolUsuario }> {
    const cleanEmail = correo.toLowerCase().trim();

    // Detección y descarte del vector de ataque de mass-assignment
    if ('rol' in untrustedClientPayload && untrustedClientPayload['rol']) {
      const rawRol = untrustedClientPayload['rol'];
      const attemptedRol =
        typeof rawRol === 'string' ? rawRol : JSON.stringify(rawRol);
      this.logger.warn(
        `[ALERTA DE SEGURIDAD] Intento de mass-assignment detectado para usuario '${invitedUserId}' (${cleanEmail}). ` +
          `Parámetro inyectado: rol='${attemptedRol}'. El parámetro ha sido DESCARTADO.`,
      );
    }

    // 1. Buscar la invitación original guardada por el propietario
    let legitimateRol: RolUsuario | undefined;

    const manager = entityManager || this.dataSource?.manager;
    if (manager && this.dataSource?.isInitialized) {
      try {
        const rows = await manager.query<{ rol: RolUsuario }[]>(
          `SELECT rol FROM public.invitacion WHERE correo = $1 AND tenant_id = $2 AND estado = 'PENDIENTE' LIMIT 1;`,
          [cleanEmail, tenantId],
        );
        if (rows && rows.length > 0) {
          legitimateRol = rows[0].rol;
        }
      } catch {
        // Fallback al registro en memoria
      }
    }

    if (!legitimateRol) {
      const memoryRecord = this.pendingInvitations.get(cleanEmail);
      if (memoryRecord && memoryRecord.tenantId === tenantId) {
        legitimateRol = memoryRecord.rolPredefinido;
      }
    }

    if (!legitimateRol) {
      throw new NotFoundException(
        `No se encontró una invitación pendiente válida para el correo '${cleanEmail}' en esta finca.`,
      );
    }

    // 2. Asignar el rol legítimo a través del ÚNICO punto autorizado: RolesService
    await this.rolesService.assignRole(
      invitedUserId,
      tenantId,
      legitimateRol,
      invitedUserId,
      entityManager,
    );

    // 3. Marcar invitación como aceptada
    const memoryRecord = this.pendingInvitations.get(cleanEmail);
    if (memoryRecord) {
      memoryRecord.estado = 'ACEPTADA';
    }

    if (manager && this.dataSource?.isInitialized) {
      try {
        await manager.query(
          `UPDATE public.invitacion SET estado = 'ACEPTADA' WHERE correo = $1 AND tenant_id = $2;`,
          [cleanEmail, tenantId],
        );
      } catch {
        // Ignorar si no existe tabla
      }
    }

    // 4. Auditar la aceptación
    await this.auditService.logEvent(
      tenantId,
      'INVITACION_ACEPTADA',
      {
        userId: invitedUserId,
        correo: cleanEmail,
        rolFinalAsignado: legitimateRol,
      },
      invitedUserId,
      entityManager,
    );

    return {
      success: true,
      userId: invitedUserId,
      rolFinal: legitimateRol,
    };
  }

  /**
   * Invoca la Admin API de Supabase para enviar correo de invitación con metadata protegida.
   */
  private async triggerSupabaseAdminInvite(
    correo: string,
    tenantId: string,
    rol: RolUsuario,
    nombreCompleto?: string,
  ): Promise<void> {
    const supabaseUrl =
      this.configService.get<string>('SUPABASE_URL') || process.env.SUPABASE_URL;
    const serviceRoleKey =
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      this.logger.debug(
        'SUPABASE_SERVICE_ROLE_KEY no configurado: Omitiendo llamada HTTP a Supabase Admin API (modo local/test)',
      );
      return;
    }

    try {
      const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          email: correo,
          data: {
            nombre_completo: nombreCompleto || '',
          },
          // app_metadata es el canal seguro que alimenta raw_app_meta_data en el trigger
          app_metadata: {
            tenant_id: tenantId,
            rol,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(
          `Fallo al enviar invitación vía Supabase Admin API (${response.status}): ${errorText}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Excepción al contactar Supabase Admin API: ${(error as Error).message}`,
      );
    }
  }

  getPendingInvitation(correo: string): InvitacionRecord | undefined {
    return this.pendingInvitations.get(correo.toLowerCase().trim());
  }
}
