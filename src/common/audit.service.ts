import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth-user';

export interface AuditInput {
  actor?: AuthUser | null;
  patientId?: string | null;
  action: string;
  resource: string;
  reason?: string;
  allowed?: boolean;
  ip?: string;
}

/** Journal d'audit en ajout seul (la base refuse UPDATE et DELETE sur AuditEvent). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(input: AuditInput) {
    return this.prisma.auditEvent.create({
      data: {
        actorId: input.actor?.id ?? null,
        actorName: input.actor?.name ?? null,
        actorRole: input.actor?.role ?? null,
        patientId: input.patientId ?? null,
        action: input.action,
        resource: input.resource,
        reason: input.reason,
        allowed: input.allowed ?? true,
        ip: input.ip,
      },
    });
  }
}
