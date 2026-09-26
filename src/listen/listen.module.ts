import { Module } from '@nestjs/common';
import { ListenCounselorController, MeListenController } from './listen.controller';
import { ListenService } from './listen.service';

/** Écoute psychologique : conversation confidentielle avec la cellule d'écoute. */
@Module({
  controllers: [MeListenController, ListenCounselorController],
  providers: [ListenService],
})
export class ListenModule {}
