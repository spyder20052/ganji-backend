import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { BloodModule } from '../blood/blood.module';
import { CircleModule } from '../circle/circle.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

@Module({ imports: [BloodModule, AlertsModule, CircleModule], controllers: [ChannelsController], providers: [ChannelsService] })
export class ChannelsModule {}
