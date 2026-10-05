export type RolUsuario =
  'propietario' | 'administrador' | 'peon' | 'veterinario';

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  rol: RolUsuario;
  email: string;
  rawClaims: Record<string, unknown>;
}

export interface UserProfileResponse {
  userId: string;
  tenantId: string;
  rol: RolUsuario;
  nombreCompleto: string;
  correo: string;
  nombreFinca: string;
}
