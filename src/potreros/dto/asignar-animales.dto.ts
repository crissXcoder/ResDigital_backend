import { IsArray, IsUUID, ArrayNotEmpty } from 'class-validator';

export class AsignarAnimalesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  animalIds: string[];
}
