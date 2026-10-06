import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';

export type TipoEventoAuth =
  | 'LOGIN'
  | 'INVITACION_ENVIADA'
  | 'INVITACION_ACEPTADA'
  | 'CAMBIO_ROL';

export interface EventoAuthRecord {
  id: string;
  tenantId: string;
  usuarioId?: string;
  tipoEvento: TipoEventoAuth;
  detalles: Record<string, unknown>;
  prevHash: string;
  currHash: string;
  createdAt: string;
}

const GENESIS_HASH = '0'.repeat(64);

@Injectable()
export class AuditAuthService {
  private readonly logger = new Logger(AuditAuthService.name);

  /**
   * Registra un evento auditable dentro de la transacción de la operación.
   * El lock por tenant serializa la construcción de la cadena y los errores SQL
   * se propagan para que la operación de negocio revierta junto con la auditoría.
   */
  async logEvent(
    tenantId: string,
    tipoEvento: TipoEventoAuth,
    detalles: Record<string, unknown>,
    usuarioId: string | undefined,
    entityManager: EntityManager,
  ): Promise<EventoAuthRecord> {
    const manager = this.requireTransactionManager(entityManager);

    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0));',
      [`evento_auth:${tenantId}`],
    );

    const rows = await manager.query<
      { curr_hash: string; created_at: string | Date }[]
    >(
      `SELECT curr_hash, created_at
         FROM public.evento_auth
        WHERE tenant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1;`,
      [tenantId],
    );
    const previous = rows[0];
    const previousTime = previous ? new Date(previous.created_at).getTime() : 0;
    const createdAt = new Date(
      Math.max(Date.now(), previousTime + 1),
    ).toISOString();
    const prevHash = previous?.curr_hash ?? GENESIS_HASH;
    const id = randomUUID();
    const payloadToHash = this.canonicalJson({
      id,
      tenantId,
      usuarioId: usuarioId || null,
      tipoEvento,
      detalles,
      createdAt,
    });
    const currHash = createHash('sha256')
      .update(prevHash + payloadToHash)
      .digest('hex');

    const record: EventoAuthRecord = {
      id,
      tenantId,
      usuarioId,
      tipoEvento,
      detalles,
      prevHash,
      currHash,
      createdAt,
    };

    await manager.query(
      `INSERT INTO public.evento_auth (
        id, tenant_id, usuario_id, tipo_evento, detalles, prev_hash, curr_hash, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [
        record.id,
        record.tenantId,
        record.usuarioId || null,
        record.tipoEvento,
        JSON.stringify(record.detalles),
        record.prevHash,
        record.currHash,
        record.createdAt,
      ],
    );

    this.logger.log(`Evento de autenticación persistido: ${tipoEvento}.`);
    return record;
  }

  async getLatestHash(
    tenantId: string,
    entityManager: EntityManager,
  ): Promise<string> {
    const manager = this.requireTransactionManager(entityManager);
    const rows = await manager.query<{ curr_hash: string }[]>(
      `SELECT curr_hash
         FROM public.evento_auth
        WHERE tenant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1;`,
      [tenantId],
    );
    return rows[0]?.curr_hash ?? GENESIS_HASH;
  }

  verifyChain(records: EventoAuthRecord[]): boolean {
    let expectedPrevHash = GENESIS_HASH;

    for (const record of records) {
      if (record.prevHash !== expectedPrevHash) return false;

      const payload = this.canonicalJson({
        id: record.id,
        tenantId: record.tenantId,
        usuarioId: record.usuarioId || null,
        tipoEvento: record.tipoEvento,
        detalles: record.detalles,
        createdAt: record.createdAt,
      });
      const computedHash = createHash('sha256')
        .update(record.prevHash + payload)
        .digest('hex');

      if (computedHash !== record.currHash) return false;
      expectedPrevHash = record.currHash;
    }

    return true;
  }

  private requireTransactionManager(
    entityManager: EntityManager | undefined,
  ): EntityManager {
    if (!entityManager?.queryRunner?.isTransactionActive) {
      throw new Error(
        'La auditoría de autenticación requiere una transacción PostgreSQL activa.',
      );
    }
    return entityManager;
  }

  private canonicalJson(obj: unknown): string {
    return JSON.stringify(obj, (_, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value)
          .sort()
          .reduce<Record<string, unknown>>((sorted, key) => {
            sorted[key] = (value as Record<string, unknown>)[key];
            return sorted;
          }, {});
      }
      return value;
    });
  }
}
