import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  BadRequestException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiExtraModels,
} from '@nestjs/swagger';
import type { EntityManager } from 'typeorm';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CurrentEntityManager } from '../auth/decorators/current-entity-manager.decorator.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import {
  ReproductiveService,
  type ProximoEventoReproductivo,
} from './services/reproductive.service.js';
import { RegistrarServicioDto } from './dto/registrar-servicio.dto.js';
import { RegistrarDiagnosticoDto } from './dto/registrar-diagnostico.dto.js';
import { RegistrarPartoDto } from './dto/registrar-parto.dto.js';
import { RegistrarSecadoDto } from './dto/registrar-secado.dto.js';
import { ProximosEventosQueryDto } from './dto/proximos-eventos-query.dto.js';
import {
  EstadoReproductivoResponseDto,
  HitosReproductivosDto,
  ProximoEventoReproductivoDto,
} from './dto/responses/estado-reproductivo.response.dto.js';
import {
  DetalleDiagnosticoDto,
  DetallePartoDto,
  DetalleServicioDto,
  EventoReproductivoHistorialDto,
  aHistorialDto,
} from './dto/responses/evento-reproductivo-historial.dto.js';
import type { EstadoReproductivoInfo } from './interfaces/reproductive-state.interface.js';

/**
 * Pipe de validación del `:id` del animal.
 *
 * Sin esto, un id que no fuera UUID llegaba tal cual hasta Postgres y provocaba
 * `invalid input syntax for type uuid`, es decir un 500 en vez del 400 que
 * corresponde. Sin `version`: no todos los UUID del sistema son v4.
 */
const ParseAnimalId = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El id del animal debe ser un UUID válido.'),
});

/**
 * Nota sobre guards e interceptores: este controlador NO los declara.
 *
 * `AuthGuard`, `RolesGuard` y `RlsTransactionInterceptor` ya están registrados
 * globalmente como APP_GUARD / APP_INTERCEPTOR en AuthModule. Declararlos otra
 * vez acá con @UseGuards/@UseInterceptors hacía que se ejecutaran DOS veces por
 * petición: dos QueryRunner, dos transacciones anidadas contra el pool de
 * Supabase, y `request.entityManager` sobrescrito por el segundo interceptor.
 */
@ApiTags('Reproductivo')
@ApiBearerAuth()
@ApiExtraModels(DetalleServicioDto, DetalleDiagnosticoDto, DetallePartoDto)
@Controller()
export class ReproductiveController {
  constructor(private readonly reproductiveService: ReproductiveService) {}

