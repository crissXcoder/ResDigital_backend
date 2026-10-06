import { ApiProperty } from '@nestjs/swagger';

export class DocumentoAnimalResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) tenantId: string;
  @ApiProperty({ format: 'uuid' }) animalId: string;
  @ApiProperty() tipo: string;
  @ApiProperty({ type: 'string', nullable: true }) archivoUrl: string | null;
  @ApiProperty({ type: 'string', nullable: true }) objectPath: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt: Date;
}
