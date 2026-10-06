import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  OnModuleInit,
  ForbiddenException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource, type QueryRunner, type EntityManager } from 'typeorm';
import {
  Observable,
  from,
  switchMap,
  mergeMap,
  catchError,
  finalize,
  throwError,
} from 'rxjs';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';

export interface RequestWithRls extends Request {
  user?: AuthenticatedUser;
  queryRunner?: QueryRunner;
  entityManager?: EntityManager;
}

type AfterCommitCallback = () => Promise<void>;
const AFTER_COMMIT_CALLBACKS_KEY = 'resdigitalAfterCommitCallbacks';

export function registerAfterCommitCallback(
  entityManager: EntityManager,
  callback: AfterCommitCallback,
): void {
  const queryRunner = entityManager.queryRunner;
  if (!queryRunner?.isTransactionActive) {
    throw new Error(
      'La acción posterior al commit requiere una transacción activa.',
    );
  }

  queryRunner.data ??= {};
  const callbacks = queryRunner.data[AFTER_COMMIT_CALLBACKS_KEY];
  if (callbacks === undefined) {
    queryRunner.data[AFTER_COMMIT_CALLBACKS_KEY] = [callback];
    return;
  }
  if (!Array.isArray(callbacks)) {
    throw new Error('El registro de acciones posteriores al commit es inválido.');
  }
  (callbacks as AfterCommitCallback[]).push(callback);
}

export async function runAfterCommitCallbacks(
  queryRunner: QueryRunner,
): Promise<void> {
  if (!queryRunner.data) return;
  const callbacks = queryRunner.data[AFTER_COMMIT_CALLBACKS_KEY];
  delete queryRunner.data[AFTER_COMMIT_CALLBACKS_KEY];
  if (!Array.isArray(callbacks)) return;

  for (const callback of callbacks as AfterCommitCallback[]) {
    await callback();
  }
}

/**
 * ==============================================================================
 * VALIDACIÓN DE SEGURIDAD OBLIGATORIA (Regla de Arquitectura y RLS):
 * ------------------------------------------------------------------------------
 * El rol de base de datos que utiliza la aplicación NestJS para conectarse
 * (ej. el usuario configurado en DB_USER o DATABASE_URL) NUNCA debe poseer el
 * atributo 'BYPASSRLS' ni tener privilegios de 'SUPERUSER' en PostgreSQL.
 *
 * Si el rol tuviera 'BYPASSRLS', PostgreSQL ignoraría todas las políticas de RLS
 * definidas en las tablas, anulando por completo el aislamiento entre fincas.
 * El arranque valida la identidad de la sesión, atributos y privilegios; si no
 * coinciden con el rol dedicado, el proceso falla cerrado antes de servir HTTP.
 * ==============================================================================
 *
 * RlsTransactionInterceptor:
 * Abre una transacción aislada de TypeORM por cada petición autenticada y ejecuta:
 *   1. SELECT set_config('request.jwt.claims', $1, true);
 *   2. SET LOCAL ROLE resdigital_app;
 *
 * Mantiene la conexión fija durante toda la ejecución del handler del controlador,
 * asegurando que las consultas intermedias no se devuelvan al pool de conexiones
 * antes de que RLS aplique sus filtros.
 */
@Injectable()
export class RlsTransactionInterceptor
  implements NestInterceptor, OnModuleInit
{
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (!this.dataSource.isInitialized) {
      throw new Error(
        'La conexión PostgreSQL debe estar inicializada para activar RLS.',
      );
    }

    const [identity] = await this.dataSource.query(`
      SELECT
        session_user::text AS session_role,
        current_user::text AS current_role,
        app_role.rolsuper AS is_superuser,
        app_role.rolbypassrls AS bypasses_rls,
        EXISTS (
          SELECT 1 FROM pg_auth_members membership
          WHERE membership.member = app_role.oid
        ) AS has_role_memberships,
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
        EXISTS (
          SELECT 1 FROM pg_class relation
          JOIN pg_namespace ns ON ns.oid = relation.relnamespace
          WHERE ns.nspname = 'public' AND relation.relowner = app_role.oid
        ) AS owns_public_table
      FROM pg_roles app_role
      WHERE app_role.rolname = current_user;
    `);

    if (
      !identity ||
      identity.session_role !== 'resdigital_app' ||
      identity.current_role !== 'resdigital_app' ||
      identity.is_superuser ||
      identity.bypasses_rls ||
      identity.has_role_memberships ||
      identity.can_create_public ||
      identity.owns_public_table
    ) {
      throw new Error(
        'DATABASE_URL debe autenticar directamente como resdigital_app, sin membresías de roles, SUPERUSER, BYPASSRLS, CREATE en public ni propiedad de tablas.',
      );
    }
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithRls>();

    // Si la ruta no está autenticada (ej. ruta @Public), continuar sin transacción RLS
    if (!request.user) {
      return next.handle();
    }

    if (!this.dataSource.isInitialized) {
      throw new Error(
        'La conexión PostgreSQL no está inicializada; se deniega acceso.',
      );
    }

    this.assertAuthenticatedContext(request.user);

    const queryRunner = this.dataSource.createQueryRunner();

    return from(this.setupRlsSession(queryRunner, request.user)).pipe(
      switchMap(() => {
        // Exponer el QueryRunner y EntityManager asociado a la transacción en el request
        request.queryRunner = queryRunner;
        request.entityManager = queryRunner.manager;

        return next.handle();
      }),
      mergeMap(async (response) => {
        // Si el controlador completó con éxito, hacer commit de la transacción
        if (queryRunner.isTransactionActive) {
          await queryRunner.commitTransaction();
        }
        await runAfterCommitCallbacks(queryRunner);
        return response;
      }),
      catchError((error) => {
        // En caso de excepción en cualquier etapa del request, hacer rollback inmediato
        if (queryRunner.isTransactionActive) {
          return from(queryRunner.rollbackTransaction()).pipe(
            switchMap(() => throwError(() => error)),
          );
        }
        return throwError(() => error);
      }),
      finalize(async () => {
        // Liberar siempre la conexión al pool al finalizar la petición
        if (!queryRunner.isReleased) {
          await queryRunner.release();
        }
      }),
    );
  }

  private async setupRlsSession(
    queryRunner: QueryRunner,
    user: AuthenticatedUser,
  ): Promise<void> {
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // Inyectar el JSON de claims completo en la sesión transaccional de PostgreSQL
    const claimsJson = JSON.stringify({
      ...user.rawClaims,
      sub: user.userId,
      tenant_id: user.tenantId,
      rol: user.rol,
    });

    await queryRunner.query('SELECT set_config($1, $2, true);', [
      'request.jwt.claims',
      claimsJson,
    ]);

    // Compatibilidad con tablas creadas con la convención app.current_tenant_id (ej. animal)
    await queryRunner.query('SELECT set_config($1, $2, true);', [
      'app.current_tenant_id',
      user.tenantId,
    ]);

    // El rol dedicado aplica las políticas sin concederle membresía de authenticated.
    await queryRunner.query('SET LOCAL ROLE resdigital_app;');
  }

  private assertAuthenticatedContext(user: AuthenticatedUser): void {
    const validRoles = ['propietario', 'administrador', 'peon', 'veterinario'];
    if (
      !isUUID(user.userId) ||
      !isUUID(user.tenantId) ||
      !validRoles.includes(user.rol) ||
      !user.rawClaims ||
      typeof user.rawClaims !== 'object' ||
      Array.isArray(user.rawClaims)
    ) {
      throw new ForbiddenException(
        'Contexto de autenticación incompleto para aplicar RLS.',
      );
    }
  }
}
