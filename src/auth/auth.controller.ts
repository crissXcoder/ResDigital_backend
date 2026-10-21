import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UnauthorizedException,
  InternalServerErrorException,
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

    if (!req.entityManager) {
      throw new InternalServerErrorException(
        'No se pudo validar la finca de la sesión. Volvé a intentar.',
      );
    }

    const rows = await req.entityManager.query<UsuarioRow[]>(
      `SELECT nombre_completo, correo FROM public.usuario
       WHERE id = $1 AND tenant_id = $2 AND activo = true AND rol = $3 LIMIT 1;`,
      [user.userId, user.tenantId, user.rol],
    );
    if (!rows[0]) {
      throw new UnauthorizedException(
        'Tu sesión no tiene acceso a una finca activa. Volvé a iniciar sesión.',
      );
    }

    const tenantRows = await req.entityManager.query<TenantRow[]>(
      'SELECT nombre_finca FROM public.tenant WHERE id = $1 LIMIT 1;',
      [user.tenantId],
    );
    if (!tenantRows[0]?.nombre_finca) {
      throw new UnauthorizedException(
        'Tu sesión no tiene acceso a una finca activa. Volvé a iniciar sesión.',
      );
    }

    return {
      userId: user.userId,
      tenantId: user.tenantId,
      rol: user.rol,
      nombreCompleto: rows[0].nombre_completo,
      correo: rows[0].correo,
      nombreFinca: tenantRows[0].nombre_finca,
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
