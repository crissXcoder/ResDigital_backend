import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager, QueryRunner } from 'typeorm';
import { InvitationsService } from '../services/invitations.service.js';
import { RolesService } from '../services/roles.service.js';
import { AuditAuthService } from '../services/audit-auth.service.js';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';
import { runAfterCommitCallbacks } from '../interceptors/rls-transaction.interceptor.js';

interface TestInvitation {
  id: string;
  tenantId: string;
  correo: string;
  rol: AuthenticatedUser['rol'];
  invitadoPor: string;
  estado: 'PENDIENTE' | 'ACEPTADA' | 'CANCELADA';
  createdAt: string;
}

interface TestAuditRow {
  id: string;
  tenantId: string;
  usuarioId: string | null;
  tipoEvento: string;
  detalles: Record<string, unknown>;
  prevHash: string;
  currHash: string;
  createdAt: string;
}

function makeManager() {
  const tenantId = 'finca-la-esperanza-222';
  const invitationRows: TestInvitation[] = [];
  const auditRows: TestAuditRow[] = [];
  const userTenants = new Map<string, string>([
    ['danny-user-uuid-999', tenantId],
  ]);
  const userEmails = new Set<string>();
  const queryRunner: { isTransactionActive: boolean; data: Record<string, unknown> } = {
    isTransactionActive: true,
    data: {},
  };
  const query = vi.fn(
    async (sql: string, parameters: unknown[] = []): Promise<unknown[]> => {
      const statement = sql.replace(/\s+/g, ' ').trim();
      if (statement.startsWith('SELECT pg_advisory_xact_lock')) return [];

      if (statement.startsWith('SELECT tenant_id FROM public.invitacion')) {
        return invitationRows.some(
          (row) => row.correo === parameters[0] && row.tenantId !== parameters[1] && row.estado === 'PENDIENTE',
        ) ? [{ tenant_id: 'otra-finca' }] : [];
      }
      if (statement.startsWith('SELECT id, correo, rol, estado, created_at, now()')) {
        return invitationRows.filter((row) => row.tenantId === parameters[0]).map((row) => ({
          id: row.id, correo: row.correo, rol: row.rol, estado: row.estado,
          created_at: row.createdAt, ahora: new Date().toISOString(),
        }));
      }
      if (statement.startsWith('SELECT id FROM public.usuario WHERE lower(correo)')) {
        return userEmails.has(String(parameters[0])) ? [{ id: 'existing-user' }] : [];
      }

      if (statement.includes('SELECT curr_hash, created_at')) {
        const rows = auditRows
          .filter((row) => row.tenantId === parameters[0])
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return rows.slice(0, 1).map((row) => ({
          curr_hash: row.currHash,
          created_at: row.createdAt,
        }));
      }

      if (statement.startsWith('INSERT INTO public.evento_auth')) {
        auditRows.push({
          id: String(parameters[0]),
          tenantId: String(parameters[1]),
          usuarioId:
            typeof parameters[2] === 'string' ? parameters[2] : null,
          tipoEvento: String(parameters[3]),
          detalles: JSON.parse(String(parameters[4])) as Record<string, unknown>,
          prevHash: String(parameters[5]),
          currHash: String(parameters[6]),
          createdAt: String(parameters[7]),
        });
        return [];
      }

      if (statement.startsWith('INSERT INTO public.invitacion')) {
        const emailValue = parameters[2];
        const email = typeof emailValue === 'string' ? emailValue : '';
        const tenant = String(parameters[1]);
        const existing = invitationRows.find(
          (row) => row.correo === email && row.tenantId === tenant,
        );
        if (existing) {
          existing.rol = parameters[3] as AuthenticatedUser['rol'];
          existing.invitadoPor = String(parameters[4]);
          existing.estado = 'PENDIENTE';
          existing.createdAt = new Date().toISOString();
          return [{ id: existing.id, created_at: existing.createdAt }];
        }
        const invitation: TestInvitation = {
          id: String(parameters[0]),
          tenantId: tenant,
          correo: email,
          rol: parameters[3] as AuthenticatedUser['rol'],
          invitadoPor: String(parameters[4]),
          estado: 'PENDIENTE',
          createdAt: new Date().toISOString(),
        };
        invitationRows.push(invitation);
        return [{ id: invitation.id, created_at: invitation.createdAt }];
      }

      if (statement.startsWith('SELECT id, rol, created_at FROM public.invitacion')) {
        const invitation = invitationRows.find(
          (row) =>
            row.id === parameters[0] && row.correo === parameters[1] &&
            row.tenantId === parameters[2] && row.estado === 'PENDIENTE' &&
            Date.parse(row.createdAt) > Date.now() - 24 * 60 * 60 * 1000,
        );
        return invitation
          ? [{ id: invitation.id, rol: invitation.rol, created_at: invitation.createdAt }]
          : [];
      }

      if (statement.startsWith('UPDATE public.usuario')) {
        const userId = String(parameters[1]);
        return userTenants.get(userId) === parameters[2]
          ? [{ id: userId }]
          : [];
      }

      if (statement.startsWith('UPDATE public.invitacion')) {
        const invitation = invitationRows.find(
          (row) =>
            row.id === parameters[0] &&
            row.tenantId === parameters[1] &&
            row.estado === 'PENDIENTE',
        );
        if (!invitation) return [];
        invitation.estado = 'ACEPTADA';
        return [{ id: invitation.id }];
      }

      throw new Error(`Consulta no prevista en el doble explícito: ${statement}`);
    },
  );
  const manager = { query, queryRunner } as unknown as EntityManager;
  return { manager, query, queryRunner, invitationRows, auditRows, userTenants, userEmails };
}

