import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { buildSslOptions } from './ssl-options.js';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile?.('.env');
  } catch (error) {
    // Antes era un catch completamente vacío: si .env faltaba o estaba dañado,
    // el fallo pasaba desapercibido y el error aparecía después como un
    // "connection refused" sin relación aparente.
    console.warn(
      `[data-source] No se pudo cargar .env: ${(error as Error).message}`,
    );
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL no está definida. Es la única fuente de conexión a la base; ' +
      'no hay credenciales por defecto. Copiá .env.example a .env y completala.',
  );
}

/**
 * Los globs de entidades y migraciones dependen de cómo se invoque este archivo.
 *
 * Los scripts de package.json lo ejecutan con `tsx` directamente sobre el `.ts`,
 * pero los globs apuntaban siempre a `dist/**`. Eso obligaba a un `pnpm build`
 * previo y, peor, hacía que un `dist/` desactualizado ejecutara en silencio una
 * versión vieja de las migraciones.
 */
const ejecutandoDesdeTypeScript = import.meta.url.endsWith('.ts');

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: buildSslOptions(process.env.DATABASE_URL),
  synchronize: false, // REGLA OBLIGATORIA: nunca synchronize: true en ningún ambiente
  entities: [
    ejecutandoDesdeTypeScript ? 'src/**/*.entity.ts' : 'dist/**/*.entity.js',
  ],
  migrations: [
    ejecutandoDesdeTypeScript
      ? 'src/database/migrations/*.ts'
      : 'dist/database/migrations/*.js',
  ],
};

const AppDataSource = new DataSource(dataSourceOptions);

export default AppDataSource;
