import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * DTO para la confirmación de cuenta por parte de un usuario invitado.
 *
 * REGLA DE SEGURIDAD CRÍTICA (Defensa anti Mass-Assignment):
 * Este DTO NO incluye el campo 'rol'. Si un atacante inyecta { "rol": "propietario" }
 * en la petición HTTP, dicho campo no existe en el contrato del DTO y el servicio
 * toma el rol estrictamente de la invitación predefinida por el propietario.
 */
export class ConfirmInvitationDto {
  @ApiProperty({ maxLength: 120 })
  @IsString({ message: 'El nombre completo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre completo es requerido' })
  @MaxLength(120, { message: 'El nombre completo no puede superar 120 caracteres' })
  nombreCompleto!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'La invitación no es válida' })
  invitacionId!: string;
}
