/**
 * Configuración TLS de la conexión a Postgres.
 *
 * Existe como archivo propio porque `app.module.ts` y `data-source.ts` tenían
 * dos configuraciones distintas para la MISMA base: el módulo forzaba
 * `{ rejectUnauthorized: false }` siempre, y el data-source lo condicionaba al
 * entorno. Dos fuentes de verdad para la misma decisión de seguridad.
 *
 * Sobre `rejectUnauthorized: false`: desactiva la validación del certificado del
 * servidor, lo que deja la conexión expuesta a un intermediario. El pooler de
 * Supabase presenta un certificado que no encadena contra los CA del sistema, y
 * por eso el proyecto lo desactiva. Es una deuda consciente, no un descuido: la
 * forma correcta de saldarla es descargar el certificado raíz de Supabase y
 * pasarlo en `ca`, momento en el cual `rejectUnauthorized` puede volver a true.
 */
export type PostgresSslOptions =
  false | { rejectUnauthorized: boolean; ca?: string };

export function buildSslOptions(
  databaseUrl: string | undefined,
): PostgresSslOptions {
  const esSupabase = databaseUrl?.includes('supabase') ?? false;
  const esProduccion = process.env.NODE_ENV === 'production';

  if (!esSupabase && !esProduccion) {
    // Postgres local (Docker, desarrollo, tests): normalmente sin TLS.
    return false;
  }

  const ca = process.env.DATABASE_CA_CERT;
  if (ca) {
    return { rejectUnauthorized: true, ca };
  }

  return { rejectUnauthorized: false };
}
