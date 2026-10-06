import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvitationsService } from '../services/invitations.service.js';
import { RolesService } from '../services/roles.service.js';
import { AuditAuthService } from '../services/audit-auth.service.js';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';

describe('Seguridad y Defensa contra Mass-Assignment de Roles (Patrón Energisa)', () => {
  let invitationsService: InvitationsService;
  let rolesService: RolesService;
  let auditService: AuditAuthService;
  let configService: ConfigService;

  const mockPropietario: AuthenticatedUser = {
    userId: 'user-propietario-111',
    tenantId: 'finca-la-esperanza-222',
    rol: 'propietario',
    email: 'don_juan@finca.cr',
    rawClaims: {},
  };

  const mockPeon: AuthenticatedUser = {
    userId: 'user-peon-333',
    tenantId: 'finca-la-esperanza-222',
    rol: 'peon',
    email: 'peon@finca.cr',
    rawClaims: {},
  };

  const mockAdministrador: AuthenticatedUser = {
    ...mockPropietario,
    userId: 'user-administrador-444',
    rol: 'administrador',
    email: 'administrador@finca.cr',
  };

  beforeEach(() => {
    auditService = new AuditAuthService();
    rolesService = new RolesService(auditService);
    configService = new ConfigService({
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    });

    invitationsService = new InvitationsService(
      rolesService,
      auditService,
      configService,
    );
  });

  it('CRÍTICO (Defensa Anti Mass-Assignment): un request de confirmación con { "rol": "propietario" } inyectado debe ser ignorado y mantener el rol legítimo asignado por el propietario', async () => {
    // 1. El propietario invita a un peón con rol 'peon'
    const inviteResult = await invitationsService.inviteUser(mockPropietario, {
      correo: 'danny@finca.cr',
      rol: 'peon',
      nombreCompleto: 'Danny Colaborador',
    });

    expect(inviteResult.success).toBe(true);
    expect(inviteResult.rolAsignado).toBe('peon');

    // Espiar a RolesService.assignRole para capturar los argumentos reales con los que se muta el rol
    const assignRoleSpy = vi.spyOn(rolesService, 'assignRole');

    // 2. ATAQUE DE MASS-ASSIGNMENT:
    // El atacante o el cliente web alterado envía en el body de confirmación { "rol": "propietario" }
    const maliciousPayload = {
      nombreCompleto: 'Danny Hacker',
      rol: 'propietario', // <-- INYECCIÓN MALICIOSA DE ROL
      isAdmin: true,
      superUser: true,
    };

    // 3. Confirmar la invitación procesando el payload no confiable
    const confirmResult = await invitationsService.confirmInvitation(
      'danny-user-uuid-999',
      mockPropietario.tenantId,
      'danny@finca.cr',
      maliciousPayload,
    );

    // 4. VERIFICACIONES DE SEGURIDAD:
    // a) El rol resultante debe ser 'peon' (el predefinido por el propietario al invitar)
    expect(confirmResult.rolFinal).toBe('peon');
    expect(confirmResult.rolFinal).not.toBe('propietario');

    // b) RolesService.assignRole debió haber sido invocado con 'peon', NUNCA con 'propietario'
    expect(assignRoleSpy).toHaveBeenCalledWith(
      'danny-user-uuid-999',
      mockPropietario.tenantId,
      'peon',
      'danny-user-uuid-999',
      undefined,
    );

    // c) El ledger de auditoría debe registrar la asignación con 'peon'
    const ledger = auditService.getLocalLedger(mockPropietario.tenantId);
    const acceptEvent = ledger.find((e) => e.tipoEvento === 'INVITACION_ACEPTADA');
    expect(acceptEvent).toBeDefined();
    expect(acceptEvent?.detalles['rolFinalAsignado']).toBe('peon');
  });

  it('debe rechazar con ForbiddenException si un usuario con rol "peon" intenta invitar a otros usuarios', async () => {
    await expect(
      invitationsService.inviteUser(mockPeon, {
        correo: 'nuevo@finca.cr',
        rol: 'peon',
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      invitationsService.inviteUser(mockPeon, {
        correo: 'nuevo@finca.cr',
        rol: 'peon',
      }),
    ).rejects.toThrow(/solo el propietario/i);
  });

  it('debe rechazar invitaciones de administrador antes de crear o notificar', async () => {
    const supabaseFetch = vi.spyOn(globalThis, 'fetch');

    await expect(
      invitationsService.inviteUser(mockAdministrador, {
        correo: 'nuevo@finca.cr',
        rol: 'peon',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(supabaseFetch).not.toHaveBeenCalled();
    expect(auditService.getLocalLedger(mockAdministrador.tenantId)).toEqual([]);
  });

  it('RolesService debe rechazar con BadRequestException si se intenta asignar un rol no existente en rol_usuario', async () => {
    await expect(
      rolesService.assignRole(
        'user-123',
        'tenant-456',
        'superadmin_fake' as unknown as 'peon',
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      rolesService.assignRole(
        'user-123',
        'tenant-456',
        'superadmin_fake' as unknown as 'peon',
      ),
    ).rejects.toThrow(/rol 'superadmin_fake' inválido/i);
  });

  it('AuditAuthService: la cadena de hashes SHA-256 debe ser válida y detectar alteraciones en el historial (Ley 8968)', async () => {
    // 1. Generar eventos secuenciales
    await auditService.logEvent('finca-test', 'LOGIN', { ip: '192.168.1.1' });
    await auditService.logEvent('finca-test', 'INVITACION_ENVIADA', {
      correo: 'ari@finca.cr',
      rol: 'veterinario',
    });
    await auditService.logEvent('finca-test', 'CAMBIO_ROL', {
      userId: 'user-ari',
      nuevoRol: 'veterinario',
    });

    const chain = auditService.getLocalLedger('finca-test');
    expect(chain.length).toBe(3);

    // 2. Verificar que la cadena íntegra pasa la verificación
    expect(auditService.verifyChain(chain)).toBe(true);

    // 3. Simular una alteración maliciosa en la base de datos (tampering)
    // El atacante cambia el detalle del evento para encubrir un cambio
    const tamperedChain = chain.map((rec) => ({
      ...rec,
      detalles: { ...rec.detalles },
    }));
    tamperedChain[1].detalles = { correo: 'ari@finca.cr', rol: 'propietario' }; // Alterado

    // 4. La verificación debe fallar inmediatamente
    expect(auditService.verifyChain(tamperedChain)).toBe(false);
  });
});
