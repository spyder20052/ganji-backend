import { Body, Controller, Header, HttpCode, Post, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../common/auth-user';
import { MAX_CHARS, TtsService } from './tts.service';
import { TTS_MODELS, type TtsLang } from './tts.text';

class SpeakDto {
  @IsIn(Object.keys(TTS_MODELS)) lang!: TtsLang;
  @IsString() @MinLength(1) @MaxLength(MAX_CHARS * 2) text!: string;
}

@ApiTags('C9 · Voix en langues nationales')
@Controller('tts')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  /** Lit un texte dans une langue nationale (voix de synthèse MMS). Public : le bouton Écouter est sur toutes les pages. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  @Header('Content-Type', 'audio/mpeg')
  @Header('Cache-Control', 'private, max-age=86400')
  async speak(@Body() dto: SpeakDto) {
    const { data } = await this.tts.speak(dto.lang, dto.text);
    return new StreamableFile(data);
  }
}
