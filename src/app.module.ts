import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv } from './config/env.schema.js';
import { buildSslOptions } from './database/ssl-options.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogosModule } from './catalogos/catalogos.module.js';
import { AnimalesModule } from './animales/animales.module.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PesajesModule } from './pesajes/pesajes.module.js';
import { TratamientosModule } from './tratamientos/tratamientos.module.js';
import { SanitaryModule } from './sanitary/sanitary.module.js';
import { PotrerosModule } from './potreros/potreros.module.js';
import { ReproductivoModule } from './reproductivo/reproductivo.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Sin esto la aplicación arrancaba sin DATABASE_URL y fallaba recién en la
      // primera consulta, con un error que no señalaba la causa.
      validate: validateEnv,
    }),
    // El límite de peticiones se aplica como middleware de Express en main.ts,
    // no como guard de Nest. Motivo: el proyecto es ESM ("type": "module") y
    // @nestjs/throttler se distribuye en CommonJS, así que carga su propia
    // instancia de @nestjs/core. Eso produce dos clases `Reflector` distintas y
    // la inyección de ThrottlerGuard falla al arrancar. Como el rate limiting
    // no necesita nada del contenedor de dependencias, un middleware evita el
    // problema por completo.
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('DATABASE_URL');
        return {
          type: 'postgres' as const,
          url,
          // Una sola fuente para la decisión de TLS, compartida con data-source.ts.
          ssl: buildSslOptions(url),
          autoLoadEntities: true,
          // REGLA OBLIGATORIA (Definicion-de-Terminado.md): nunca synchronize: true.
          synchronize: false,
        };
      },
    }),
    AuthModule,
    CatalogosModule,
    AnimalesModule,
    PesajesModule,
    TratamientosModule,
    SanitaryModule,
    PotrerosModule,
    ReproductivoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
