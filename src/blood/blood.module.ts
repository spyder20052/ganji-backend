import { Module } from '@nestjs/common';
import { BloodController } from './blood.controller';
import { BloodService } from './blood.service';

@Module({ controllers: [BloodController], providers: [BloodService], exports: [BloodService] })
export class BloodModule {}
