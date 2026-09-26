import { Module } from '@nestjs/common';
import { MeCircleController, RelayVisitsController } from './circle.controller';
import { CircleService } from './circle.service';

/** Cercle de soins : relances des aidants puis visite du relais quand un rappel reste sans réponse. */
@Module({
  controllers: [MeCircleController, RelayVisitsController],
  providers: [CircleService],
  // Confirmation d'un rappel partagée avec les SMS (« 1 ») et le plan de soins.
  exports: [CircleService],
})
export class CircleModule {}
