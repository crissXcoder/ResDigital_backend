import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { validationMessagesEs } from './common/validation-messages.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module.js';
import { isSwaggerEnabled } from './config/swagger.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { createRateLimitKey } from './auth/rate-limit-key.js';
import { SupabaseJwtService } from './auth/services/supabase-jwt.service.js';

function origenesPermitidos(): string[] {
  const configurado = process.env.FRONTEND_URL;

  if (!configurado) {
    if (process.env.NODE_ENV === 'production') {
      // La validación de entorno ya lo impide, pero se repite acá para que
      // nunca se sirva producción contra el origen de desarrollo por descuido.
      throw new Error(
        'FRONTEND_URL es obligatoria en producción: define el origen permitido de CORS.',
      );
    }
    return ['http://localhost:3000'];
  }

  return configurado
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.enableCors({
    origin: origenesPermitidos(),
    credentials: true,
  });

  const keyGenerator = createRateLimitKey(app.get(SupabaseJwtService));

  // Cabeceras de seguridad: CSP, HSTS, X-Content-Type-Options, X-Frame-Options.
  app.use(helmet());

  // Límite general de peticiones.
  app.use(
    rateLimit({
      windowMs: Number(process.env.THROTTLE_TTL ?? 60000),
      limit: Number(process.env.THROTTLE_LIMIT ?? 120),
      keyGenerator,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        statusCode: 429,
        message: 'Demasiadas peticiones. Esperá un momento y volvé a intentar.',
        error: 'TooManyRequests',
      },
    }),
  );

  // Límite más estricto en autenticación: es donde pega la fuerza bruta y la
  // enumeración de correos.
  app.use(
    '/auth',
    rateLimit({
      windowMs: 60000,
      limit: 10,
      keyGenerator,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        statusCode: 429,
        message: 'Demasiados intentos de autenticación. Esperá un minuto.',
        error: 'TooManyRequests',
      },
    }),
  );

  app.useBodyParser('json', {
    limit: '100kb',
    type: (request) =>
      !(request.method === 'POST' && request.url?.split('?')[0] === '/produccion-leche/lote'),
  });
  app.useBodyParser('json', {
    limit: '9mb',
    type: (request) =>
      request.method === 'POST' && request.url?.split('?')[0] === '/produccion-leche/lote',
  });
  app.useBodyParser('urlencoded', { extended: true, limit: '100kb' });


  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) => new BadRequestException(validationMessagesEs(errors)),
    }),
  );

  // Normaliza los errores de TypeORM y evita que el detalle de Postgres llegue
  // al cliente.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger publica la superficie completa de la API. Fuera de desarrollo se
  // activa solo a propósito.
  const swaggerHabilitado = isSwaggerEnabled();

  if (swaggerHabilitado) {
    const config = new DocumentBuilder()
      .setTitle('ResDigital API')
      .setDescription('API del sistema de gestión ganadera ResDigital')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
  }

  // Permite que las transacciones en vuelo del RlsTransactionInterceptor
  // terminen antes de que el proceso muera.
  app.enableShutdownHooks();

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  await app.listen(port, process.env.HOST ?? '::');

  new Logger('Bootstrap').log(
    `ResDigital API escuchando en el puerto ${port}${swaggerHabilitado ? ' (Swagger en /api)' : ''}`,
  );
}

await bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    `No se pudo arrancar la aplicación: ${(error as Error).message}`,
    (error as Error).stack,
  );
  process.exit(1);
});
