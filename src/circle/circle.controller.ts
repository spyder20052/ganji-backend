import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { CircleSettingsDto, VisitDoneDto } from './circle.dto';
import { CircleService } from './circle.service';

@ApiTags('M15 · Cercle de soins')
@Roles('PATIENT', 'CAREGIVER')
@Controller('me')
export class MeCircleController {
  constructor(private readonly svc: CircleService) {}

  @ApiOperation({ summary: 'Mon cercle : membres et comment chacun est prévenu, rappels du jour, derniers événements' })
  @ApiQuery({ name: 'patientId', required: false, description: 'Pour un aidant : la personne accompagnée (par défaut, la première)' })
  @Get('circle')
  circle(@CurrentUser() u: AuthUser, @Query('patientId') patientId?: string) {
    return this.svc.circle(u, patientId);
  }

  @ApiOperation({ summary: 'Choisir les aidants prévenus quand un rappel reste sans réponse (titulaire du carnet)' })
  @Patch('circle/settings')
  settings(@CurrentUser() u: AuthUser, @Body() dto: CircleSettingsDto) {
    return this.svc.updateSettings(u, dto);
  }

  @ApiOperation({ summary: '« C’est fait » : confirmer un rappel (patient ou aidant)' })
  @Post('reminders/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.confirm(u, id);
  }
}

@ApiTags('M15 · Cercle de soins (relais)')
@Roles('RELAY')
@Controller('relay/visits')
export class RelayVisitsController {
  constructor(private readonly svc: CircleService) {}

  @ApiOperation({ summary: 'Visites à faire dans ma commune (prénom, quartier, motif sans détail médical)' })
  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.relayVisits(u);
  }

  @ApiOperation({ summary: 'Visite faite : le patient et ses aidants sont prévenus' })
  @Post(':id/done')
  @HttpCode(200)
  done(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VisitDoneDto) {
    return this.svc.visitDone(u, id, dto.note);
  }
}
