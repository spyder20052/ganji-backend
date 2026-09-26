import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth-user';
import { LangDto, UpdateProfileDto, VitalsDto } from './profile.dto';
import { ProfileService } from './profile.service';

@ApiTags('Profil')
@Controller('me')
export class ProfileController {
  constructor(private readonly svc: ProfileService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Mon profil : compte, identité, commune, adresse, groupe sanguin, allergies, maladies, traitements, personne à prévenir' })
  get(@CurrentUser() u: AuthUser) {
    return this.svc.get(u);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Modifier mon profil (un bloc à la fois ; le téléphone, identifiant de connexion, ne change pas ici)' })
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdateProfileDto, @Req() req: Request) {
    return this.svc.update(u, dto, req.ip);
  }

  @Post('profile/done')
  @HttpCode(200)
  @ApiOperation({ summary: "Fin de l'accueil après inscription" })
  done(@CurrentUser() u: AuthUser) {
    return this.svc.done(u);
  }

  /** Appelé par le menu des langues, connecté ou non : sans session, la langue reste dans le cookie. */
  @Public()
  @Post('lang')
  @HttpCode(200)
  @ApiOperation({ summary: 'Langue des SMS et de la voix (codes de l’interface : fr, en, fon, yo, bba, ddn)' })
  lang(@CurrentUser() u: AuthUser | undefined, @Body() dto: LangDto) {
    return this.svc.setLang(u, dto.lang);
  }
}

@ApiTags('M2 · Carnet de santé')
@Controller('patients')
export class VitalsController {
  constructor(private readonly svc: ProfileService) {}

  @Roles('PRACTITIONER', 'NURSE')
  @Patch(':id/vitals')
  @ApiOperation({ summary: 'Groupe sanguin et allergies vérifiés par un soignant (consentement ou équipe de soins)' })
  vitals(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VitalsDto, @Req() req: Request) {
    return this.svc.verifyVitals(u, id, dto, req.ip);
  }
}
