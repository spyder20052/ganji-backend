import { Module } from '@nestjs/common';
import { CareController, TeleController } from './care.controller';
import { CareService } from './care.service';

@Module({ controllers: [CareController, TeleController], providers: [CareService] })
export class CareModule {}
