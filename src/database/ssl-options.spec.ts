import { afterEach, describe, expect, it } from 'vitest';
import { buildSslOptions, needsVerifiedTls } from './ssl-options.js';

describe('buildSslOptions', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.DATABASE_CA_CERT;
  });

  it('deja sin TLS el Postgres local de desarrollo', () => {
    expect(
      buildSslOptions('postgresql://resdigital_app@127.0.0.1:5432/postgres', 'development'),
    ).toBe(false);
    expect(needsVerifiedTls('postgresql://localhost/postgres', 'test')).toBe(false);
  });

  it('exige el certificado raíz para Supabase y para producción', () => {
    expect(() =>
      buildSslOptions(
        'postgresql://resdigital_app@db.xxx.supabase.co:5432/postgres',
        'development',
      ),
    ).toThrow(/DATABASE_CA_CERT/);

    expect(() =>
      buildSslOptions('postgresql://resdigital_app@db.interno:5432/postgres', 'production'),
    ).toThrow(/DATABASE_CA_CERT/);
  });

  it('valida el certificado cuando hay CA', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    expect(
      buildSslOptions(
        'postgresql://resdigital_app@db.xxx.supabase.co:5432/postgres',
        'development',
        ca,
      ),
    ).toEqual({ rejectUnauthorized: true, ca });
  });
});
