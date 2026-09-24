import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { AuthUser, CLINICAL_ROLES } from './auth-user';

export type Scope = 'summary' | 'timeline' | 'observations' | 'documents' | 'prescriptions' | 'sensitive' | 'reminders' | 'blood';

export type AccessVia = 'OWNER' | 'PARENT' | 'DELEGATION' | 'CARE_TEAM' | 'CONSENT' | 'BREAK_GLASS';

export interface AccessDecision {
  allowed: boolean;
  via?: AccessVia;
  consentExpiresAt?: Date;
}

/**
 * Point unique de décision d'accès à un dossier patient.
 * Règle : rôle ET relation de soin (propriétaire, parent, aidant délégué,
 * équipe de soins, consentement actif ou bris de glace). Tout refus est journalisé.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async decide(user: AuthUser, patientId: string, scope: Scope): Promise<AccessDecision> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, userId: true, parentId: true },
    });
    if (!patient) throw new NotFoundException('Patient introuvable');

    if (patient.userId && patient.userId === user.id) return { allowed: true, via: 'OWNER' };
    if (patient.parentId && user.patientId && patient.parentId === user.patientId) return { allowed: true, via: 'PARENT' };

    const delegation = await this.prisma.delegation.findFirst({
      where: { patientId, caregiverId: user.id, revokedAt: null },
    });
    if (delegation && scope !== 'sensitive' && (delegation.scopes.includes(scope) || delegation.scopes.includes('all'))) {
      return { allowed: true, via: 'DELEGATION' };
    }

    if (CLINICAL_ROLES.includes(user.role) || user.role === 'PHARMACIST') {
      if (user.practitionerId && scope !== 'sensitive' && CLINICAL_ROLES.includes(user.role)) {
        const member = await this.prisma.careTeamMember.findUnique({
          where: { patientId_practitionerId: { patientId, practitionerId: user.practitionerId } },
        });
        if (member) return { allowed: true, via: 'CARE_TEAM' };
      }
      const consent = await this.prisma.consent.findFirst({
        where: {
          patientId,
          granteeId: user.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          scopes: { has: scope },
        },
        orderBy: { expiresAt: 'desc' },
      });
      if (consent) {
        return { allowed: true, via: consent.source === 'BREAK_GLASS' ? 'BREAK_GLASS' : 'CONSENT', consentExpiresAt: consent.expiresAt };
      }
    }
    return { allowed: false };
  }

  /** Vérifie l'accès, journalise la lecture ou le refus, et lève 403 si refusé. */
  async assert(user: AuthUser, patientId: string, scope: Scope, resource: string, ip?: string): Promise<AccessDecision> {
    const decision = await this.decide(user, patientId, scope);
    const selfAccess = decision.via === 'OWNER';
    if (!selfAccess) {
      await this.audit.log({
        actor: user,
        patientId,
        action: decision.allowed ? (decision.via === 'BREAK_GLASS' ? 'READ_BREAK_GLASS' : 'READ') : 'DENIED',
        resource,
        reason: decision.allowed ? `via ${decision.via}` : 'Aucun consentement actif ni relation de soin',
        allowed: decision.allowed,
        ip,
      });
    }
    if (!decision.allowed) {
      throw new ForbiddenException({
        code: 'CONSENT_REQUIRED',
        message: "Accès refusé : le patient n'a pas donné son consentement. La tentative a été enregistrée dans son journal d'accès.",
      });
    }
    return decision;
  }
}
