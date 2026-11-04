/**
 * Swagger publica la superficie completa de la API.
 * Solo se enciende en desarrollo, o si alguien lo pide a propósito.
 */
export function isSwaggerEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  swaggerEnabled: string | undefined = process.env.SWAGGER_ENABLED,
): boolean {
  if (swaggerEnabled === 'true') return true;
  if (swaggerEnabled === 'false') return false;
  return nodeEnv === 'development';
}
