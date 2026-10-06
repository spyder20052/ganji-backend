import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth-user';
import { AlertsQueryDto, CreateAlertDto, ReportDto, ReportsQueryDto } from './alerts.dto';
import { AlertsService } from './alerts.service';

const SIGNAL_ROLES: AuthUser['role'][] = ['MINISTRY', 'ADMIN', 'RELAY', 'PRACTITIONER', 'NURSE'];

@ApiTags('M13 · Alertes sanitaires')
@Controller()
export class AlertsController {
  constructor(private readonly svc: AlertsService) {}

  /** Public. Les signaux détectés automatiquement (non vérifiés) ne sont montrés qu'aux professionnels. */
  @Public()
  @Get('alerts')
  @ApiOperation({ summary: 'Alertes en cours (nationales et de la commune) ; les regroupements détectés automatiquement ne sont montrés qu’aux professionnels' })
  list(@CurrentUser() u: AuthUser | undefined, @Query() q: AlertsQueryDto) {
    return this.svc.list(q.commune, Boolean(u && SIGNAL_ROLES.includes(u.role)));
  }

  @Roles('MINISTRY', 'ADMIN')
  @Post('alerts')
  @ApiOperation({ summary: 'Alerte officielle : affichée dans l’application et diffusée par SMS aux habitants inscrits des communes visées' })
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
  reports(@Query() q: ReportsQueryDto) {
    return this.svc.reports(q.days ?? 14);
  }
}
