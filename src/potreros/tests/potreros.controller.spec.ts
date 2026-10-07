import { Test, TestingModule } from '@nestjs/testing';
import { PotrerosController } from '../potreros.controller.js';
import { PotrerosService } from '../potreros.service.js';
import { CreatePotreroDto } from '../dto/create-potrero.dto.js';
import { EntityManager } from 'typeorm';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

const mockPotrerosService = {
  create: vi.fn(),
  findAll: vi.fn(),
  findOne: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  asignarAnimales: vi.fn(),
  obtenerMovimientosPotrero: vi.fn(),
  obtenerMovimientosAnimal: vi.fn(),
};


const mockEntityManager = {} as EntityManager;

describe('PotrerosController', () => {
  let controller: PotrerosController;
  let service: PotrerosService;

  const TENANT_ID = '00000000-0000-0000-0000-000000000001';
  // El controlador recibe el usuario ya tipado vía @CurrentUser(), en vez de
  // hurgar en `req.user` con un `any`.
  const mockRequest: AuthenticatedUser = {
    userId: 'user-test-1',
    tenantId: TENANT_ID,
    rol: 'propietario',
    email: 'propietario@finca.cr',
    rawClaims: {},
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PotrerosController],
      providers: [
        {
          provide: PotrerosService,
          useValue: mockPotrerosService,
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true }) // We test Roles decorators separately or via e2e
      .compile();

    controller = module.get<PotrerosController>(PotrerosController);
    service = module.get<PotrerosService>(PotrerosService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create a potrero using CurrentEntityManager', async () => {
    const dto: CreatePotreroDto = {
      nombre: 'Potrero 1',
      areaHa: 10,
      capacidadRecomendadaUaHa: 2,
      diasDescansoRecomendados: 30,
    };

    mockPotrerosService.create.mockResolvedValue({ id: '123', ...dto });

    const result = await controller.create(mockRequest, dto, mockEntityManager);

    expect(service.create).toHaveBeenCalledWith(
      TENANT_ID,
      dto,
      mockEntityManager,
    );
    expect(result).toEqual({ id: '123', ...dto });
  });

  it('should return all potreros using CurrentEntityManager', async () => {
    mockPotrerosService.findAll.mockResolvedValue([]);

    const result = await controller.findAll(mockRequest, mockEntityManager);

    expect(service.findAll).toHaveBeenCalledWith(TENANT_ID, mockEntityManager);
    expect(result).toEqual([]);
  });

  it('should get a specific potrero using CurrentEntityManager', async () => {
    mockPotrerosService.findOne.mockResolvedValue({ id: '123' });

    const result = await controller.findOne(
      mockRequest,
      '123',
      mockEntityManager,
    );

    expect(service.findOne).toHaveBeenCalledWith(
      '123',
      TENANT_ID,
      mockEntityManager,
    );
    expect(result).toEqual({ id: '123' });
  });

  it('should update a potrero using CurrentEntityManager', async () => {
    const dto = { nombre: 'Potrero Updated' };
    mockPotrerosService.update.mockResolvedValue({ id: '123', ...dto });

    const result = await controller.update(
      mockRequest,
      '123',
      dto,
      mockEntityManager,
    );

    expect(service.update).toHaveBeenCalledWith(
      '123',
      TENANT_ID,
      dto,
      mockEntityManager,
    );
    expect(result).toEqual({ id: '123', ...dto });
  });

  it('should delete a potrero using CurrentEntityManager', async () => {
    mockPotrerosService.remove.mockResolvedValue({ id: '123' });

    const result = await controller.remove(
      mockRequest,
      '123',
      mockEntityManager,
    );

    expect(service.remove).toHaveBeenCalledWith(
      '123',
      TENANT_ID,
      mockEntityManager,
    );
    expect(result).toEqual({ id: '123' });
  });

  it('should asignar animales using CurrentEntityManager', async () => {
    mockPotrerosService.asignarAnimales.mockResolvedValue({ id: '123' });

    const dto = { animalIds: ['a1'], fecha: '2026-10-06', motivo: 'Rotación' };
    const result = await controller.asignarAnimales(
      mockRequest,
      '123',
      dto,
      mockEntityManager,
    );

    expect(service.asignarAnimales).toHaveBeenCalledWith(
      '123',
      TENANT_ID,
      mockRequest.userId,
      dto,
      mockEntityManager,
    );
    expect(result).toEqual({ id: '123' });
  });

  it('should get movimientos of a potrero using CurrentEntityManager', async () => {
    const mockMovimientos = [
      {
        id: 'ev-1',
        tipo: 'INGRESO',
        fechaEvento: '2026-10-06',
        animal: { id: 'a1', areteInterno: '001', nombre: 'Parda' },
        potreroOrigen: null,
        potreroDestino: { id: '123', nombre: 'Potrero 1' },
      },
    ];
    mockPotrerosService.obtenerMovimientosPotrero.mockResolvedValue(mockMovimientos);

    const result = await controller.obtenerMovimientosPotrero(
      mockRequest,
      '123',
      mockEntityManager,
    );

    expect(service.obtenerMovimientosPotrero).toHaveBeenCalledWith(
      '123',
      TENANT_ID,
      mockEntityManager,
    );
    expect(result).toEqual(mockMovimientos);
  });

  it('should get movimientos of an animal using CurrentEntityManager', async () => {
    const mockMovimientos = [
      {
        id: 'ev-1',
        fechaEvento: '2026-10-06',
        potreroOrigen: null,
        potreroDestino: { id: '123', nombre: 'Potrero 1' },
      },
    ];
    mockPotrerosService.obtenerMovimientosAnimal.mockResolvedValue(mockMovimientos);

    const result = await controller.obtenerMovimientosAnimal(
      mockRequest,
      'animal-1',
      mockEntityManager,
    );

    expect(service.obtenerMovimientosAnimal).toHaveBeenCalledWith(
      'animal-1',
      TENANT_ID,
      mockEntityManager,
    );
    expect(result).toEqual(mockMovimientos);
  });
});
