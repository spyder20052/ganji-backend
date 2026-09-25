import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';

/** Notifications dans l'application (cloche) : liste, non lues, lecture. Le service est dans common/. */
@Module({ controllers: [NotificationsController] })
export class NotificationsModule {}
