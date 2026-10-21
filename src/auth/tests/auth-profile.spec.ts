import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../auth.controller.js';
import type { InvitationsService } from '../services/invitations.service.js';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface.js';
import type { RequestWithRls } from '../interceptors/rls-transaction.interceptor.js';

const user: AuthenticatedUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  rol: 'propietario', email: 'rf001@example.com', rawClaims: {},
};

describe('RF-001 perfil y finca activa', () => {
  const query = vi.fn();
  const controller = new AuthController({} as InvitationsService);
  const request = { entityManager: { query } } as unknown as RequestWithRls;
  beforeEach(() => { query.mockReset(); });

  it('rechaza un perfil sin contexto transaccional', async () => {
    await expect(controller.getPerfil(user, {} as RequestWithRls)).rejects.toThrow(InternalServerErrorException);
  });

  it('rechaza una sesión sin pertenencia activa en la finca', async () => {
    query.mockResolvedValue([]);
    await expect(controller.getPerfil(user, request)).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza una finca inexistente sin devolver éxito parcial', async () => {
    query.mockResolvedValueOnce([{ nombre_completo: 'QA RF001', correo: user.email }]).mockResolvedValueOnce([]);
    await expect(controller.getPerfil(user, request)).rejects.toThrow(UnauthorizedException);
  });

  it('no oculta un error de base de datos como perfil válido', async () => {
    query.mockRejectedValue(new Error('database unavailable'));
    await expect(controller.getPerfil(user, request)).rejects.toThrow('database unavailable');
  });

  it('devuelve los datos persistidos de la pertenencia y finca', async () => {
    query.mockResolvedValueOnce([{ nombre_completo: 'QA RF001', correo: user.email }])
      .mockResolvedValueOnce([{ nombre_finca: 'QA RF001 finca A' }]);
    await expect(controller.getPerfil(user, request)).resolves.toEqual({
      userId: user.userId, tenantId: user.tenantId, rol: user.rol,
      nombreCompleto: 'QA RF001', correo: user.email, nombreFinca: 'QA RF001 finca A',
    });
    expect(query).toHaveBeenNthCalledWith(1,
      expect.stringMatching(/tenant_id = \$2.*activo = true.*rol = \$3/s),
      [user.userId, user.tenantId, user.rol]);
  });
});
