import { z } from 'zod';

/**
 * Validación de variables de entorno al arranque.
 *
 * Antes, `ConfigModule.forRoot` no validaba nada: la aplicación levantaba sin
 * `DATABASE_URL` y recién fallaba en la primera consulta, con un error que no
 * decía nada del problema real. Es preferible no arrancar.
 *
 * Se usa zod porque ya era dependencia del proyecto; no hace falta sumar Joi.
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3001),

    DATABASE_URL: z
      .string()
      .min(
        1,
        'DATABASE_URL es obligatoria: es la única fuente de conexión a la base.',
      ),

    SUPABASE_URL: z.string().url('SUPABASE_URL debe ser una URL válida.'),

    // Opcionales: el guard usa JWKS remoto, no el secreto simétrico.
    SUPABASE_JWT_SECRET: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),

    FRONTEND_URL: z.string().optional(),
    SWAGGER_ENABLED: z.string().optional(),
    DATABASE_CA_CERT: z.string().optional(),

    THROTTLE_TTL: z.coerce.number().int().positive().default(60000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
  })
  // En producción el origen de CORS no puede quedar en su valor por defecto:
  // sin esto, un despliegue mal configurado sirve peticiones a localhost.
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.FRONTEND_URL), {
    message:
      'FRONTEND_URL es obligatoria en producción (origen permitido de CORS).',
    path: ['FRONTEND_URL'],
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const resultado = envSchema.safeParse(config);

  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Configuración de entorno inválida. Revisá tu archivo .env (hay una plantilla en .env.example):\n${detalle}`,
    );
  }

  return resultado.data;
}
