import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Roles } from './decorators/roles.decorator.js';
import type { RequestWithRls } from './interceptors/rls-transaction.interceptor.js';
import type {
  AuthenticatedUser,
  UserProfileResponse,
} from './interfaces/authenticated-user.interface.js';
import { InviteUserDto } from './dto/invite-user.dto.js';
import { ConfirmInvitationDto } from './dto/confirm-invitation.dto.js';
import { UserProfileResponseDto } from './dto/user-profile-response.dto.js';
import {
  InvitationsService,
  type InviteUserResult,
} from './services/invitations.service.js';

interface UsuarioRow {
  nombre_completo: string;
  correo: string;
}

interface TenantRow {
  nombre_finca: string;
}

@Controller('auth')
@ApiTags('Auth')
@ApiBearerAuth()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly invitationsService: InvitationsService) {}

  /**
   * GET /auth/perfil
   * Devuelve los datos de identidad y pertenencia a la finca del usuario autenticado.
   * Utiliza la conexión transaccional con RLS protegida para consultar el nombre completo.
   */
  @Get('perfil')
  @ApiOperation({ summary: 'Consultar el perfil del usuario autenticado' })
  @ApiResponse({ status: 200, description: 'Perfil de usuario y finca', type: UserProfileResponseDto })
  @ApiResponse({ status: 401, description: 'Token ausente o inválido' })
  async getPerfil(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithRls,
  ): Promise<UserProfileResponse> {
    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    let nombreCompleto =
      (user.rawClaims['nombre_completo'] as string) ||
      ((
        user.rawClaims['user_metadata'] as Record<string, unknown> | undefined
      )?.['nombre_completo'] as string) ||
      '';
    let correo = user.email;
    let nombreFinca = '';

    // Si la conexión transaccional con RLS está activa, consultar directamente las tablas
    if (req.entityManager) {
      try {
        const rows = await req.entityManager.query<UsuarioRow[]>(
          'SELECT nombre_completo, correo FROM public.usuario WHERE id = $1 LIMIT 1;',
          [user.userId],
        );

        if (rows && rows.length > 0) {
          nombreCompleto = rows[0].nombre_completo || nombreCompleto;
          correo = rows[0].correo || correo;
        }
      } catch (err) {
        this.logger.warn(
          `[perfil] No se pudo leer public.usuario para userId=${user.userId}: ${(err as Error).message}`,
        );
      }

      try {
        // Nota: la política RLS de tenant evalúa auth.jwt() ->> 'tenant_id'.
        // Si tenant_id está anidado en app_metadata el RLS lo bloquea.
        // Usamos current_setting('app.current_tenant_id') que el interceptor
        // siempre setea con el tenantId verificado por el AuthGuard.
        const tenantRows = await req.entityManager.query<TenantRow[]>(
          `SELECT nombre_finca FROM public.tenant
           WHERE id = (current_setting('app.current_tenant_id', true))::uuid
           LIMIT 1;`,
        );

        if (tenantRows && tenantRows.length > 0) {
          nombreFinca = tenantRows[0].nombre_finca;
        } else {
          this.logger.warn(
            `[perfil] No se encontró fila en public.tenant para tenantId=${user.tenantId}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `[perfil] No se pudo leer public.tenant para tenantId=${user.tenantId}: ${(err as Error).message}`,
        );
      }
    }

    return {
      userId: user.userId,
      tenantId: user.tenantId,
      rol: user.rol,
      nombreCompleto: nombreCompleto || user.email.split('@')[0],
      correo,
      nombreFinca,
    };
  }

  /**
   * POST /auth/invitar
   * Solo accesible por Propietario de la finca.
   * Envía invitación por correo fijando el rol predefinido.
   */
  @Post('invitar')
  @Roles('propietario')
  async invitarUsuario(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteUserDto,
    @Req() req: RequestWithRls,
  ): Promise<InviteUserResult> {
    if (!req.entityManager) {
      throw new InternalServerErrorException(
        'No se pudo iniciar la transacción de la invitación.',
      );
    }
    return this.invitationsService.inviteUser(user, dto, req.entityManager);
  }

  /**
   * POST /auth/confirmar-invitacion
   * Confirma la invitación para un usuario autenticado recién registrado.
   * Aplica el rol predefinido por el propietario desestimando cualquier rol inyectado.
   */
  @Post('confirmar-invitacion')
  async confirmarInvitacion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmInvitationDto,
    @Req() req: RequestWithRls,
  ): Promise<{ success: boolean; userId: string; rolFinal: string }> {
    if (!req.entityManager) {
      throw new InternalServerErrorException(
        'No se pudo iniciar la transacción de la invitación.',
      );
    }
    return this.invitationsService.confirmInvitation(
      user.userId,
      user.tenantId,
      user.email,
      dto as unknown as Record<string, unknown>,
      req.entityManager,
    );
  }
}
