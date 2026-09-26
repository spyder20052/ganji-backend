import { Module } from '@nestjs/common';
import { ProfileController, VitalsController } from './profile.controller';
import { ProfileService } from './profile.service';

/** Profil : lecture et modification par la personne, langue, fin de l'accueil ; groupe sanguin vérifié par un soignant. */
@Module({ controllers: [ProfileController, VitalsController], providers: [ProfileService], exports: [ProfileService] })
export class ProfileModule {}
