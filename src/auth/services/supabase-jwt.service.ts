import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

@Injectable()
export class SupabaseJwtService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseJwtService.name);
  private jwks!: JWTVerifyGetKey;
  private jwksUrl!: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const supabaseUrl =
      this.configService.get<string>('SUPABASE_URL') || process.env.SUPABASE_URL;

    if (!supabaseUrl) {
      const errorMsg =
        'SUPABASE_URL no está configurada. Se requiere para obtener el JWKS de autenticación.';
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Limpiar barra diagonal final si existe
    const normalizedUrl = supabaseUrl.replace(/\/+$/, '');
    this.jwksUrl = `${normalizedUrl}/auth/v1/.well-known/jwks.json`;

    // createRemoteJWKSet de jose maneja caché interna, enfriamiento y rotación automática de llaves
    this.jwks = createRemoteJWKSet(new URL(this.jwksUrl));

    this.logger.log(`Supabase JWKS inicializado contra: ${this.jwksUrl} (Algoritmo esperado: ES256)`);
  }

  /**
   * Verifica la validez y firma del token contra el JWKS de Supabase.
   * Restringido estrictamente al algoritmo asimétrico ES256.
   */
  async verifyToken(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: ['ES256'],
      });
      return payload;
    } catch (error) {
      this.logger.warn(`Fallo de verificación de JWT: ${(error as Error).message}`);
      throw error;
    }
  }

  getJwksUrl(): string {
    return this.jwksUrl;
  }
}
