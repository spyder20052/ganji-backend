import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { UI_LANGS } from '../profile/profile.logic';

const PHONE = /^\+?229\s?0?1?\d{8}$|^01\d{8}$/;

export class OtpRequestDto {
  @ApiProperty({ example: '0197000001', description: 'Numéro béninois (10 chiffres, format 2024)' })
  @Matches(PHONE, { message: 'Numéro de téléphone béninois invalide' })
  phone: string;
}

export class OtpVerifyDto {
  @ApiProperty({ example: '0197000001' })
  @Matches(PHONE, { message: 'Numéro de téléphone béninois invalide' })
  phone: string;

  @ApiProperty({ example: '123456' })
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code: string;
}

export class RegisterDto {
  @ApiProperty({ example: '1234567890', description: 'NPI (10 chiffres, format ANIP simulé)' })
  @Matches(/^\d{10}$/, { message: 'Le NPI comporte 10 chiffres' })
  npi: string;

  @ApiProperty({ example: '0197000099' })
  @Matches(PHONE, { message: 'Numéro de téléphone béninois invalide' })
  phone: string;

  @ApiProperty() @IsString() @Length(1, 60) firstName: string;
  @ApiProperty() @IsString() @Length(1, 60) lastName: string;
  @ApiProperty({ example: '1992-04-12' }) @IsDateString() birthDate: string;
  @ApiProperty({ enum: ['F', 'M'] }) @IsIn(['F', 'M']) sex: string;
  @ApiPropertyOptional({ example: 'Abomey-Calavi', description: 'Nom exact de la commune (77 communes)' }) @IsOptional() @IsString() @MaxLength(60) commune?: string;
  @ApiPropertyOptional({ enum: UI_LANGS, description: "Langue choisie dans l'interface : le code SMS arrive dans cette langue" })
  @IsOptional()
  @IsIn(UI_LANGS)
  lang?: string;
}

export function normalizePhone(p: string): string {
  const digits = p.replace(/\D/g, '');
  const local = digits.startsWith('229') ? digits.slice(3) : digits;
  return local.length === 8 ? `01${local}` : local;
}
