import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

/**
 * Filtro global de excepciones.
 *
 * Resuelve dos problemas que estaban repartidos por todo el código:
 *
 * 1. Varios servicios envolvían sus consultas en
 *    `catch (error) { throw new BadRequestException('Database error: ' + error.message) }`.
 *    Eso convertía cualquier fallo —incluida una violación de RLS o una caída de
 *    conexión— en un 400, y devolvía al cliente el mensaje crudo de Postgres,
 *    con nombres de tablas, restricciones y tipos.
 *
 * 2. Sin filtro, los errores de TypeORM que nadie atrapaba salían como 500
 *    genéricos, también con el detalle interno.
 *
 * Acá se traduce cada código de error de Postgres al estado HTTP que
 * corresponde, y el detalle técnico va únicamente al log del servidor.
 */

interface RespuestaError {
  statusCode: number;
  message: string;
  error: string;
  path: string;
  timestamp: string;
}

/** Códigos SQLSTATE relevantes. */
const SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  INVALID_TEXT_REPRESENTATION: '22P02',
  INSUFFICIENT_PRIVILEGE: '42501',
  UNDEFINED_COLUMN: '42703',
  UNDEFINED_TABLE: '42P01',
} as const;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, error } = this.resolver(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}: ${this.detalleTecnico(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${status}: ${this.detalleTecnico(exception)}`,
      );
    }

    const cuerpo: RespuestaError = {
      statusCode: status,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(cuerpo);
  }

  private resolver(exception: unknown): {
    status: number;
    message: string;
    error: string;
  } {
    // Las excepciones de Nest ya traen su estado y un mensaje pensado para el
    // cliente: se respetan tal cual.
    if (exception instanceof HttpException) {
      const respuesta = exception.getResponse();
      const message =
        typeof respuesta === 'string'
          ? respuesta
          : ((respuesta as { message?: string | string[] }).message ??
            exception.message);

      return {
        status: exception.getStatus(),
        message: Array.isArray(message) ? message.join('; ') : message,
        error: exception.name,
      };
    }

    if (exception instanceof QueryFailedError) {
      return this.resolverErrorDeBaseDeDatos(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        'Ocurrió un error inesperado. Intentá de nuevo en unos momentos.',
      error: 'InternalServerError',
    };
  }

  private resolverErrorDeBaseDeDatos(exception: QueryFailedError): {
    status: number;
    message: string;
    error: string;
  } {
    const codigo = (exception as QueryFailedError & { code?: string }).code;

    switch (codigo) {
      case SQLSTATE.UNIQUE_VIOLATION:
        return {
          status: HttpStatus.CONFLICT,
          message: 'Ya existe un registro con esos datos.',
          error: 'Conflict',
        };

      case SQLSTATE.FOREIGN_KEY_VIOLATION:
        return {
          status: HttpStatus.CONFLICT,
          message:
            'La operación hace referencia a un registro que no existe, o el registro todavía está en uso.',
          error: 'Conflict',
        };

      case SQLSTATE.NOT_NULL_VIOLATION:
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Falta un dato obligatorio.',
          error: 'BadRequest',
        };

      case SQLSTATE.CHECK_VIOLATION:
        return {
          status: HttpStatus.BAD_REQUEST,
          message:
            'Alguno de los valores enviados no está entre los permitidos.',
          error: 'BadRequest',
        };

      case SQLSTATE.INVALID_TEXT_REPRESENTATION:
        return {
          status: HttpStatus.BAD_REQUEST,
          message:
            'Alguno de los identificadores enviados tiene un formato inválido.',
          error: 'BadRequest',
        };

      // Incluye las violaciones de política de Row Level Security. Si esto
      // aparece, o el contexto de tenant no se fijó, o se intentó tocar datos
      // de otra finca. En ninguno de los dos casos el cliente debe ver el
      // detalle.
      case SQLSTATE.INSUFFICIENT_PRIVILEGE:
        return {
          status: HttpStatus.FORBIDDEN,
          message: 'No tenés permiso para realizar esta operación.',
          error: 'Forbidden',
        };

      // Deriva de esquema: la entidad y la base no coinciden. Es un fallo del
      // servidor, no de quien hizo la petición.
      case SQLSTATE.UNDEFINED_COLUMN:
      case SQLSTATE.UNDEFINED_TABLE:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message:
            'Error de configuración del servidor. Avisale al equipo técnico.',
          error: 'InternalServerError',
        };

      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'No se pudo completar la operación en la base de datos.',
          error: 'InternalServerError',
        };
    }
  }

  private detalleTecnico(exception: unknown): string {
    if (exception instanceof QueryFailedError) {
      const codigo = (exception as QueryFailedError & { code?: string }).code;
      return `QueryFailedError[${codigo ?? 'sin código'}] ${exception.message}`;
    }
    if (exception instanceof Error) {
      return `${exception.name}: ${exception.message}`;
    }
    return String(exception);
  }
}
