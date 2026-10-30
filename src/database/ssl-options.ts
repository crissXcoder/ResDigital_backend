/**
 * Configuración TLS de la conexión a Postgres.
 *
 * Existe como archivo propio porque `app.module.ts` y `data-source.ts` tenían
 * dos configuraciones distintas para la MISMA base: el módulo forzaba
 * `{ rejectUnauthorized: false }` siempre, y el data-source lo condicionaba al
 * entorno. Dos fuentes de verdad para la misma decisión de seguridad.
 *
 * `rejectUnauthorized: false` desactiva la validación del certificado del
 * servidor y deja la conexión expuesta a un intermediario. El pooler de
 * Supabase presenta un certificado que no encadena contra los CA del sistema:
 * la forma correcta de hablarle es pasar su certificado raíz en
 * `DATABASE_CA_CERT` y validar. Si falta, se falla cerrado.
 */
export type PostgresSslOptions =
  | false
  | { rejectUnauthorized: true; ca: string };

export function needsVerifiedTls(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  const esSupabase = databaseUrl?.includes('supabase') ?? false;
  return esSupabase || nodeEnv === 'production';
}

export function buildSslOptions(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  caCert: string | undefined = process.env.DATABASE_CA_CERT,
): PostgresSslOptions {
  if (!needsVerifiedTls(databaseUrl, nodeEnv)) {
    return false;
  }

  const ca = caCert?.trim();
  if (!ca) {
    throw new Error(
      'DATABASE_CA_CERT es obligatorio para validar el certificado TLS de Postgres (producción o Supabase). ' +
        'Descargá el certificado raíz desde Database Settings → SSL Configuration en el dashboard de Supabase.',
    );
  }

  return { rejectUnauthorized: true, ca };
}
