import { Module } from '@nestjs/common';
import { EmergencyController } from './emergency.controller';
import { EmergencyService } from './emergency.service';
import { RespondersService } from './responders.service';

@Module({
  controllers: [EmergencyController],
  providers: [EmergencyService, RespondersService],
  exports: [RespondersService],
})
export class EmergencyModule {}
