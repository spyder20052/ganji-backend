import { Module } from '@nestjs/common';
import { MeController, PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

@Module({ controllers: [MeController, PatientsController], providers: [PatientsService], exports: [PatientsService] })
export class PatientsModule {}
