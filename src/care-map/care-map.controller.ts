import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Public } from '../common/auth-user';
import { CareMapService } from './care-map.service';

class NearbyDto {
  @ApiProperty({ example: 6.3654 }) @Type(() => Number) @IsLatitude() lat: number;
  @ApiProperty({ example: 2.4183 }) @Type(() => Number) @IsLongitude() lng: number;
  @ApiPropertyOptional({ example: 'maternite' }) @IsOptional() @IsString() service?: string;
  @ApiPropertyOptional({ example: 'PHARMACIE' }) @IsOptional() @IsString() type?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean() openNow?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean() onDuty?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit?: number;
}

class TriageDto {
  @ApiProperty({ example: [0, 7], description: "Index des réponses choisies, dans l'ordre" })
  @IsArray()
  @ArrayMaxSize(8)
  @IsInt({ each: true })
  answers: number[];
  @ApiPropertyOptional() @IsOptional() @IsNumber() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lng?: number;
}

@ApiTags('M11 · Orientation et lieux de soin')
@Public()
@Controller()
export class CareMapController {
  constructor(private readonly svc: CareMapService) {}

  @Get('geo/departments')
  departments() {
    return this.svc.departments();
  }

  @Get('facilities')
  facilities(@Query('type') type?: string, @Query('department') department?: string) {
    return this.svc.facilities(type, department);
  }

  @Get('facilities/nearby')
  nearby(@Query() q: NearbyDto) {
    return this.svc.nearby({ ...q, types: q.type ? [q.type] : undefined });
  }

  @Get('facilities/:id')
  facility(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.facility(id);
  }

  @Get('triage/tree')
  tree() {
    return this.svc.triageTree();
  }

  @Post('triage')
  @HttpCode(200)
  triage(@Body() dto: TriageDto) {
    return this.svc.triage(dto.answers, dto.lat, dto.lng);
  }
}
