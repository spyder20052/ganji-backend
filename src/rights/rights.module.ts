import { Module } from '@nestjs/common';
import { COVERAGE_REGISTRY, coverageRegistryFactory } from './coverage-registry';
import { MOBILE_MONEY, mobileMoneyFactory } from './mobile-money';
import { RightsController } from './rights.controller';
import { RightsService } from './rights.service';

/** Droits : couverture ARCH ou mutuelle, estimation du reste à charge, paiement mobile. */
@Module({
  controllers: [RightsController],
  providers: [
    RightsService,
    // Adaptateurs d'interopérabilité interchangeables (bac à sable en démonstration).
    { provide: COVERAGE_REGISTRY, useFactory: coverageRegistryFactory },
    { provide: MOBILE_MONEY, useFactory: mobileMoneyFactory },
  ],
  exports: [RightsService],
})
export class RightsModule {}
