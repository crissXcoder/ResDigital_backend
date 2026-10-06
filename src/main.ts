import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

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
  const app = await NestFactory.create(AppModule);

  // Cabeceras de seguridad: CSP, HSTS, X-Content-Type-Options, X-Frame-Options.
  app.use(helmet());

  // Límite general de peticiones.
  app.use(
    rateLimit({
      windowMs: Number(process.env.THROTTLE_TTL ?? 60000),
      limit: Number(process.env.THROTTLE_LIMIT ?? 120),
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
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        statusCode: 429,
        message: 'Demasiados intentos de autenticación. Esperá un minuto.',
        error: 'TooManyRequests',
      },
    }),
  );

  app.enableCors({
    origin: origenesPermitidos(),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Normaliza los errores de TypeORM y evita que el detalle de Postgres llegue
  // al cliente.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger publica la superficie completa de la API. Fuera de desarrollo se
  // activa solo a propósito.
  const swaggerHabilitado =
    process.env.SWAGGER_ENABLED === 'true' ||
    process.env.NODE_ENV !== 'production';

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
  await app.listen(port);

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
