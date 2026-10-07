import { Module } from '@nestjs/common';
import { MyOrdersController, PharmacyOrdersController } from './orders.controller';
import { OrdersAccessService } from './orders-access.service';
import { OrdersService } from './orders.service';
import { OrdersWorkflowService } from './orders-workflow.service';
import { PharmacyOrdersService } from './pharmacy-orders.service';

/**
 * Commandes de médicaments en pharmacie : retrait ou livraison à domicile. Un service par côté du comptoir
 * (patient, officine), un pour les droits et la validité des ordonnances, un pour les changements d'état,
 * les remboursements, la famille prévenue et la tâche planifiée.
 */
@Module({
  controllers: [MyOrdersController, PharmacyOrdersController],
  providers: [OrdersAccessService, OrdersWorkflowService, OrdersService, PharmacyOrdersService],
  exports: [OrdersService, PharmacyOrdersService],
})
export class OrdersModule {}
