import {
  IsString,
  IsUUID,
  IsOptional,
  IsIn,
  IsNumber,
  IsDateString,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SEXOS, CATEGORIAS_ANIMAL } from './create-animal.dto.js';
import { EsFechaNoFutura } from './validators/fecha-animal.validator.js';

/**
 * ============================================================================
 * CONTRATO INTER-MÓDULO: M01 (Animales / Cristhian) ↔ M03 (Reproducción / Ari)
 * ============================================================================
 *
 * Este archivo define el contrato transaccional formal para el registro de crías
 * durante un evento de parto (RF-004 y RF-010).
 *
 * PROPÓSITO:
 * Permitir que el módulo de Reproducción (`ReproductiveService.registrarParto`)
 * cree una nueva cría o vincule una cría existente a la madre en la misma
 * transacción de base de datos (`EntityManager`), garantizando:
 *  1. Aislamiento estricto por tenant (`tenantId`).
 *  2. Consistencia genealógica (la madre existe, es hembra y no se generan ciclos).
 *  3. Herencia biológica por defecto (raza y potrero de la madre si no se especifican).
 *  4. Categorización automática según sexo ('Ternera' o 'Ternero').
 *  5. Validación de unicidad de arete interno y DIIO en la finca.
 *
 * EJEMPLO DE USO DESDE REPRODUCCIÓN (Ari):
 * ```typescript
 * // En ReproductiveService.registrarParto(animalId, tenantId, dto, manager):
 * return manager.transaction(async (trx) => {
 *   // 1. Crear o validar cría usando el contrato de Animales:
 *   const cria = await this.animalesService.crearOValidarCriaParaParto(
 *     tenantId,
 *     animalId, // ID de la madre que pare
 *     {
 *       criaAnimalId: dto.criaAnimalId,
 *       nuevaCria: dto.nuevaCria,
 *     },
 *     dto.fechaEvento, // fecha del parto
 *     trx,             // EntityManager transaccional obligatorio
 *   );
 *
 *   const criaAnimalId = cria ? cria.id : null;
 *
 *   // 2. Guardar el evento de parto con el ID resultante:
 *   const parto = await trx.save(EventoParto, trx.create(EventoParto, {
 *     eventoId: evento.id,
 *     criaAnimalId,
 *     ...
 *   }));
 * });
 * ```
 */

/**
 * Datos requeridos y opcionales para dar de alta a una cría recién nacida
 * en la misma transacción del parto.
 */
export class DatosNuevaCriaPartoDto {
  @ApiProperty({
    description: 'Identificador único interno o arete de la cría en la finca.',
    example: 'CR-2026-001',
  })
  @IsString({ message: 'El arete interno de la cría debe ser una cadena de texto' })
  areteInterno: string;

  @ApiPropertyOptional({
    description:
      'Nombre de la cría. Si se omite, se asigna el mismo valor de areteInterno.',
    example: 'Lucero',
  })
  @IsString()
  @IsOptional()
  nombre?: string;

  @ApiProperty({
    description: "Sexo obligatorio de la cría recién nacida ('Hembra' o 'Macho').",
    enum: SEXOS,
    example: 'Hembra',
  })
  @IsIn(SEXOS, { message: "El sexo de la cría debe ser 'Hembra' o 'Macho'" })
  sexo?: (typeof SEXOS)[number];

  @ApiPropertyOptional({
    description:
      'ID de la raza en catálogo. Si se omite, hereda automáticamente la raza de la madre.',
    example: 'b1a2c3d4-0000-0000-0000-000000000001',
  })
  @IsUUID('4', { message: 'El razaId debe ser un UUID válido' })
  @IsOptional()
  razaId?: string;

  @ApiPropertyOptional({
    description:
      'Descripción personalizada de la raza si aplica. Si se omite y la madre tiene razaOtra, la hereda.',
    example: 'Cruce Jersey x Girolando',
  })
  @IsString()
  @IsOptional()
  razaOtra?: string;

  @ApiPropertyOptional({
    description:
      'Número oficial de arete DIIO del MAG/SENASA. Debe ser único en la finca si se especifica.',
    example: 'DIIO-CR-998822',
  })
  @IsString()
  @IsOptional()
  numeroOficialDiio?: string;

