import { Module } from '@nestjs/common';
import { ReproductiveCalculationService } from './services/reproductive-calculation.service.js';
import { ReproductiveStateService } from './services/reproductive-state.service.js';

@Module({ providers: [ReproductiveCalculationService, ReproductiveStateService], exports: [ReproductiveCalculationService, ReproductiveStateService] })
export class ReproductiveStateModule {}
