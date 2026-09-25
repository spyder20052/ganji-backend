import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { BloodModule } from './blood/blood.module';
import { CareMapModule } from './care-map/care-map.module';
import { CareModule } from './care/care.module';
import { ChannelsModule } from './channels/channels.module';
import { CommonModule } from './common/common.module';
import { SessionGuard } from './common/guards';
import { DashboardModule } from './dashboard/dashboard.module';
import { EmergencyModule } from './emergency/emergency.module';
import { HealthController } from './health.controller';
import { MaternalModule } from './maternal/maternal.module';
import { MedicationsModule } from './medications/medications.module';
import { PatientsModule } from './patients/patients.module';
import { PrismaModule } from './prisma/prisma.service';
import { NotificationsModule } from './notifications/notifications.module';
import { ProfileModule } from './profile/profile.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { OrdersModule } from './orders/orders.module';
import { ListenModule } from './listen/listen.module';
import { RightsModule } from './rights/rights.module';
import { AssistantModule } from './assistant/assistant.module';
import { CircleModule } from './circle/circle.module';

/** Secret de signature des sessions : obligatoire en production, valeur de développement sinon. */
function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET manquant : démarrage refusé en production sans secret de session');
  }
  return 'ganji-dev-only-jwt-secret-ne-pas-utiliser-en-production';
}

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    JwtModule.register({
      global: true,
      secret: jwtSecret(),
      signOptions: { algorithm: 'HS256' },
      verifyOptions: { algorithms: ['HS256'] },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuthModule,
    PatientsModule,
    CareMapModule,
    BloodModule,
    ChannelsModule,
    AlertsModule,
    DashboardModule,
    CareModule,
    MedicationsModule,
    EmergencyModule,
    MaternalModule,
    NotificationsModule,
    ProfileModule,
    AppointmentsModule,
    OrdersModule,
    ListenModule,
    RightsModule,
    AssistantModule,
    CircleModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordre significatif : limitation de débit d'abord, puis session et rôles.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule {}
