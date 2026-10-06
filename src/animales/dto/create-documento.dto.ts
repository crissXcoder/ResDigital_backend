import { IsString, Matches } from 'class-validator';

export const ANIMAL_DOCUMENT_OBJECT_PATH_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-z0-9]+(?:-[a-z0-9]+)*\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$/i;

export class CreateDocumentoDto {
  @IsString()
  tipo: string;

  @IsString()
  @Matches(ANIMAL_DOCUMENT_OBJECT_PATH_REGEX)
  objectPath: string;
}
