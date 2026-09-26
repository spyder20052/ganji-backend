import { Module } from '@nestjs/common';
import { CircleModule } from '../circle/circle.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

/** Assistant de traitement : plan de prises, confirmation, questions sur son traitement. */
@Module({
  // Les prises confirmées passent par le cercle de soins (aidants rassurés, visite du relais annulée).
  imports: [CircleModule],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
