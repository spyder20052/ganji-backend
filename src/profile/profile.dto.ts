import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { BLOOD_GROUPS, UI_LANGS } from './profile.logic';

const PHONE = /^\+?229\s?0?1?\d{8}$|^01\d{8}$|^\d{8}$/;

/** Modification du profil par la personne elle-même : chaque champ est facultatif (un bloc à la fois). */
export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 60) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 60) lastName?: string;
  @ApiPropertyOptional({ example: '1992-03-14' }) @IsOptional() @IsDateString() birthDate?: string;
  @ApiPropertyOptional({ enum: ['F', 'M'] }) @IsOptional() @IsIn(['F', 'M']) sex?: string;

  @ApiPropertyOptional({ example: 'Abomey-Calavi', nullable: true, description: 'Nom exact de la commune (77 communes)' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  commune?: string | null;

  @ApiPropertyOptional({ example: 'Zogbadjè' }) @IsOptional() @IsString() @MaxLength(80) quartier?: string;
  @ApiPropertyOptional({ example: 'près de la mosquée' }) @IsOptional() @IsString() @MaxLength(80) repere?: string;

  @ApiPropertyOptional({ enum: UI_LANGS }) @IsOptional() @IsIn(UI_LANGS) lang?: string;

  @ApiPropertyOptional({ enum: BLOOD_GROUPS, nullable: true, description: 'null : « Je ne sais pas »' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(BLOOD_GROUPS)
  bloodGroup?: string | null;

  @ApiPropertyOptional({ isArray: true, example: ['Pénicilline'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  allergies?: string[];

  @ApiPropertyOptional({ description: 'Traitements en cours (chiffré en base)' }) @IsOptional() @IsString() @MaxLength(500) treatments?: string;

  @ApiPropertyOptional({ example: 'Afiavi (mère)' }) @IsOptional() @IsString() @MaxLength(60) emergencyName?: string;

  @ApiPropertyOptional({ example: '0190000002' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s.-]/g, '') : value))
  @ValidateIf((_, v) => v !== '')
  @Matches(PHONE, { message: 'Numéro de téléphone béninois invalide' })
  emergencyPhone?: string;

  @ApiPropertyOptional({ isArray: true, example: ['Hypertension'], description: 'Maladies suivies à ajouter (déclarées par la personne)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(2, 80, { each: true })
  conditionsAdd?: string[];

  @ApiPropertyOptional({ isArray: true, description: 'Maladies déclarées par la personne à retirer (identifiants)' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  conditionsRemove?: string[];
}

export class LangDto {
  @ApiProperty({ enum: UI_LANGS, example: 'fon' }) @IsIn(UI_LANGS) lang: string;
}

/** Groupe sanguin et allergies vérifiés par un soignant (source « VERIFIE »). */
export class VitalsDto {
  @ApiPropertyOptional({ enum: BLOOD_GROUPS })
  @IsOptional()
  @IsIn(BLOOD_GROUPS)
  bloodGroup?: string;

  @ApiPropertyOptional({ isArray: true, example: ['Pénicilline'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  allergies?: string[];
}
