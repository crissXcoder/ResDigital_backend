import { Test, TestingModule } from '@nestjs/testing';
import type { EntityManager } from 'typeorm';
import {
  SanitaryService,
  MEDICAMENTOS_BASE,
  PADECIMIENTOS_BASE,
} from './sanitary.service.js';
import { Medicamento } from './entities/medicamento.entity.js';
import { Padecimiento } from './entities/padecimiento.entity.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const mockDbMedicamentos: Partial<Medicamento>[] = [
  {
    id: 'db-med-1',
    tenantId: TENANT_ID,
    nombreComercial: 'Cefalexina 200 Intramamaria',
    principioActivo: 'Cefalexina',
    viaAdministracion: 'Intramamaria',
    diasRetiroLecheDefault: 5,
    diasRetiroCarneDefault: 4,
  },
];

const mockDbPadecimientos: Partial<Padecimiento>[] = [
  {
    id: 'db-pad-1',
    tenantId: TENANT_ID,
    nombre: 'Mastitis clínica',
    categoria: 'Ubre',
    medicamentoSugeridoId: 'db-med-1',
    medicamentoSugerido: mockDbMedicamentos[0] as Medicamento,
  },
];

describe('SanitaryService', () => {
  let service: SanitaryService;
  const mockFind = vi.fn();

  // El servicio recibe el EntityManager de la transacción RLS, en vez de abrir
  // su propia conexión con un DataSource global.
  const managerDe = (impl: typeof mockFind) =>
    ({ find: impl }) as unknown as EntityManager;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SanitaryService],
    }).compile();

    service = module.get<SanitaryService>(SanitaryService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Lectura desde la base de datos', () => {
    it('consulta catalogo_medicamento filtrado por tenantId y devuelve lo que hay en la base', async () => {
      mockFind.mockResolvedValue(mockDbMedicamentos);

      const result = await service.getMedicamentos(
        TENANT_ID,
        managerDe(mockFind),
      );

      expect(result).toEqual(mockDbMedicamentos);
      expect(mockFind).toHaveBeenCalledWith(Medicamento, {
        where: { tenantId: TENANT_ID },
        order: { nombreComercial: 'ASC' },
      });
    });

    it('consulta catalogo_padecimiento filtrado por tenantId con su relación', async () => {
      mockFind.mockResolvedValue(mockDbPadecimientos);

      const result = await service.getPadecimientos(
        TENANT_ID,
        managerDe(mockFind),
      );

      expect(result).toEqual(mockDbPadecimientos);
      expect(mockFind).toHaveBeenCalledWith(Padecimiento, {
        where: { tenantId: TENANT_ID },
        relations: { medicamentoSugerido: true },
        order: { nombre: 'ASC' },
      });
    });
  });

  describe('Catálogo de referencia cuando la finca todavía no tiene el suyo', () => {
    it('devuelve los 4 medicamentos base con los días de retiro de Reglas-de-Negocio-Ganaderas.md', async () => {
      mockFind.mockResolvedValue([]);

      const result = await service.getMedicamentos(
        TENANT_ID,
        managerDe(mockFind),
      );

      expect(result).toHaveLength(4);
      expect(result.map((m) => m.nombreComercial)).toEqual(
        MEDICAMENTOS_BASE.map((m) => m.nombreComercial),
      );
      expect(result[0].tenantId).toBe(TENANT_ID);
      expect(result[0].diasRetiroLecheDefault).toBe(5);
      expect(result[0].diasRetiroCarneDefault).toBe(4);
    });

    it('devuelve los 10 padecimientos base con su medicamento sugerido resuelto', async () => {
      mockFind.mockResolvedValue([]);

      const result = await service.getPadecimientos(
        TENANT_ID,
        managerDe(mockFind),
      );

      expect(result).toHaveLength(10);
      expect(result.map((p) => p.nombre)).toEqual(
        PADECIMIENTOS_BASE.map((p) => p.nombre),
      );

      const mastitis = result.find((p) => p.nombre === 'Mastitis clínica');
      expect(mastitis?.medicamentoSugerido?.nombreComercial).toBe(
        'Cefalexina 200 Intramamaria',
      );
    });
  });

  describe('Los errores de base de datos ya no se disfrazan de éxito', () => {
    it('CASO LÍMITE: un fallo de consulta se propaga, en vez de devolver 200 con el catálogo en memoria', async () => {
      // Esta era la falla de fondo: SanitaryModule no registraba sus entidades,
      // así que toda consulta lanzaba EntityMetadataNotFoundError, el servicio lo
      // atrapaba con un warn y respondía 200 con UUID inventados. El endpoint
      // jamás leyó la base y nadie se enteró.
      mockFind.mockRejectedValue(new Error('EntityMetadataNotFoundError'));

      await expect(
        service.getMedicamentos(TENANT_ID, managerDe(mockFind)),
      ).rejects.toThrow('EntityMetadataNotFoundError');
    });
  });
});
