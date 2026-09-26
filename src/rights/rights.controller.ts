import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth-user';
import { CoverageDto, EstimateDto, PaymentDto } from './rights.dto';
import { RightsService } from './rights.service';

@ApiTags('Droits · couverture, reste à charge, paiement')
@Controller()
export class RightsController {
  constructor(private readonly svc: RightsService) {}

  /** Grille publique des tarifs des actes (indicative). */
  @Public()
  @Get('rights/tariffs')
  tariffs() {
    return this.svc.tariffs();
  }

  @Roles('PATIENT', 'CAREGIVER')
  @Get('me/coverage')
  coverage(@CurrentUser() u: AuthUser) {
    return this.svc.coverage(u);
  }

  /** Déclarer sa couverture (ARCH, mutuelle ou aucune). Statut « en attente » jusqu'à la vérification. */
  @Roles('PATIENT', 'CAREGIVER')
  @Put('me/coverage')
  declare(@CurrentUser() u: AuthUser, @Body() dto: CoverageDto) {
    return this.svc.declare(u, dto);
  }

  /** Vérifier ses droits auprès du registre (adaptateur d'interopérabilité ; bac à sable en démonstration). */
  @Roles('PATIENT', 'CAREGIVER')
  @Post('me/coverage/verify')
  @HttpCode(200)
  verify(@CurrentUser() u: AuthUser) {
    return this.svc.verify(u);
  }

  /** Estimer le coût, la part prise en charge et le reste à payer. Rien n'est enregistré. */
  @Roles('PATIENT', 'CAREGIVER')
  @Post('me/rights/estimate')
  @HttpCode(200)
  estimate(@CurrentUser() u: AuthUser, @Body() dto: EstimateDto) {
    return this.svc.estimate(u, dto);
  }

  /** Payer un reste à charge par mobile money (bac à sable : rien n'est débité). */
  @Roles('PATIENT', 'CAREGIVER')
  @Post('me/payments')
  pay(@CurrentUser() u: AuthUser, @Body() dto: PaymentDto) {
    return this.svc.pay(u, dto);
  }

  @Roles('PATIENT', 'CAREGIVER')
  @Get('me/payments')
  payments(@CurrentUser() u: AuthUser) {
    return this.svc.payments(u);
  }

  @Roles('PATIENT', 'CAREGIVER')
  @Get('me/payments/:receipt')
  receipt(@CurrentUser() u: AuthUser, @Param('receipt') receipt: string) {
    return this.svc.receipt(u, receipt);
  }
}