describe('Invitaciones y auditoría sin fallback de memoria', () => {
  let invitationsService: InvitationsService;
  let rolesService: RolesService;
  let auditService: AuditAuthService;
  let db: ReturnType<typeof makeManager>;
  let fetchMock: ReturnType<typeof vi.fn>;

  const owner: AuthenticatedUser = {
    userId: 'user-propietario-111',
    tenantId: 'finca-la-esperanza-222',
    rol: 'propietario',
    email: 'duena@finca.cr',
    rawClaims: {},
  };
  const peon: AuthenticatedUser = {
    ...owner,
    userId: 'user-peon-333',
    rol: 'peon',
    email: 'peon@finca.cr',
  };

  beforeEach(() => {
    db = makeManager();
    auditService = new AuditAuthService();
    rolesService = new RolesService(auditService);
    const configService = new ConfigService({
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      FRONTEND_URL: 'https://frontend.local',
    });
    invitationsService = new InvitationsService(
      rolesService,
      auditService,
      configService,
    );
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  it('persists invitation and audit in the request transaction, then sends after commit', async () => {
    const response = await invitationsService.inviteUser(
      owner,
      {
        correo: 'Danny@finca.cr',
        rol: 'peon',
        nombreCompleto: 'Danny Colaborador',
      },
      db.manager,
    );

    expect(response).toMatchObject({ success: true, rolAsignado: 'peon', emailSent: null });
    expect(Date.parse(response.expiresAt)).toBeGreaterThan(Date.now());
    expect(db.invitationRows[0]?.correo).toBe('danny@finca.cr');
    expect(db.auditRows.map((row) => row.tipoEvento)).toEqual(['INVITACION_ENVIADA']);
    expect(fetchMock).not.toHaveBeenCalled();

    db.queryRunner.isTransactionActive = false;
    await runAfterCommitCallbacks(db.queryRunner as QueryRunner);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(response.emailSent).toBe(true);
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get('redirect_to')).toBe('https://frontend.local/aceptar-invitacion');
    expect(JSON.parse(String(options.body))).toMatchObject({ data: { invitacion_id: db.invitationRows[0]?.id } });
    expect(JSON.parse(String(options.body))).not.toHaveProperty('app_metadata');
  });

  it('reports failed Auth delivery without claiming the email was sent', async () => {
    fetchMock.mockResolvedValueOnce(new Response('rejected', { status: 503 }));
    const response = await invitationsService.inviteUser(
      owner,
      { correo: 'nuevo@finca.cr', rol: 'peon' },
      db.manager,
    );

    db.queryRunner.isTransactionActive = false;
    await runAfterCommitCallbacks(db.queryRunner as QueryRunner);

    expect(response.success).toBe(true);
    expect(response.emailSent).toBe(false);
    expect(db.invitationRows).toHaveLength(1);
  });

  it('propagates database failures and never schedules email delivery', async () => {
    db.query.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      invitationsService.inviteUser(
        owner,
        { correo: 'nuevo@finca.cr', rol: 'peon' },
        db.manager,
      ),
    ).rejects.toThrow('database unavailable');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.queryRunner.data).toEqual({});
  });

  it('propagates audit write failures so the request transaction can roll back', async () => {
    db.query.mockImplementation(async (sql, parameters = []) => {
      if (sql.startsWith('INSERT INTO public.evento_auth')) {
        throw new Error('audit write failed');
      }
      return makeManager().query(sql, parameters);
    });

    await expect(
      invitationsService.inviteUser(
        owner,
        { correo: 'nuevo@finca.cr', rol: 'peon' },
        db.manager,
      ),
    ).rejects.toThrow('audit write failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.queryRunner.data).toEqual({});
  });

  it('rejects invitation and audit operations without an active database transaction', async () => {
    db.queryRunner.isTransactionActive = false;

    await expect(
      invitationsService.inviteUser(
        owner,
        { correo: 'nuevo@finca.cr', rol: 'peon' },
        db.manager,
      ),
    ).rejects.toThrow(/transacción PostgreSQL activa/i);
    await expect(
      auditService.logEvent('tenant', 'LOGIN', {}, undefined, db.manager),
    ).rejects.toThrow(/transacción PostgreSQL activa/i);
    await expect(
      rolesService.assignRole('user', 'tenant', 'peon', undefined, db.manager),
    ).rejects.toThrow(/transacción PostgreSQL activa/i);
  });

  it('does not fall back to an in-memory invitation when no pending row exists', async () => {
    await expect(
      invitationsService.confirmInvitation(
        'danny-user-uuid-999',
        owner.tenantId,
        'danny@finca.cr',
        { invitacionId: '11111111-1111-4111-8111-111111111111', nombreCompleto: 'Invitado' },
        db.manager,
      ),
    ).rejects.toThrow(/invitación no está vigente/i);
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('rejects an expired invitation before changing the user role', async () => {
    const inviteResult = await invitationsService.inviteUser(
      owner,
      { correo: 'danny@finca.cr', rol: 'peon' },
      db.manager,
    );
    db.invitationRows[0]!.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    await expect(invitationsService.confirmInvitation(
      'danny-user-uuid-999', owner.tenantId, 'danny@finca.cr',
      { invitacionId: inviteResult.invitacionId, nombreCompleto: 'QA' }, db.manager,
    )).rejects.toThrow(/no está vigente/i);
    expect(db.invitationRows[0]?.estado).toBe('PENDIENTE');
    expect(db.auditRows.map((row) => row.tipoEvento)).toEqual(['INVITACION_ENVIADA']);
  });

  it('lists persisted invitation state and expiry only for the requested finca', async () => {
    const invite = await invitationsService.inviteUser(
      owner, { correo: 'danny@finca.cr', rol: 'peon' }, db.manager,
    );
    db.invitationRows.push({
      id: 'finca-b-invite', tenantId: 'finca-b', correo: 'otra@finca.cr',
      rol: 'veterinario', invitadoPor: 'owner-b', estado: 'PENDIENTE',
      createdAt: new Date().toISOString(),
    });

    const rows = await invitationsService.listInvitations(owner.tenantId, db.manager);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invitacionId: invite.invitacionId,
      correo: 'danny@finca.cr',
      estado: 'PENDIENTE',
      expiresAt: invite.expiresAt,
    });
  });

  it('does not accept an invitation under a different finca token', async () => {
    const invite = await invitationsService.inviteUser(
      owner, { correo: 'danny@finca.cr', rol: 'peon' }, db.manager,
    );
    await expect(invitationsService.confirmInvitation(
      'danny-user-uuid-999', 'finca-b', 'danny@finca.cr',
      { invitacionId: invite.invitacionId, nombreCompleto: 'QA' }, db.manager,
    )).rejects.toThrow(/no está vigente/i);
    expect(db.invitationRows[0]?.estado).toBe('PENDIENTE');
  });

  it('discards a client supplied role and applies only the persisted invitation role', async () => {
    const inviteResult = await invitationsService.inviteUser(
      owner,
      { correo: 'danny@finca.cr', rol: 'peon' },
      db.manager,
    );
    expect(inviteResult.rolAsignado).toBe('peon');

    const result = await invitationsService.confirmInvitation(
      'danny-user-uuid-999',
      owner.tenantId,
      'danny@finca.cr',
      {
        invitacionId: inviteResult.invitacionId,
        nombreCompleto: 'Invitado de prueba',
        rol: 'propietario',
        isAdmin: true,
      },
      db.manager,
    );

    expect(result.rolFinal).toBe('peon');
    expect(db.invitationRows[0]?.estado).toBe('ACEPTADA');
    expect(db.auditRows.map((row) => row.tipoEvento)).toEqual([
      'INVITACION_ENVIADA',
      'CAMBIO_ROL',
      'INVITACION_ACEPTADA',
    ]);
    expect(auditService.verifyChain(db.auditRows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      usuarioId: row.usuarioId ?? undefined,
      tipoEvento: row.tipoEvento as 'LOGIN' | 'INVITACION_ENVIADA' | 'INVITACION_ACEPTADA' | 'CAMBIO_ROL',
      detalles: row.detalles,
      prevHash: row.prevHash,
      currHash: row.currHash,
      createdAt: row.createdAt,
    })))).toBe(true);
  });

  it('rejects invalid roles and invitations from users without owner privileges', async () => {
    await expect(
      invitationsService.inviteUser(
        peon,
        { correo: 'otro@finca.cr', rol: 'peon' },
        db.manager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      rolesService.assignRole(
        'user-123',
        owner.tenantId,
        'superadmin_fake' as unknown as 'peon',
        undefined,
        db.manager,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects an existing account and a pending invitation for another finca', async () => {
    db.userEmails.add('existente@finca.cr');
    await expect(invitationsService.inviteUser(
      owner, { correo: 'EXISTENTE@finca.cr', rol: 'peon' }, db.manager,
    )).rejects.toThrow(/ya pertenece/i);

    db.invitationRows.push({
      id: 'otra-invitacion', tenantId: 'otra-finca', correo: 'otra@finca.cr',
      rol: 'peon', invitadoPor: 'owner', estado: 'PENDIENTE', createdAt: new Date().toISOString(),
    });
    await expect(invitationsService.inviteUser(
      owner, { correo: 'otra@finca.cr', rol: 'peon' }, db.manager,
    )).rejects.toThrow(/otra finca/i);
  });
});
