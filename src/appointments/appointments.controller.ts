import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { ConfirmDto, CreateAppointmentDto, FacilitiesQuery, RefuseDto } from './appointments.dto';
import { AppointmentsService } from './appointments.service';

@ApiTags('Rendez-vous')
@Controller()
export class AppointmentsController {
  constructor(private readonly svc: AppointmentsService) {}

  @Get('appointments/facilities')
  @ApiOperation({ summary: 'Établissements qui reçoivent ce service, du plus proche de la commune au plus loin' })
  facilities(@Query() q: FacilitiesQuery) {
    return this.svc.facilities(q);
  }

  @Post('me/appointments')
  @ApiOperation({ summary: 'Demander un rendez-vous (pour soi, son enfant, ou une personne aidée avec le droit « rendez-vous »)' })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateAppointmentDto, @Req() req: Request) {
    return this.svc.create(u, dto, req.ip);
  }

  @Get('me/appointments')
  @ApiOperation({ summary: 'Mes rendez-vous : à venir, en attente, passés' })
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.mine(u);
  }

  @Post('me/appointments/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.cancel(u, id, req.ip);
  }

  @Roles('PRACTITIONER', 'NURSE')
  @Get('appointments/requests')
  @ApiOperation({ summary: "Demandes de l'établissement du soignant : en attente, à venir, réponses récentes" })
  requests(@CurrentUser() u: AuthUser) {
    return this.svc.requests(u);
  }

  @Roles('PRACTITIONER', 'NURSE')
  @Post('appointments/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmDto, @Req() req: Request) {
    return this.svc.confirm(u, id, dto, req.ip);
  }

  @Roles('PRACTITIONER', 'NURSE')
  @Post('appointments/:id/refuse')
  @HttpCode(200)
  refuse(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefuseDto, @Req() req: Request) {
    return this.svc.refuse(u, id, dto, req.ip);
  }

  @Roles('PRACTITIONER', 'NURSE')
  @Post('appointments/:id/done')
  @HttpCode(200)
  done(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.done(u, id, req.ip);
  }
}
