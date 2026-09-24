import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { BloodModule } from '../blood/blood.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

@Module({ imports: [BloodModule, AlertsModule], controllers: [ChannelsController], providers: [ChannelsService] })
export class ChannelsModule {}
