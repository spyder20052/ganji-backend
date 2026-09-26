import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { CallbackDto, ListenMessageDto, OpenThreadDto } from './listen.dto';
import { ListenService } from './listen.service';

@ApiTags('M12 · Écoute psychologique')
@Roles('PATIENT', 'CAREGIVER')
@Controller('me/listen')
export class MeListenController {
  constructor(private readonly svc: ListenService) {}

  @ApiOperation({ summary: 'Ouvrir une conversation confidentielle (anonyme par défaut)' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  open(@CurrentUser() u: AuthUser, @Body() dto: OpenThreadDto) {
    return this.svc.open(u, dto);
  }

  @ApiOperation({ summary: 'Mes conversations' })
  @Get()
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.mine(u);
  }

  @ApiOperation({ summary: 'Une conversation et ses messages (déchiffrés)' })
  @Get(':id')
  thread(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.thread(u, id);
  }

  @ApiOperation({ summary: 'Écrire (mots de détresse : consigne de sécurité et alerte de la cellule)' })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':id/messages')
  message(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ListenMessageDto) {
    return this.svc.personMessage(u, id, dto.body);
  }

  @ApiOperation({ summary: 'Demander à être rappelé (numéro chiffré, visible de l’écoutante seulement)' })
  @Post(':id/callback')
  @HttpCode(200)
  callback(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CallbackDto) {
    return this.svc.requestCallback(u, id, dto);
  }

  @ApiOperation({ summary: 'Clore la conversation' })
  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.personClose(u, id);
  }
}

@ApiTags('M12 · Écoute psychologique (cellule d’écoute)')
@Roles('PRACTITIONER')
@Controller('listen')
export class ListenCounselorController {
  constructor(private readonly svc: ListenService) {}

  @ApiOperation({ summary: 'File : détresse d’abord, puis en attente, puis mes conversations (avec les demandes de rappel)' })
  @Get('queue')
  queue(@CurrentUser() u: AuthUser) {
    return this.svc.queue(u);
  }

  @ApiOperation({ summary: 'Une conversation (anonyme : « Personne anonyme »)' })
  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.counselorGet(u, id);
  }

  @ApiOperation({ summary: 'Prendre la conversation' })
  @Post(':id/take')
  @HttpCode(200)
  take(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.take(u, id);
  }

  @ApiOperation({ summary: 'Répondre (la personne est prévenue ; SMS neutre)' })
  @Post(':id/messages')
  message(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ListenMessageDto) {
    return this.svc.counselorMessage(u, id, dto.body);
  }

  @ApiOperation({ summary: 'Clore la conversation' })
  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.counselorClose(u, id);
  }
}
