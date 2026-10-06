import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'animal_docs';
const MAX_BYTES = 10 * 1024 * 1024;

@Injectable()
export class AnimalDocumentStorageService {
  private client: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {}

  async validateObject(objectPath: string): Promise<void> {
    const { data, error } = await this.bucketStorage().download(objectPath);
    if (error || !data) {
      throw new InternalServerErrorException(
        'No se pudo verificar el archivo almacenado.',
      );
    }

    if (data.size === 0 || data.size > MAX_BYTES) {
      throw new InternalServerErrorException(
        'El archivo almacenado supera el límite permitido o está vacío.',
      );
    }

    const bytes = new Uint8Array(await data.arrayBuffer());
    const extension = objectPath.split('.').at(-1)?.toLowerCase();
    const valid =
      (extension === 'pdf' && hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) ||
      (extension === 'png' && hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
      (extension === 'jpg' && hasPrefix(bytes, [0xff, 0xd8, 0xff]));

    if (!valid) {
      throw new InternalServerErrorException(
        'El contenido del archivo no coincide con su tipo permitido.',
      );
    }
  }

  async removeObject(objectPath: string): Promise<void> {
    const { error } = await this.bucketStorage().remove([objectPath]);
    if (error) {
      throw new Error('No se pudo retirar el archivo sin registro.');
    }
  }

  private bucketStorage(): ReturnType<SupabaseClient['storage']['from']> {
    if (!this.client) {
      const url = this.config.get<string>('SUPABASE_URL');
      const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !key) {
        throw new InternalServerErrorException(
          'La validación confiable de archivos no está configurada.',
        );
      }

      this.client = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }

    return this.client.storage.from(BUCKET);
  }
}

function hasPrefix(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}
