import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { CancelRequestDto, CreateBloodRequestDto, DonorProfileDto, ReserveDto, RespondDto, ServedDto, StockDto } from './blood.dto';
import { BloodDispatchService } from './blood-dispatch.service';
import { BloodDonorsService } from './blood-donors.service';
import { BloodRequestsService } from './blood-requests.service';
import { BloodStockService } from './blood-stock.service';

@ApiTags('M4 · Sang')
@Controller('blood')
export class BloodController {
  constructor(
    private readonly requests: BloodRequestsService,
    private readonly stock: BloodStockService,
    private readonly dispatch: BloodDispatchService,
    private readonly donors: BloodDonorsService,
  ) {}

  // ─── Stocks des sites de transfusion ─────────────────────────────

  @Get('stocks')
  stocks() {
    return this.stock.stocks();
  }

  @Roles('BLOOD_BANK')
  @Put('stocks')
  updateStock(@CurrentUser() u: AuthUser, @Body() dto: StockDto) {
    return this.stock.updateStock(u, dto.siteId, dto.product, dto.bloodGroup, dto.units);
  }

  // ─── Demandes ────────────────────────────────────────────────────

  @Get('requests')
  list(@CurrentUser() u: AuthUser) {
    return this.requests.list(u);
  }

  @Roles('PRACTITIONER', 'NURSE')
  @Post('requests')
  @ApiOperation({ summary: 'Demande de produit sanguin : banque de sang prévenue, stocks vérifiés, donneurs alertés (40 → 80 → 150 km)' })
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBloodRequestDto, @Req() req: Request) {
    return this.requests.create(u, dto, req.ip);
  }

  @Get('requests/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.requests.get(u, id, req.ip);
  }

  @Roles('PRACTITIONER', 'NURSE', 'BLOOD_BANK')
  @Post('requests/:id/alert-donors')
  @HttpCode(200)
  alert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.dispatch.alertDonors(u, id);
  }

  @Roles('BLOOD_BANK')
  @Post('requests/:id/reserve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Banque de sang : met de côté des poches compatibles de son stock pour une demande' })
  reserve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReserveDto) {
    return this.requests.reserve(u, id, dto.units);
  }

  @Roles('PRACTITIONER', 'NURSE', 'BLOOD_BANK')
  @Post('requests/:id/served')
  @HttpCode(200)
  @ApiOperation({ summary: 'Transfusion faite : seuls les donneurs cochés (qui ont réellement donné) voient leur don inscrit' })
  served(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ServedDto, @Req() req: Request) {
    return this.requests.markServed(u, id, dto.donorAlertIds ?? [], req.ip);
  }

  @Roles('PRACTITIONER', 'NURSE', 'BLOOD_BANK')
  @Post('requests/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annule une demande (erreur, besoin disparu) : donneurs attendus prévenus, poches réservées rendues au stock' })
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelRequestDto, @Req() req: Request) {
    return this.requests.cancel(u, id, dto.reason, req.ip);
  }

  // ─── Espace donneur ──────────────────────────────────────────────

  @Roles('PATIENT', 'CAREGIVER')
  @Post('requests/:id/volunteer')
  @HttpCode(200)
  @ApiOperation({ summary: '« Je peux donner » : un donneur inscrit se propose pour une demande proche' })
  volunteer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.donors.volunteer(u, id);
  }

  @Roles('PATIENT', 'CAREGIVER')
  @Get('nearby')
  @ApiOperation({ summary: 'Demandes ouvertes compatibles à moins de 40 km du donneur (anonymes)' })
  nearby(@CurrentUser() u: AuthUser) {
    return this.donors.nearby(u);
  }

  @Roles('PATIENT', 'CAREGIVER')
  @Get('donor/me')
  donorMe(@CurrentUser() u: AuthUser) {
    return this.donors.donorMe(u);
  }

  @Roles('PATIENT', 'CAREGIVER')
  @Put('donor/me')
  @ApiOperation({ summary: 'Devenir donneur ou mettre à jour sa fiche (groupe, commune, disponibilité, téléphone)' })
  saveDonorMe(@CurrentUser() u: AuthUser, @Body() dto: DonorProfileDto) {
    return this.donors.saveDonorMe(u, dto);
  }

  @Get('donor/alerts')
  myAlerts(@CurrentUser() u: AuthUser) {
    return this.donors.myAlerts(u);
  }

  @Post('donor/alerts/:id/respond')
  @HttpCode(200)
  respond(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondDto) {
    return this.donors.respondAsUser(u, id, dto.accept);
  }
}
