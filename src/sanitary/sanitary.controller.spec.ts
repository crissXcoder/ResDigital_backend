import { Test, TestingModule } from '@nestjs/testing';
import type { EntityManager } from 'typeorm';
import { SanitaryController } from './sanitary.controller.js';
import { SanitaryService } from './sanitary.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { Medicamento } from './entities/medicamento.entity.js';
import type { Padecimiento } from './entities/padecimiento.entity.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const mockUser: AuthenticatedUser = {
  userId: 'user-1',
  tenantId: TENANT_ID,
  rol: 'veterinario',
  email: 'vet@finca.cr',
  rawClaims: {},
};

const mockMedicamentos: Partial<Medicamento>[] = [
  {
    id: 'med-1',
    tenantId: TENANT_ID,
    nombreComercial: 'Cefalexina 200 Intramamaria',
    principioActivo: 'Cefalexina',
    viaAdministracion: 'Intramamaria',
    diasRetiroLecheDefault: 5,
    diasRetiroCarneDefault: 4,
  },
];

const mockPadecimientos: Partial<Padecimiento>[] = [
  {
    id: 'pad-1',
    tenantId: TENANT_ID,
    nombre: 'Mastitis clínica',
    categoria: 'Ubre',
    medicamentoSugeridoId: 'med-1',
  },
];

describe('SanitaryController', () => {
  let controller: SanitaryController;

  const mockSanitaryService = {
    getMedicamentos: vi.fn(),
    getPadecimientos: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SanitaryController],
      providers: [
        {
          provide: SanitaryService,
          useValue: mockSanitaryService,
        },
      ],
    }).compile();

    controller = module.get<SanitaryController>(SanitaryController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // El controlador ahora pasa también el EntityManager de la transacción RLS,
  // en vez de dejar que el servicio abra su propia conexión sin contexto.
  const mockManager = {} as EntityManager;

  describe('GET /catalogos/medicamentos', () => {
    it('should return medicamentos for the authenticated user tenant', async () => {
      mockSanitaryService.getMedicamentos.mockResolvedValue(mockMedicamentos);

      const result = await controller.getMedicamentos(mockUser, mockManager);

      expect(result).toEqual(mockMedicamentos);
      expect(mockSanitaryService.getMedicamentos).toHaveBeenCalledWith(
        TENANT_ID,
        mockManager,
      );
    });

    it('should return empty array when no medicamentos exist', async () => {
      mockSanitaryService.getMedicamentos.mockResolvedValue([]);

      const result = await controller.getMedicamentos(mockUser, mockManager);

      expect(result).toEqual([]);
    });
  });

  describe('GET /catalogos/padecimientos', () => {
    it('should return padecimientos for the authenticated user tenant', async () => {
      mockSanitaryService.getPadecimientos.mockResolvedValue(mockPadecimientos);

      const result = await controller.getPadecimientos(mockUser, mockManager);

      expect(result).toEqual(mockPadecimientos);
      expect(mockSanitaryService.getPadecimientos).toHaveBeenCalledWith(
        TENANT_ID,
        mockManager,
      );
    });

    it('should return empty array when no padecimientos exist', async () => {
      mockSanitaryService.getPadecimientos.mockResolvedValue([]);

      const result = await controller.getPadecimientos(mockUser, mockManager);

      expect(result).toEqual([]);
    });
  });
});
