import { Module } from '@nestjs/common';
import { EmergencyModule } from '../emergency/emergency.module';
import { MaternalController } from './maternal.controller';
import { MaternalService } from './maternal.service';

@Module({
  imports: [EmergencyModule],
  controllers: [MaternalController],
  providers: [MaternalService],
  exports: [MaternalService],
})
export class MaternalModule {}
