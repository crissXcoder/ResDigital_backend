import { ApiProperty } from '@nestjs/swagger';
import type { RolUsuario } from '../interfaces/authenticated-user.interface.js';

export class InvitationSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) invitacionId!: string;
  @ApiProperty({ format: 'email' }) correo!: string;
  @ApiProperty({ enum: ['administrador', 'peon', 'veterinario'] }) rol!: Exclude<RolUsuario, 'propietario'>;
  @ApiProperty({ enum: ['PENDIENTE', 'ACEPTADA', 'CANCELADA', 'EXPIRADA'] })
  estado!: 'PENDIENTE' | 'ACEPTADA' | 'CANCELADA' | 'EXPIRADA';
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class InviteUserResponseDto {
  @ApiProperty() success!: true;
  @ApiProperty({ format: 'uuid' }) invitacionId!: string;
  @ApiProperty({ enum: ['administrador', 'peon', 'veterinario'] }) rolAsignado!: Exclude<RolUsuario, 'propietario'>;
  @ApiProperty({ type: Boolean, nullable: true }) emailSent!: boolean | null;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
