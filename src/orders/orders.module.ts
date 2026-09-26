import { Module } from '@nestjs/common';
import { MyOrdersController, PharmacyOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/** Commandes de médicaments en pharmacie : retrait ou livraison à domicile. */
@Module({
  controllers: [MyOrdersController, PharmacyOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
