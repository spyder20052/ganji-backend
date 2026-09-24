import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth-user';
import { CreateAlertDto, ReportDto } from './alerts.dto';
import { AlertsService } from './alerts.service';

const SIGNAL_ROLES: AuthUser['role'][] = ['MINISTRY', 'ADMIN', 'RELAY', 'PRACTITIONER', 'NURSE'];

@ApiTags('M13 · Alertes sanitaires')
@Controller()
export class AlertsController {
  constructor(private readonly svc: AlertsService) {}

  /** Public. Les signaux détectés automatiquement (non vérifiés) ne sont montrés qu'aux professionnels. */
  @Public()
  @Get('alerts')
  list(@CurrentUser() u: AuthUser | undefined, @Query('commune') commune?: string) {
    return this.svc.list(commune, Boolean(u && SIGNAL_ROLES.includes(u.role)));
  }

  @Roles('MINISTRY', 'ADMIN')
  @Post('alerts')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateAlertDto) {
    return this.svc.create(u, dto);
  }

  @Roles('RELAY', 'NURSE', 'PRACTITIONER')
  @Post('community-reports')
  report(@CurrentUser() u: AuthUser, @Body() dto: ReportDto) {
    return this.svc.report(u, dto);
  }

  @Roles('MINISTRY', 'ADMIN', 'RELAY')
  @Get('community-reports')
  reports(@Query('days') days?: string) {
    return this.svc.reports(Math.min(Number(days) || 14, 90));
  }
}
