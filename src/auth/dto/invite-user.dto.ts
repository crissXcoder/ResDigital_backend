import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { RolUsuario } from '../interfaces/authenticated-user.interface.js';

export class InviteUserDto {
  @ApiProperty({ format: 'email' })
  @IsEmail({}, { message: 'El correo electrónico provisto no es válido' })
  @IsNotEmpty({ message: 'El correo es requerido' })
  correo!: string;

  @ApiProperty({ enum: ['administrador', 'peon', 'veterinario'] })
  @IsIn(['administrador', 'peon', 'veterinario'], {
    message:
      'El rol a invitar debe ser uno de: administrador, peon, veterinario',
  })
  @IsNotEmpty({ message: 'El rol es requerido' })
  rol!: RolUsuario;

  @ApiProperty({ required: false, maxLength: 120 })
  @IsString({ message: 'El nombre completo debe ser una cadena de texto' })
  @MaxLength(120, { message: 'El nombre completo no puede superar 120 caracteres' })
  @IsOptional()
  nombreCompleto?: string;
}
