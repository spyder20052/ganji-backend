import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { AskDto, DoseDto, ForPatientDto, PlanDto } from './assistant.dto';
import { AssistantService } from './assistant.service';

@ApiTags('Assistant de traitement')
@Roles('PATIENT', 'CAREGIVER')
@Controller('me/assistant')
export class AssistantController {
  constructor(private readonly svc: AssistantService) {}

  /** Ordonnances en cours, heures de prise lues sur la posologie, plan actif ou non. */
  @Get('plans')
  plans(@CurrentUser() u: AuthUser, @Query() q: ForPatientDto, @Req() req: Request) {
    return this.svc.plans(u, q.patientId, req.ip);
  }

  /** Crée (ou remplace) le plan de prises d'une ordonnance : rappels APP + SMS, 30 jours au plus. */
  @Post('plan')
  plan(@CurrentUser() u: AuthUser, @Body() dto: PlanDto, @Query() q: ForPatientDto, @Req() req: Request) {
    return this.svc.createPlan(u, dto.prescriptionId, q.patientId, req.ip);
  }

  @Get('today')
  today(@CurrentUser() u: AuthUser, @Query() q: ForPatientDto, @Req() req: Request) {
    return this.svc.today(u, q.patientId, req.ip);
  }

  /** Prise renseignée : PRISE (confirme le rappel), OUBLIEE (conseil de la fiche) ou DECALEE (rappel dans 30 min). */
  @Post('doses/:reminderId')
  @HttpCode(200)
  dose(@CurrentUser() u: AuthUser, @Param('reminderId', ParseUUIDPipe) id: string, @Body() dto: DoseDto, @Query() q: ForPatientDto, @Req() req: Request) {
    return this.svc.markDose(u, id, dto.status, dto.lang, q.patientId, req.ip);
  }

  @Get('adherence')
  adherence(@CurrentUser() u: AuthUser, @Query() q: ForPatientDto, @Req() req: Request) {
    return this.svc.adherence(u, q.patientId, req.ip);
  }

  /** Question sur son traitement : réponse tirée de l'ordonnance et des fiches médicaments, jamais inventée. */
  @Post('ask')
  @HttpCode(200)
  ask(@CurrentUser() u: AuthUser, @Body() dto: AskDto, @Query() q: ForPatientDto, @Req() req: Request) {
    return this.svc.ask(u, dto.question, dto.lang, q.patientId, req.ip);
  }
}
