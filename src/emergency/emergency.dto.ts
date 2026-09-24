import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length, MaxLength, MinLength } from 'class-validator';

export class BreakGlassDto {
  @ApiPropertyOptional({ description: 'Identifiant du patient (ou bien qrToken)' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: "Jeton lu sur la carte d'urgence du patient (ou bien patientId)" })
  @IsOptional()
  @IsString()
  @Length(8, 100)
  qrToken?: string;

  @ApiProperty({ example: 'Patient inconscient admis aux urgences, antécédents nécessaires pour la prise en charge', minLength: 20 })
  @IsString()
  @MinLength(20, { message: 'Le motif doit être précis : 20 caractères minimum' })
  @MaxLength(500)
  reason: string;
}

export class SosDto {
  @ApiPropertyOptional({ example: 6.3654 }) @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional({ example: 2.4183 }) @IsOptional() @IsLongitude() lng?: number;
}
