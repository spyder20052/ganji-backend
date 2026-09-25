import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { NotificationsService } from './notifications.service';
import { OutboxService } from './outbox.service';
import { TickRegistry } from './tick.registry';

@Global()
@Module({
  providers: [CryptoService, AuditService, AccessService, OutboxService, NotificationsService, TickRegistry],
  exports: [CryptoService, AuditService, AccessService, OutboxService, NotificationsService, TickRegistry],
})
export class CommonModule {}
