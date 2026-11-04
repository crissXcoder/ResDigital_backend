import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';
import { isSwaggerEnabled } from './swagger.js';

const base = {
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL: 'postgresql://resdigital_app@127.0.0.1:5432/postgres',
  SUPABASE_URL: 'https://demo.supabase.co',
};

describe('validateEnv', () => {
  it('arranca en desarrollo local sin certificado TLS', () => {
    expect(validateEnv(base).DATABASE_URL).toContain('127.0.0.1');
  });

  it('exige FRONTEND_URL y DATABASE_CA_CERT en producción', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://resdigital_app@db.xxx.supabase.co:5432/postgres',
      }),
    ).toThrow(/FRONTEND_URL|DATABASE_CA_CERT/);

    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://app.resdigital.cr',
        DATABASE_URL: 'postgresql://resdigital_app@db.xxx.supabase.co:5432/postgres',
      }),
    ).toThrow(/DATABASE_CA_CERT/);
  });

  it('exige el CA también en desarrollo cuando la URL es de Supabase', () => {
    expect(() =>
      validateEnv({
        ...base,
        DATABASE_URL: 'postgresql://resdigital_app@db.xxx.supabase.co:5432/postgres',
      }),
    ).toThrow(/DATABASE_CA_CERT/);
  });
});

describe('isSwaggerEnabled', () => {
  it('queda apagado fuera de desarrollo salvo que se pida a propósito', () => {
    expect(isSwaggerEnabled('test')).toBe(false);
    expect(isSwaggerEnabled('production')).toBe(false);
    expect(isSwaggerEnabled('development')).toBe(true);
    expect(isSwaggerEnabled('production', 'true')).toBe(true);
    expect(isSwaggerEnabled('development', 'false')).toBe(false);
  });
});
