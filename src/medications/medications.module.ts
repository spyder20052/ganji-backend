import { Module } from '@nestjs/common';
import { MedicationsController, PharmacyController, PrescriptionsController } from './medications.controller';
import { MedicationsService } from './medications.service';

@Module({
  controllers: [MedicationsController, PrescriptionsController, PharmacyController],
  providers: [MedicationsService],
  exports: [MedicationsService],
})
export class MedicationsModule {}
