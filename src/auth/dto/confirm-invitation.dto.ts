import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO para la confirmación de cuenta por parte de un usuario invitado.
 *
 * REGLA DE SEGURIDAD CRÍTICA (Defensa anti Mass-Assignment):
 * Este DTO NO incluye el campo 'rol'. Si un atacante inyecta { "rol": "propietario" }
 * en la petición HTTP, dicho campo no existe en el contrato del DTO y el servicio
 * toma el rol estrictamente de la invitación predefinida por el propietario.
 */
export class ConfirmInvitationDto {
  @IsString({ message: 'El nombre completo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre completo es requerido' })
  nombreCompleto!: string;

  @IsString()
  @IsOptional()
  invitationToken?: string;
}
