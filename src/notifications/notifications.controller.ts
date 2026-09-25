import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth-user';
import { NotificationsService } from '../common/notifications.service';

class ReadDto {
  @IsOptional() @IsUUID() id?: string;
}

@ApiTags('Notifications')
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.id);
  }

  @Get('count')
  async count(@CurrentUser() u: AuthUser) {
    return { unread: await this.svc.unread(u.id) };
  }

  /** Marque une notification (id) ou toutes comme lues. */
  @Post('read')
  @HttpCode(200)
  read(@CurrentUser() u: AuthUser, @Body() dto: ReadDto) {
    return this.svc.markRead(u.id, dto.id);
  }
}
