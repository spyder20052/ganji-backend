import { Module } from '@nestjs/common';
import { CircleModule } from '../circle/circle.module';
import { CareController, TeleController } from './care.controller';
import { CareService } from './care.service';

@Module({ imports: [CircleModule], controllers: [CareController, TeleController], providers: [CareService] })
export class CareModule {}
