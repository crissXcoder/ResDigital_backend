import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../dist/app.module.js';

const root = resolve(import.meta.dirname, '..');
const backendSpec = resolve(root, 'openapi.json');
const frontendSpec = resolve(root, '../frontend/lib/api/openapi.json');
const checkOnly = process.argv.includes('--check');
const syncFrontend = process.argv.includes('--sync-frontend');

const app = await NestFactory.create(AppModule, { logger: false });
let generated;
try {
  await app.init();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ResDigital API')
      .setDescription('API del sistema de gestión ganadera ResDigital')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  generated = `${JSON.stringify(document, null, 2)}\n`;
} finally {
  await app.close();
}

if (checkOnly) {
  const current = readFileSync(backendSpec, 'utf8');
  if (current !== generated) {
    process.stderr.write(
      'openapi.json no coincide con los controladores actuales. Ejecutá pnpm openapi:generate y revisá el diff.\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('OpenAPI coincide con los controladores actuales.\n');
  }
} else {
  writeFileSync(backendSpec, generated, 'utf8');
  if (syncFrontend) writeFileSync(frontendSpec, generated, 'utf8');
  process.stdout.write(
    syncFrontend
      ? 'openapi.json actualizado en backend y frontend.\n'
      : 'openapi.json actualizado; sincronizá frontend/lib/api/openapi.json antes de regenerar tipos.\n',
  );
}
