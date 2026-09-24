import { Module } from '@nestjs/common';
import { CareMapController } from './care-map.controller';
import { CareMapService } from './care-map.service';

@Module({ controllers: [CareMapController], providers: [CareMapService], exports: [CareMapService] })
export class CareMapModule {}
