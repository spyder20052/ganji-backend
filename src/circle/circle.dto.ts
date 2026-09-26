import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CircleSettingsDto {
  @ApiProperty({ description: "Délégation de l'aidant concerné" })
  @IsUUID()
  delegationId: string;

  @ApiProperty({ description: "L'aidant reçoit les rappels et est prévenu quand un rappel reste sans réponse (droit « reminders »)" })
  @IsBoolean()
  escalations: boolean;
}

export class VisitDoneDto {
  @ApiPropertyOptional({ example: 'Traitement pris, il va bien. Sa sœur est avec lui.', description: 'Mot du relais (visible du patient et de ses aidants, jamais par SMS)' })
  @IsOptional()
  @IsString()
  @MaxLength(280, { message: 'Mot de 280 caractères au plus' })
  note?: string;
}
