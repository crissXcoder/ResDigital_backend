import { ApiProperty } from '@nestjs/swagger';

export class UserProfileResponseDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ format: 'uuid' }) tenantId: string;
  @ApiProperty({ enum: ['propietario', 'administrador', 'peon', 'veterinario'] })
  rol: 'propietario' | 'administrador' | 'peon' | 'veterinario';
  @ApiProperty() nombreCompleto: string;
  @ApiProperty({ format: 'email' }) correo: string;
  @ApiProperty() nombreFinca: string;
}
