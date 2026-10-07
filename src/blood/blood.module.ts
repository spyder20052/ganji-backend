import { Module } from '@nestjs/common';
import { BloodController } from './blood.controller';
import { BloodDispatchService } from './blood-dispatch.service';
import { BloodDonorsService } from './blood-donors.service';
import { BloodRequestsService } from './blood-requests.service';
import { BloodStockService } from './blood-stock.service';

/**
 * M4 · Sang. Quatre services, un par acteur : les demandes (soignants), les stocks (sites de transfusion),
 * les alertes et messages (qui est prévenu), les donneurs (réponses, fiche, propositions). Les canaux SMS et
 * USSD ne touchent qu'aux réponses des donneurs.
 */
@Module({
  controllers: [BloodController],
  providers: [BloodStockService, BloodDispatchService, BloodDonorsService, BloodRequestsService],
  exports: [BloodDonorsService],
})
export class BloodModule {}
