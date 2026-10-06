import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { RolUsuario } from '../interfaces/authenticated-user.interface.js';

export class InviteUserDto {
  @IsEmail({}, { message: 'El correo electrónico provisto no es válido' })
  @IsNotEmpty({ message: 'El correo es requerido' })
  correo!: string;

  @IsIn(['administrador', 'peon', 'veterinario'], {
    message:
      'El rol a invitar debe ser uno de: administrador, peon, veterinario',
  })
  @IsNotEmpty({ message: 'El rol es requerido' })
  rol!: RolUsuario;

  @IsString({ message: 'El nombre completo debe ser una cadena de texto' })
  @IsOptional()
  nombreCompleto?: string;
}