  @ApiPropertyOptional({
    description:
      "Categoría de la cría. Si se omite, se auto-asigna 'Ternera' para hembras o 'Ternero' para machos.",
    enum: CATEGORIAS_ANIMAL,
    example: 'Ternera',
  })
  @IsIn(CATEGORIAS_ANIMAL, {
    message: `La categoría debe ser una de: ${CATEGORIAS_ANIMAL.join(', ')}`,
  })
  @IsOptional()
  categoria?: (typeof CATEGORIAS_ANIMAL)[number];

  @ApiPropertyOptional({
    description:
      'ID del potrero donde se ubicará la cría. Si se omite, hereda el potrero de la madre.',
    example: 'c2b3a4d5-1111-2222-3333-444455556666',
  })
  @IsUUID('4', { message: 'El potreroId debe ser un UUID válido' })
  @IsOptional()
  potreroId?: string;

  @ApiPropertyOptional({
    description:
      'Fecha de nacimiento de la cría (YYYY-MM-DD). Si se omite, se utiliza la fecha del parto.',
    example: '2026-10-21',
  })
  @IsDateString()
  @EsFechaNoFutura({
    message: 'La fecha de nacimiento no puede ser una fecha futura',
  })
  @IsOptional()
  fechaNacimiento?: string;

  @ApiPropertyOptional({
    description: 'Peso al nacer en kilogramos (peso de nacimiento).',
    example: 38.5,
  })
  @IsNumber()
  @Min(0, { message: 'El peso de nacimiento no puede ser negativo' })
  @IsOptional()
  pesoNacimientoKg?: number;

  @ApiPropertyOptional({
    description: 'URL de la fotografía inicial de la cría (opcional).',
    example: 'https://storage.resdigital.cr/fotos/cria-001.jpg',
  })
  @IsString()
  @IsOptional()
  fotoUrl?: string;

  @ApiPropertyOptional({
    description:
      'ID del toro padre si está registrado en la misma finca (opcional).',
    example: 'a1b2c3d4-5555-6666-7777-888899990000',
  })
  @IsUUID('4', { message: 'El padreId debe ser un UUID válido' })
  @IsOptional()
  padreId?: string;

  @ApiPropertyOptional({
    description:
      'Descripción del toro padre si provino de inseminación artificial externa o monta externa.',
    example: 'Toro Holstein Canadiense Semen Pajilla #4410',
  })
  @IsString()
  @IsOptional()
  padreExternoDescripcion?: string;
}

/**
 * DTO contenedor del contrato de cría para eventos de parto.
 *
 * Permite dos modalidades mutuamente excluyentes:
 *  A. `criaAnimalId`: La cría ya existía en el hato y se asocia formalmente a la madre.
 *  B. `nuevaCria`: Se ingresan los datos para dar de alta automáticamente a la cría.
 *
 * Si ninguno de los dos campos está presente, la operación retorna `null` limpiamente
 * (ejemplo: abortos, mortinatos o partos donde no se desea registrar el animal todavía).
 */
export class PartoCriaContratoDto {
  @ApiPropertyOptional({
    description:
      'ID de un animal preexistente en la misma finca para asociarlo como cría de este parto.',
    example: 'e1d67412-21d9-482f-870d-f55da282b810',
  })
  @IsUUID('4', { message: 'El criaAnimalId debe ser un UUID válido' })
  @IsOptional()
  criaAnimalId?: string;

  @ApiPropertyOptional({
    description: 'Confirma que una ficha sin fecha de nacimiento corresponde a esta cría; se registrará la fecha del parto.',
  })
  @IsBoolean()
  @IsOptional()
  confirmarFechaNacimiento?: boolean;

  @ApiPropertyOptional({
    description:
      'Datos para crear e insertar una nueva cría en el hato durante el parto.',
    type: DatosNuevaCriaPartoDto,
  })
  @ValidateNested()
  @Type(() => DatosNuevaCriaPartoDto)
  @IsOptional()
  nuevaCria?: DatosNuevaCriaPartoDto;
}
