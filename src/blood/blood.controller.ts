import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { CreateBloodRequestDto, DonorProfileDto, ReserveDto, RespondDto, ServedDto, StockDto } from './blood.dto';
import { BloodService } from './blood.service';

@ApiTags('M4 · Sang')
@Controller('blood')
export class BloodController {
  constructor(private readonly svc: BloodService) {}

  @Get('stocks')
  stocks() {
    return this.svc.stocks();
  }

  @Roles('BLOOD_BANK')
  @Put('stocks')
  updateStock(@CurrentUser() u: AuthUser, @Body() dto: StockDto) {
    return this.svc.updateStock(u, dto.siteId, dto.product, dto.bloodGroup, dto.units);
  }

  @Get('requests')
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u);
  }

  @Roles('PRACTITIONER', 'NURSE')
  @Post('requests')
  @ApiOperation({ summary: 'Demande de produit sanguin : banque de sang prévenue, stocks vérifiés, donneurs alertés (40 → 80 → 150 km)' })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBloodRequestDto, @Req() req: Request) {
    return this.svc.create(u, dto, req.ip);
  }

  @Get('requests/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.svc.get(u, id, req.ip);
  }

  @Roles('PRACTITIONER', 'NURSE', 'BLOOD_BANK')
  @Post('requests/:id/alert-donors')
  @HttpCode(200)
  alert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.alertDonors(u, id);
  }

  @Roles('BLOOD_BANK')
  @Post('requests/:id/reserve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Banque de sang : met de côté des poches compatibles de son stock pour une demande' })
  reserve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReserveDto) {
    return this.svc.reserve(u, id, dto.units);
  }

  @Roles('PRACTITIONER', 'NURSE', 'BLOOD_BANK')
  @Post('requests/:id/served')
  @HttpCode(200)
  @ApiOperation({ summary: 'Transfusion faite : seuls les donneurs cochés (qui ont réellement donné) voient leur don inscrit' })
  served(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ServedDto, @Req() req: Request) {
    return this.svc.markServed(u, id, dto.donorAlertIds ?? [], req.ip);
  }

  @Roles('PATIENT', 'CAREGIVER')
  @Post('requests/:id/volunteer')
  @HttpCode(200)
  @ApiOperation({ summary: '« Je peux donner » : un donneur inscrit se propose pour une demande proche' })
  volunteer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.volunteer(u, id);
  }

  @Roles('PATIENT', 'CAREGIVER')
  @Get('nearby')
  @ApiOperation({ summary: 'Demandes ouvertes compatibles à moins de 40 km du donneur (anonymes)' })
  nearby(@CurrentUser() u: AuthUser) {
    return this.svc.nearby(u);
  }

  @Roles('PATIENT', 'CAREGIVER')
  @Get('donor/me')
  donorMe(@CurrentUser() u: AuthUser) {
    return this.svc.donorMe(u);
  }

  @Roles('PATIENT', 'CAREGIVER')
  @Put('donor/me')
  @ApiOperation({ summary: 'Devenir donneur ou mettre à jour sa fiche (groupe, commune, disponibilité, téléphone)' })
  saveDonorMe(@CurrentUser() u: AuthUser, @Body() dto: DonorProfileDto) {
    return this.svc.saveDonorMe(u, dto);
  }

  @Get('donor/alerts')
  myAlerts(@CurrentUser() u: AuthUser) {
    return this.svc.myAlerts(u);
  }

  @Post('donor/alerts/:id/respond')
  @HttpCode(200)
  respond(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondDto) {
    return this.svc.respondAsUser(u, id, dto.accept);
  }
}