  @Post('animales/:id/servicios')
  @Roles('propietario', 'administrador', 'peon', 'veterinario')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar servicio reproductivo para un animal hembra',
    description:
      'Registra un servicio (Inseminación Artificial o Monta Natural) y calcula los 5 hitos usando los días de gestación de la raza del animal, nunca una constante fija.',
  })
  @ApiParam({ name: 'id', description: 'ID del animal hembra', format: 'uuid' })
  @ApiResponse({
    status: 201,
    description:
      'Servicio registrado. Devuelve el evento, su detalle y los hitos calculados.',
    type: HitosReproductivosDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Animal macho, raza sin días de gestación configurados, fecha futura o datos inválidos',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido o sin claims de tenant',
  })
  @ApiResponse({
    status: 403,
    description: 'El rol autenticado no está autorizado para registrar servicios',
  })
  @ApiResponse({
    status: 404,
    description: 'Animal no encontrado en esta finca',
  })
  async registrarServicio(
    @Param('id', ParseAnimalId) id: string,
    @Body() dto: RegistrarServicioDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.reproductiveService.registrarServicio(
      id,
      user.tenantId,
      user.userId,
      dto,
      manager,
    );
  }

  @Post('animales/:id/diagnosticos')
  @Roles('propietario', 'administrador', 'veterinario')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar diagnóstico de preñez',
    description:
      'Registra el resultado (Preñada o Vacía) asociado a un servicio previo. Es lo único que confirma una preñez: un servicio por sí solo no cuenta como gestante.',
  })
  @ApiParam({ name: 'id', description: 'ID del animal hembra', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Diagnóstico registrado' })
  @ApiResponse({
    status: 400,
    description: 'Animal macho, fecha futura, o método/resultado inválido',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido o sin claims de tenant',
  })
  @ApiResponse({
    status: 403,
    description: 'El rol peón no puede registrar diagnósticos',
  })
  @ApiResponse({
    status: 404,
    description: 'Animal o servicio previo no encontrado en esta finca',
  })
  async registrarDiagnostico(
    @Param('id', ParseAnimalId) id: string,
    @Body() dto: RegistrarDiagnosticoDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.reproductiveService.registrarDiagnostico(
      id,
      user.tenantId,
      user.userId,
      dto,
      manager,
    );
  }

  @Post('animales/:id/partos')
  @Roles('propietario', 'administrador', 'peon', 'veterinario')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar parto',
    description:
      'Cierra el ciclo reproductivo y devuelve el animal a Vacía. Requiere que el animal esté en estado Preñada o En Secado. Un aborto se registra con facilidadParto = "Aborto".',
  })
  @ApiParam({ name: 'id', description: 'ID de la madre', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Parto registrado' })
  @ApiResponse({
    status: 400,
    description:
      'Animal macho, fecha futura, o el animal no está en estado Preñada / En Secado',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido o sin claims de tenant',
  })
  @ApiResponse({
    status: 403,
    description: 'El rol autenticado no está autorizado para registrar partos',
  })
  @ApiResponse({
    status: 404,
    description: 'Madre, cría o servicio asociado no encontrado en esta finca',
  })
  async registrarParto(
    @Param('id', ParseAnimalId) id: string,
    @Body() dto: RegistrarPartoDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.reproductiveService.registrarParto(
      id,
      user.tenantId,
      user.userId,
      dto,
      manager,
    );
  }

  @Post('animales/:id/secados')
  @Roles('propietario', 'administrador', 'peon', 'veterinario')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar secado',
    description:
      'Registra la suspensión real del ordeño, que puede diferir de la fecha de secado calculada (FPP - 60 días).',
  })
  @ApiParam({ name: 'id', description: 'ID del animal hembra', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Secado registrado' })
  @ApiResponse({
    status: 400,
    description: 'Animal macho, fecha futura o datos inválidos',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido o sin claims de tenant',
  })
  @ApiResponse({
    status: 403,
    description: 'El rol peón no puede registrar secados',
  })
  @ApiResponse({
    status: 404,
    description: 'Animal no encontrado en esta finca',
  })
  async registrarSecado(
    @Param('id', ParseAnimalId) id: string,
    @Body() dto: RegistrarSecadoDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ) {
    return this.reproductiveService.registrarSecado(
      id,
      user.tenantId,
      user.userId,
      dto,
      manager,
    );
  }

  /**
   * Sin `@Roles`: cualquier rol autenticado, incluido peón, puede consultar la
   * ficha de un animal. Ver la tabla de permisos de Multi-Tenant-y-Seguridad.md.
   */
  @Get('animales/:id/estado-reproductivo')
  @ApiOperation({
    summary: 'Consultar estado reproductivo e hitos calculados',
    description:
      'Deriva al vuelo el estado (Vacía, Servida, Preñada, En Secado) recorriendo el historial de eventos y devuelve los próximos hitos del ciclo activo. El estado nunca se guarda ni se edita a mano.',
  })
  @ApiParam({ name: 'id', description: 'ID del animal', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Estado reproductivo derivado',
    type: EstadoReproductivoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'El animal es macho y no tiene ciclo reproductivo',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido o sin claims de tenant',
  })
  @ApiResponse({
    status: 404,
    description: 'Animal no encontrado en esta finca',
  })
  async obtenerEstadoReproductivo(
    @Param('id', ParseAnimalId) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ): Promise<EstadoReproductivoInfo> {
    return this.reproductiveService.obtenerEstadoReproductivo(
      id,
      user.tenantId,
      manager,
    );
  }

  /**
   * Historial completo. El endpoint de estado solo devuelve el último evento de
   * cada tipo, que no alcanza para dibujar la tabla del ciclo reproductivo en el
   * expediente del animal.
   */
  @Get('animales/:id/eventos-reproductivos')
  @ApiOperation({
    summary: 'Historial reproductivo completo del animal',
    description:
      'Lista cronológica de todos los eventos reproductivos del animal, con su detalle correspondiente. Incluye los eventos revertidos, marcados con revertido = true: el historial es append-only y una corrección tiene que poder verse.',
  })
  @ApiParam({ name: 'id', description: 'ID del animal', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Historial en orden cronológico ascendente',
    type: [EventoReproductivoHistorialDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido o sin claims de tenant',
  })
  @ApiResponse({
    status: 404,
    description: 'Animal no encontrado en esta finca',
  })
  async obtenerHistorialReproductivo(
    @Param('id', ParseAnimalId) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
  ): Promise<EventoReproductivoHistorialDto[]> {
    const historial =
      await this.reproductiveService.obtenerHistorialReproductivo(
        id,
        user.tenantId,
        manager,
      );
    return historial.map(aHistorialDto);
  }

  @Get('reproductivo/proximos-eventos')
  @ApiOperation({
    summary: 'Calendario reproductivo de toda la finca',
    description:
      'Hitos próximos de todas las hembras activas, ordenados por urgencia. Tipos posibles: Palpación, Secado, Aviso Parto (FPP-15), Aviso Parto Urgente (FPP-3) y Parto. Incluye los hitos vencidos en los últimos 7 días, porque siguen siendo tareas pendientes.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista ordenada por días restantes, ascendente',
    type: [ProximoEventoReproductivoDto],
  })
  @ApiResponse({
    status: 400,
    description: 'diasVentana fuera del rango permitido (1-365)',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido o sin claims de tenant',
  })
  async obtenerProximosEventos(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentEntityManager() manager: EntityManager,
    @Query() query: ProximosEventosQueryDto,
  ): Promise<ProximoEventoReproductivo[]> {
    return this.reproductiveService.obtenerProximosEventos(
      user.tenantId,
      manager,
      query.diasVentana,
    );
  }
}
