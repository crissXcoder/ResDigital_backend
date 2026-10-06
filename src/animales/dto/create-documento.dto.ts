import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const ANIMAL_DOCUMENT_OBJECT_PATH_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-z0-9]+(?:-[a-z0-9]+)*\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$/i;

export class CreateDocumentoDto {
  @ApiProperty({ description: 'Categoría legible del documento', example: 'Cartilla sanitaria' })
  @IsString()
  tipo: string;

  @ApiProperty({
    description: 'Ruta del objeto privado dentro del bucket animal_docs',
    example: 'a0b9432d-cf48-4be7-a2f0-1a76c66cfcb1/b7a544c0-2ff6-4299-bbca-46fe87588386/cartilla-sanitaria/e1d67412-21d9-482f-870d-f55da282b810.pdf',
  })
  @IsString()
  @Matches(ANIMAL_DOCUMENT_OBJECT_PATH_REGEX)
  objectPath: string;
}
