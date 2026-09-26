import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsISO8601, IsOptional, IsString, Length, Matches } from 'class-validator';

export class OpenThreadDto {
  @ApiPropertyOptional({ default: true, description: "Anonyme : l'écoutante ne voit ni le nom, ni le carnet, ni le numéro" })
  @IsOptional()
  @IsBoolean({ message: 'Anonymat : oui ou non' })
  anonymous?: boolean;

  @ApiProperty({ example: 'Je n’arrive plus à dormir depuis l’annonce de ma maladie.' })
  @IsString()
  @Length(1, 2000, { message: 'Écrivez un message (2 000 caractères au plus)' })
  firstMessage: string;
}

export class ListenMessageDto {
  @ApiProperty({ example: 'Merci de m’avoir répondu.' })
  @IsString()
  @Length(1, 2000, { message: 'Écrivez un message (2 000 caractères au plus)' })
  body: string;
}

export class CallbackDto {
  @ApiProperty({ example: '0197000000', description: 'Numéro où être rappelé (chiffré en base)' })
  @IsString()
  @Matches(/^\+?[\d\s.-]{8,16}$/, { message: 'Numéro de téléphone invalide' })
  phone: string;

  @ApiProperty({ example: '2026-09-26T08:00:00.000Z', description: 'Moment souhaité pour le rappel' })
  @IsISO8601({}, { message: 'Moment du rappel invalide' })
  when: string;
}
