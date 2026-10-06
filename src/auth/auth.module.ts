import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { SupabaseJwtService } from './services/supabase-jwt.service.js';
import { AuthGuard } from './guards/auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { RlsTransactionInterceptor } from './interceptors/rls-transaction.interceptor.js';
import { RolesService } from './services/roles.service.js';
import { InvitationsService } from './services/invitations.service.js';
import { AuditAuthService } from './services/audit-auth.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [AuthController],
  providers: [
    SupabaseJwtService,
    AuthGuard,
    RolesGuard,
    RlsTransactionInterceptor,
    RolesService,
    InvitationsService,
    AuditAuthService,
    // Configuración Global (Opción A aprobada: Secure by Default):
    // 1. Todas las rutas se protegen con AuthGuard a menos que lleven @Public()
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    // 2. RolesGuard evalúa los roles de @Roles() si están presentes
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // 3. RlsTransactionInterceptor abre una transacción TypeORM y setea RLS por request
    {
      provide: APP_INTERCEPTOR,
      useClass: RlsTransactionInterceptor,
    },
  ],
  exports: [
    SupabaseJwtService,
    AuthGuard,
    RolesGuard,
    RlsTransactionInterceptor,
    RolesService,
    InvitationsService,
    AuditAuthService,
  ],
})
export class AuthModule {}
