import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { COURIER_NAME, COURIER_PHONE, MOBILE_OPERATORS, ORDER_MODES, ORDER_PAYMENTS, type MobileOperator, type OrderMode, type OrderPayment } from './orders.logic';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Numéro béninois : 8 ou 10 chiffres, indicatif +229 facultatif ; espaces et points tolérés. */
const PHONE = /^(\+229)?\d{8}(\d{2})?$/;
const phone = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s.-]/g, '') : value);

export class OrderItemDto {
  @ApiProperty() @IsUUID() medicationId: string;
  @ApiProperty({ example: 1, description: 'Nombre de boîtes, flacons ou plaquettes' }) @IsInt() @Min(1) @Max(10) quantity: number;
}

export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'Patient concerné (aidant ou parent qui commande pour un proche). Par défaut : soi-même.' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiProperty({ description: 'Pharmacie (établissement de type PHARMACIE)' })
  @IsUUID()
  pharmacyId: string;

  @ApiPropertyOptional({ description: 'Commande d’une ordonnance signée (toutes ses lignes)' })
  @IsOptional()
  @IsUUID()
  prescriptionId?: string;

  @ApiPropertyOptional({ type: [OrderItemDto], description: 'Commande libre (sans ordonnance) : médicaments et quantités' })
  @ValidateIf((o: CreateOrderDto) => !o.prescriptionId)
  @IsArray()
  @ArrayMinSize(1, { message: 'Choisissez au moins un médicament' })
  @ArrayMaxSize(10, { message: 'Dix médicaments au plus par commande' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];

  @ApiProperty({ enum: ORDER_MODES })
  @IsIn(ORDER_MODES)
  mode: OrderMode;

  @ApiPropertyOptional({ example: 'Godomey, rue du marché, maison bleue après la pharmacie', description: 'Obligatoire en livraison' })
  @ValidateIf((o: CreateOrderDto) => o.mode === 'LIVRAISON')
  @Transform(trim)
  @IsString({ message: 'Indiquez l’adresse de livraison (quartier, rue, repère)' })
  @Length(4, 200, { message: 'Indiquez l’adresse de livraison (quartier, rue, repère)' })
  address?: string;

  @ApiPropertyOptional({ description: 'Commune de livraison (par défaut : celle du patient)' })
  @IsOptional()
  @IsUUID()
  communeId?: string;

  @ApiProperty({ example: '0190000001', description: 'Téléphone joignable pour la livraison ou le retrait' })
  @Transform(phone)
  @IsString({ message: 'Numéro de téléphone invalide' })
  @Matches(PHONE, { message: 'Numéro de téléphone invalide' })
  phone: string;

  @ApiPropertyOptional({ example: 'Appeler en arrivant' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 200)
  instructions?: string;

  @ApiProperty({ enum: ORDER_PAYMENTS })
  @IsIn(ORDER_PAYMENTS)
  payment: OrderPayment;

  @ApiPropertyOptional({ enum: MOBILE_OPERATORS, description: 'Obligatoire pour le mobile money' })
  @ValidateIf((o: CreateOrderDto) => o.payment === 'MOBILE_MONEY')
  @IsIn(MOBILE_OPERATORS, { message: 'Choisissez l’opérateur mobile money' })
  operator?: MobileOperator;

  @ApiPropertyOptional({ description: 'Numéro mobile money qui paie (par défaut : le téléphone de la commande)' })
  @IsOptional()
  @Transform(phone)
  @IsString()
  @Matches(PHONE, { message: 'Numéro mobile money invalide' })
  payerPhone?: string;
}

/** Préparation d'une commande : ce qu'il faut commander et les pharmacies qui ont tout. */
export class OrderOptionsDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() patientId?: string;
  @ApiPropertyOptional({ description: 'Ordonnance à commander' }) @IsOptional() @IsUUID() rx?: string;
  @ApiPropertyOptional({ description: 'Médicament (commande libre)' }) @IsOptional() @IsUUID() med?: string;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) qty?: number;
}

export class MyOrdersQueryDto {
  @ApiPropertyOptional({ description: 'Commandes d’un proche (aidant, parent)' }) @IsOptional() @IsUUID() patientId?: string;
}

export class PharmacyOrdersQueryDto {
  @ApiPropertyOptional({ example: 'RECUE,ACCEPTEE', description: 'Statuts séparés par des virgules (toutes les commandes récentes par défaut)' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z_,]{0,120}$/)
  status?: string;
}

export class RefuseOrderDto {
  @ApiProperty({ example: 'Rupture de stock' })
  @Transform(trim)
  @IsString({ message: 'Indiquez la raison du refus' })
  @Length(3, 200, { message: 'Indiquez la raison du refus' })
  reason: string;
}

/** Nom et téléphone du livreur : ils partent tels quels dans le SMS du patient, d'où une validation stricte. */
export class DispatchOrderDto {
  @ApiProperty({ example: 'Mathias Houénou', description: 'Lettres, espaces, trait d’union, apostrophe ; 40 caractères au plus' })
  @Transform(trim)
  @IsString({ message: 'Nom du livreur requis' })
  @Matches(COURIER_NAME, { message: 'Nom du livreur : lettres seulement (40 au plus)' })
  courierName: string;

  @ApiProperty({ example: '0197000000', description: 'Chiffres seulement (8 ou 10)' })
  @Transform(phone)
  @IsString({ message: 'Téléphone du livreur invalide' })
  @Matches(COURIER_PHONE, { message: 'Téléphone du livreur : 8 ou 10 chiffres' })
  courierPhone: string;
}

/** Échec de remise (patient absent, adresse introuvable, code bloqué…) : la raison est montrée au patient. */
export class FailOrderDto {
  @ApiProperty({ example: 'Patient absent' })
  @Transform(trim)
  @IsString({ message: 'Indiquez ce qui s’est passé' })
  @Length(3, 200, { message: 'Indiquez ce qui s’est passé' })
  reason: string;
}

export class DeliverOrderDto {
  @ApiProperty({ example: '4821', description: 'Code de remise à 4 chiffres donné par le patient' })
  @Transform(phone)
  @IsString({ message: 'Le code a 4 chiffres' })
  @Matches(/^\d{4}$/, { message: 'Le code a 4 chiffres' })
  code: string;
}
