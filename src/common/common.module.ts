import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  providers: [CryptoService, AuditService, AccessService, OutboxService],
  exports: [CryptoService, AuditService, AccessService, OutboxService],
})
export class CommonModule {}
