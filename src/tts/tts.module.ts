import { Module } from '@nestjs/common';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';

/** Voix de synthèse en fon, yoruba, bariba et dendi (modèles MMS-TTS de Meta). */
@Module({ controllers: [TtsController], providers: [TtsService] })
export class TtsModule {}
