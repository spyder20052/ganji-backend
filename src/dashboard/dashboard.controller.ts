import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/auth-user';
import { DashboardService } from './dashboard.service';

@ApiTags('M9 · Pilotage')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Roles('MINISTRY', 'ADMIN')
  @Get('national')
  national() {
    return this.svc.national();
  }
}
