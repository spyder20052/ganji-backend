import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

/** Rendez-vous : demande du patient, réponse de l'établissement, rappel la veille (tâche planifiée des rappels). */
@Module({ controllers: [AppointmentsController], providers: [AppointmentsService], exports: [AppointmentsService] })
export class AppointmentsModule {}
