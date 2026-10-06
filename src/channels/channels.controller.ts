import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, NotFoundException, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/auth-user';
import { CryptoService } from '../common/crypto.service';
import { ChannelsService } from './channels.service';

class InboundDto {
  @ApiProperty({ example: '0196000123' }) @IsString() @Length(8, 16) from: string;
  @ApiProperty({ example: '1' }) @IsString() @MaxLength(160) body: string;
}

class UssdDto {
  @ApiProperty({ example: '0196000123' }) @IsString() @Length(8, 16) from: string;
  @ApiProperty({ example: '2*1', description: 'Saisie cumulée de la session USSD' }) @IsString() @MaxLength(40) text: string;
}

class DemoTickDto {
  @ApiPropertyOptional({ example: 24, description: 'Rappels des prochaines heures à envoyer (1 à 720)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  horizonHours?: number;
}

function demoOnly() {
  if (process.env.DEMO_MODE !== 'true') throw new NotFoundException();
}

/** En-tête portant la clé du simulateur remise à l'inscription (voir ChannelsService.assertSimulatorPhone). */
const SIMULATOR_HEADER = 'x-ganji-simulator';

@ApiTags('Canaux · SMS, USSD, voix (simulateur)')
@Public()
@Controller()
export class ChannelsController {
  constructor(
    private readonly svc: ChannelsService,
    private readonly crypto: CryptoService,
  ) {}

  @Get('sms/phones')
  phones() {
    demoOnly();
    return this.svc.demoPhones();
  }

  /** Messages d'un numéro : téléphones de démonstration, ou carnet créé depuis ce navigateur (en-tête x-ganji-simulator). */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('sms/outbox')
  outbox(@Query('to') to?: string, @Headers(SIMULATOR_HEADER) key?: string) {
    demoOnly();
    return to ? this.svc.outboxFor(to, key) : this.svc.recent();
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('sms/inbound')
  @HttpCode(200)
  async inbound(@Body() dto: InboundDto, @Headers('x-ganji-signature') signature?: string, @Headers(SIMULATOR_HEADER) key?: string) {
    if (process.env.DEMO_MODE === 'true') {
      // Démo : le simulateur ne répond qu'au nom des téléphones de démonstration (ou du carnet créé ici).
      await this.svc.assertSimulatorPhone(dto.from, key);
    } else if (!signature || !this.crypto.verify(`${dto.from}:${dto.body}`, signature)) {
      // Production : l'agrégateur signe le webhook (HMAC du corps).
      throw new ForbiddenException('Signature du webhook invalide');
    }
    return this.svc.inboundSms(dto.from, dto.body);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('ussd')
  @HttpCode(200)
  async ussd(@Body() dto: UssdDto, @Headers(SIMULATOR_HEADER) key?: string) {
    demoOnly();
    await this.svc.assertSimulatorPhone(dto.from, key);
    return this.svc.ussd(dto.from, dto.text);
  }

  /** Vercel Cron (GET avec Authorization: Bearer CRON_SECRET) ou bouton de démo (POST). */
  @Get('jobs/tick')
  cron(@Headers('authorization') auth?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret || !auth || !this.crypto.safeEqual(auth, `Bearer ${secret}`)) throw new UnauthorizedException('Secret de la tâche planifiée absent ou invalide');
    return this.svc.tick();
  }

  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('jobs/tick')
  @HttpCode(200)
  demoTick(@Body() dto: DemoTickDto) {
    demoOnly();
    return this.svc.demoTick(dto.horizonHours ?? 24);
  }
}
