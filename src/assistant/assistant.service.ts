import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { DoseLog, Reminder } from '@prisma/client';
import { AccessService, type Scope } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../common/auth-user';
import { TickRegistry } from '../common/tick.registry';
import { CircleService } from '../circle/circle.service';
import { infoFor } from '../data/medication-info';
import { MEDICATIONS } from '../data/medications';
import { PrismaService } from '../prisma/prisma.service';
import { answerQuestion, type Lang2, type MedContext } from './answers';
import { cotonouDateKey, occurrences, startOfCotonouDay, type DosagePlan } from './dosage';
import { isCurrentPrescription, itemsWithPlan, treatmentStart, treatmentUntil } from './treatment';

const HOUR = 3600_000;
const DAY = 86_400_000;
/** Horizon des rappels créés d'un coup ; la tâche planifiée (et l'ouverture de l'assistant) prolonge le plan. */
export const PLAN_HORIZON_DAYS = 14;
/** Un plan dont la dernière prise prévue tombe avant ce délai est prolongé jusqu'à l'horizon. */
const EXTEND_WHEN_DAYS = 7;
/** Une prise d'il y a moins de 3 h entre encore dans le plan qu'on crée (« je l'ai prise ce matin »). */
const PLAN_LOOKBACK = 3 * HOUR;
/** On peut confirmer une prise jusqu'à 3 h avant l'heure prévue. */
const EARLY_CONFIRM = 3 * HOUR;
const SNOOZE = 30 * 60_000;
const TITLE_PREFIX = 'Prise : ';
/** Libellé montré à qui n'a pas accès aux ordonnances (délégation « rappels » seule) : le nom d'un médicament peut révéler une maladie. */
export const MASKED_MEDICATION = 'Prise de traitement';

export type DoseStatus = 'PRISE' | 'OUBLIEE' | 'DECALEE' | 'A_PRENDRE' | 'EN_RETARD' | 'A_VENIR';

const OTHER_DRUGS = [...new Set(MEDICATIONS.map((m) => m.dci))].filter((d) => !/^(acide|sulfate|chlorure|glucose|insuline|sels|zinc|ringer|retinol)/i.test(d));

function hhmm(d: Date) {
  return new Date(d.getTime() + HOUR).toISOString().slice(11, 16);
}

/** Statut d'une prise, d'après le journal, la confirmation (SMS « 1 ») et l'heure. */
export function doseStatus(r: Pick<Reminder, 'dueAt' | 'confirmedAt'>, log: Pick<DoseLog, 'status'> | undefined, now = new Date()): DoseStatus {
  if (log?.status === 'PRISE' || r.confirmedAt) return 'PRISE';
  if (log?.status === 'OUBLIEE') return 'OUBLIEE';
  const late = now.getTime() - r.dueAt.getTime();
  if (log?.status === 'DECALEE' && late < 0) return 'DECALEE';
  if (late < -30 * 60_000) return 'A_VENIR';
  if (late <= HOUR) return 'A_PRENDRE';
  return 'EN_RETARD';
}

/** Observance : prises confirmées / prises dues (passées depuis plus d'une heure, ou déjà renseignées). */
export function adherenceOf(rows: { dueAt: Date; confirmedAt: Date | null; log?: Pick<DoseLog, 'status'> }[], now = new Date()) {
  let due = 0;
  let taken = 0;
  for (const r of rows) {
    const counted = !!r.log || !!r.confirmedAt || r.dueAt.getTime() <= now.getTime() - HOUR;
    if (!counted) continue;
    due++;
    if (r.log?.status === 'PRISE' || r.confirmedAt) taken++;
  }
  return { due, taken, rate: due ? Math.round((taken / due) * 100) : null };
}

export interface DoseInfo {
  dci: string;
  strength: string;
  form: string;
  plan: DosagePlan;
}

/**
 * Vue d'une prise. Sans accès aux ordonnances (`names` faux), ni nom, ni dosage, ni forme : seulement
 * « Prise de traitement », l'heure, la quantité et le statut (l'aidant peut toujours dire « c'est pris »).
 */
export function doseView(r: Reminder, log: Pick<DoseLog, 'status' | 'at'> | undefined, info: DoseInfo | undefined, names: boolean, now = new Date()) {
  return {
    reminderId: r.id,
    prescriptionId: names ? r.prescriptionId : null,
    dueAt: r.dueAt,
    time: hhmm(r.dueAt),
    masked: !names,
    medication: names ? (info?.dci ?? r.title.replace(TITLE_PREFIX, '')) : MASKED_MEDICATION,
    strength: names ? (info?.strength ?? null) : null,
    form: names ? (info?.form ?? null) : null,
    dose: info?.plan.dose ?? null,
    meal: info?.plan.meal ?? null,
    status: doseStatus(r, log, now),
    loggedAt: log?.at ?? r.confirmedAt ?? null,
  };
}

/**
 * Prolongation d'un plan : nouvelles prises entre la dernière prévue (ou maintenant) et l'horizon de 14 jours,
 * sans dépasser la fin du traitement ; null si rien à ajouter (plan encore long, ou traitement fini).
 */
export function extensionWindow(lastDue: Date, end: Date | null, now = new Date()): { from: Date; until: Date } | null {
  if (lastDue.getTime() >= now.getTime() + EXTEND_WHEN_DAYS * DAY) return null;
  const horizon = new Date(now.getTime() + PLAN_HORIZON_DAYS * DAY);
  const until = end && end < horizon ? end : horizon;
  const from = new Date(Math.max(lastDue.getTime() + 60_000, now.getTime()));
  return from < until ? { from, until } : null;
}

@Injectable()
export class AssistantService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly circle: CircleService,
    private readonly ticks: TickRegistry,
  ) {}

  onModuleInit() {
    this.ticks.register('assistant', () => this.extendPlans());
  }

  /**
   * Le patient visé : soi-même, ou la personne aidée (délégation), contrôlé et journalisé.
   * `names` : la personne peut voir le nom des médicaments (soi-même, parent, ou délégation « ordonnances »).
   */
  private async target(user: AuthUser, patientId: string | undefined, scope: Scope, resource: string, ip?: string) {
    if (!patientId || patientId === user.patientId) {
      if (!user.patientId) throw new ForbiddenException('Choisissez la personne que vous aidez');
      return { patientId: user.patientId, self: true, names: true };
    }
    const decision = await this.access.assert(user, patientId, scope, resource, ip);
    const names = scope === 'prescriptions' || decision.via === 'PARENT' || (await this.access.decide(user, patientId, 'prescriptions')).allowed;
    return { patientId, self: false, names };
  }

  private async langOf(user: AuthUser, wanted?: string): Promise<Lang2> {
    if (wanted === 'en' || wanted === 'fr') return wanted;
    const u = await this.prisma.user.findUnique({ where: { id: user.id }, select: { lang: true } });
    return u?.lang === 'en' ? 'en' : 'fr';
  }

  // ─── Ordonnances en cours ────────────────────────────────────────

  private async currentPrescriptions(patientId: string) {
    const rows = await this.prisma.prescription.findMany({ where: { patientId, status: { in: ['ACTIVE', 'DISPENSED'] } }, orderBy: { issuedAt: 'desc' }, take: 20 });
    // Une même ordonnance saisie deux fois le même jour (mêmes lignes, même prescripteur) n'apparaît qu'une fois.
    const seen = new Set<string>();
    return rows.filter((rx) => {
      if (!isCurrentPrescription(rx)) return false;
      const key = `${cotonouDateKey(rx.issuedAt)}|${rx.status}|${rx.prescriberId}|${itemsWithPlan(rx).map((i) => `${i.medicationId}:${i.dosage}:${i.duration}`).sort().join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async plans(user: AuthUser, forPatient?: string, ip?: string) {
    const { patientId } = await this.target(user, forPatient, 'prescriptions', 'Traitement : ordonnances en cours', ip);
    const now = new Date();
    const rxs = await this.currentPrescriptions(patientId);
    const upcoming = await this.prisma.reminder.findMany({
      where: { patientId, kind: 'MEDICATION', prescriptionId: { in: rxs.map((r) => r.id) }, dueAt: { gte: now } },
      select: { prescriptionId: true, dueAt: true, title: true },
      orderBy: { dueAt: 'asc' },
    });
    const issued = new Map(rxs.map((r) => [r.id, r.issuedAt]));
    return rxs.map((rx) => {
      const mine = upcoming.filter((r) => r.prescriptionId === rx.id);
      // Ordonnance renouvelée : ses médicaments ont déjà des rappels venant d'une ordonnance plus récente.
      const plannable = itemsWithPlan(rx).filter((i) => i.plan.times.length > 0);
      const newer = mine.length || !plannable.length
        ? []
        : plannable.map((i) => upcoming.find((r) => r.title === `${TITLE_PREFIX}${i.dci}` && r.prescriptionId !== rx.id && (issued.get(r.prescriptionId!) ?? rx.issuedAt) > rx.issuedAt));
      const replacedBy = newer.length && newer.every(Boolean) ? newer[0]!.prescriptionId : null;
      return {
        id: rx.id,
        prescriber: rx.prescriberName,
        issuedAt: rx.issuedAt,
        status: rx.status,
        items: itemsWithPlan(rx).map((i) => ({
          dci: i.dci,
          strength: i.strength,
          form: i.form,
          dosage: i.dosage,
          duration: i.duration,
          times: i.plan.times,
          perDay: i.plan.perDay,
          everyDays: i.plan.everyDays,
          dose: i.plan.dose,
          meal: i.plan.meal,
          asNeeded: i.plan.asNeeded,
          understood: i.plan.understood,
          until: treatmentUntil(rx, i.plan),
        })),
        plan: {
          active: mine.length > 0,
          upcoming: mine.length,
          until: mine.length ? mine[mine.length - 1].dueAt : null,
          replacedBy: replacedBy ? { id: replacedBy, issuedAt: issued.get(replacedBy) ?? null } : null,
        },
      };
    });
  }

  /**
   * Crée (ou remplace) le plan de prises d'une ordonnance : un rappel MEDICATION par prise, sur la
   * durée du traitement, 14 jours d'avance (prolongés ensuite). Les prises déjà renseignées sont gardées.
   */
  async createPlan(user: AuthUser, prescriptionId: string, forPatient?: string, ip?: string) {
    const { patientId, self } = await this.target(user, forPatient, 'prescriptions', 'Traitement : plan de prises', ip);
    const rx = await this.prisma.prescription.findUnique({ where: { id: prescriptionId } });
    if (!rx || rx.patientId !== patientId) throw new NotFoundException('Ordonnance introuvable');
    if (!isCurrentPrescription(rx)) throw new ConflictException('Cette ordonnance n’est plus en cours : pas de plan de prises.');

    const now = new Date();
    const from = new Date(now.getTime() - PLAN_LOOKBACK);
    const horizon = new Date(now.getTime() + PLAN_HORIZON_DAYS * DAY);
    const items = itemsWithPlan(rx);
    const titles = items.map((i) => `${TITLE_PREFIX}${i.dci}`);
    // Remplace le plan de cette ordonnance, et les prises à venir des mêmes médicaments issues d'une
    // ordonnance précédente (renouvellement) : jamais deux rappels pour une même prise.
    const existing = await this.prisma.reminder.findMany({
      where: { patientId, kind: 'MEDICATION', dueAt: { gte: from }, OR: [{ prescriptionId: rx.id }, { prescriptionId: { not: null }, title: { in: titles } }] },
    });
    const logged = new Set((await this.prisma.doseLog.findMany({ where: { reminderId: { in: existing.map((r) => r.id) } }, select: { reminderId: true } })).map((l) => l.reminderId));
    // On garde l'histoire : prises renseignées, confirmées, ou déjà relancées par le cercle de soins.
    const keep = existing.filter((r) => r.confirmedAt || r.escalation > 0 || logged.has(r.id));
    const removed = existing.filter((r) => !keep.includes(r)).map((r) => r.id);
    const replaced = removed.length;
    // Jamais de visite du relais rattachée à un rappel supprimé.
    await this.circle.cancelPendingVisits(removed, 'answered');
    await this.prisma.reminder.deleteMany({ where: { id: { in: removed } } });
    const kept = new Set(keep.map((r) => `${r.title}|${r.dueAt.getTime()}`));

    const data: { patientId: string; kind: string; title: string; dueAt: Date; channels: string[]; prescriptionId: string }[] = [];
    const summary = items.map((i) => {
      const end = treatmentUntil(rx, i.plan);
      const until = end && end < horizon ? end : horizon;
      const title = `${TITLE_PREFIX}${i.dci}`;
      const dates = i.plan.times.length ? occurrences(i.plan.times, i.plan.everyDays, from, until, treatmentStart(rx)) : [];
      for (const dueAt of dates) {
        if (!kept.has(`${title}|${dueAt.getTime()}`)) data.push({ patientId, kind: 'MEDICATION', title, dueAt, channels: ['APP', 'SMS'], prescriptionId: rx.id });
      }
      return {
        dci: i.dci,
        dosage: i.dosage,
        times: i.plan.times,
        dose: i.plan.dose,
        asNeeded: i.plan.asNeeded,
        understood: i.plan.understood,
        until: dates.length ? dates[dates.length - 1] : null,
        reminders: dates.length,
      };
    });
    if (data.length) await this.prisma.reminder.createMany({ data });
    if (!self) await this.audit.log({ actor: user, patientId, action: 'WRITE', resource: 'Plan de prises (assistant)', ip });
    return { prescriptionId: rx.id, created: data.length, replaced, kept: keep.length, items: summary };
  }

  // ─── Prises du jour ──────────────────────────────────────────────

  /** Dose et repas de chaque rappel, relus sur l'ordonnance d'origine. */
  private async doseInfo(reminders: Reminder[]) {
    const ids = [...new Set(reminders.map((r) => r.prescriptionId).filter((x): x is string => !!x))];
    const rxs = await this.prisma.prescription.findMany({ where: { id: { in: ids } } });
    const byKey = new Map<string, DoseInfo>();
    for (const rx of rxs) for (const i of itemsWithPlan(rx)) byKey.set(`${rx.id}|${TITLE_PREFIX}${i.dci}`, i);
    return (r: Reminder) => byKey.get(`${r.prescriptionId}|${r.title}`);
  }

  private async logsFor(reminderIds: string[]) {
    const logs = await this.prisma.doseLog.findMany({ where: { reminderId: { in: reminderIds } } });
    return new Map(logs.map((l) => [l.reminderId!, l]));
  }

  async today(user: AuthUser, forPatient?: string, ip?: string) {
    const { patientId, names } = await this.target(user, forPatient, 'reminders', 'Traitement : prises du jour', ip);
    const now = new Date();
    // Ouvrir l'assistant prolonge aussi le plan (au cas où la tâche planifiée n'est pas encore passée).
    await this.extendPlans(patientId, now);
    const start = startOfCotonouDay(now);
    const reminders = await this.prisma.reminder.findMany({
      where: { patientId, kind: 'MEDICATION', prescriptionId: { not: null }, dueAt: { gte: start, lt: new Date(start.getTime() + DAY) } },
      orderBy: { dueAt: 'asc' },
    });
    const next = await this.prisma.reminder.findFirst({
      where: { patientId, kind: 'MEDICATION', prescriptionId: { not: null }, dueAt: { gte: new Date(start.getTime() + DAY) } },
      orderBy: { dueAt: 'asc' },
    });
    const all = next ? [...reminders, next] : reminders;
    const [logs, info] = await Promise.all([this.logsFor(all.map((r) => r.id)), this.doseInfo(all)]);
    const doses = reminders.map((r) => doseView(r, logs.get(r.id), info(r), names, now));
    return {
      date: cotonouDateKey(now),
      doses,
      done: doses.filter((d) => d.status === 'PRISE').length,
      tomorrow: next ? doseView(next, logs.get(next.id), info(next), names, now) : null,
    };
  }

  /**
   * Prise renseignée. « Pris » passe par le point unique de confirmation du cercle de soins (aidants
   * rassurés, visite du relais annulée). « Plus tard » et « Oublié » sont des réponses : la visite du relais
   * n'a plus lieu d'être ; le report déplace l'heure sans relancer l'envoi (pas de nouvelle alerte des aidants).
   */
  async markDose(user: AuthUser, reminderId: string, status: 'PRISE' | 'OUBLIEE' | 'DECALEE', lang?: string, forPatient?: string, ip?: string) {
    const reminder = await this.prisma.reminder.findUnique({ where: { id: reminderId } });
    if (!reminder || reminder.kind !== 'MEDICATION' || !reminder.prescriptionId) throw new NotFoundException('Prise introuvable');
    const { patientId, self, names } = await this.target(user, forPatient ?? reminder.patientId, 'reminders', 'Traitement : prise renseignée', ip);
    if (reminder.patientId !== patientId) throw new NotFoundException('Prise introuvable');

    const now = new Date();
    const ahead = reminder.dueAt.getTime() - now.getTime();
    if (status === 'PRISE' && ahead > EARLY_CONFIRM) throw new BadRequestException(`Cette prise est prévue à ${hhmm(reminder.dueAt)} : confirmez-la à ce moment-là.`);
    if (status !== 'PRISE' && ahead > 30 * 60_000) throw new BadRequestException(`Cette prise est prévue à ${hhmm(reminder.dueAt)} : rien à signaler pour l’instant.`);
    // Une prise confirmée le reste (le cercle a pu être rassuré) : pas de retour à « oubliée » ou « plus tard ».
    if (reminder.confirmedAt && status !== 'PRISE') throw new ConflictException('Cette prise est déjà confirmée.');

    let updated: Reminder;
    if (status === 'PRISE') {
      updated = await this.circle.markConfirmed(reminder.id, { userId: user.id });
    } else {
      await this.circle.cancelPendingVisits([reminder.id], 'answered');
      updated =
        status === 'DECALEE'
          ? // Report de 30 min : l'heure change, l'envoi (sentAt) et le niveau de relance restent ;
            // le délai avant de prévenir les aidants repart de la nouvelle heure (max(envoi, heure prévue)).
            await this.prisma.reminder.update({ where: { id: reminder.id }, data: { dueAt: new Date(Math.max(now.getTime(), reminder.dueAt.getTime()) + SNOOZE) } })
          : reminder;
    }
    const info = (await this.doseInfo([updated]))(updated);
    const medication = info?.dci ?? reminder.title.replace(TITLE_PREFIX, '');
    const log = await this.prisma.doseLog.upsert({
      where: { reminderId: reminder.id },
      create: { patientId, reminderId: reminder.id, prescriptionId: reminder.prescriptionId, medication, status, at: now },
      update: { status, at: now },
    });
    if (!self) await this.audit.log({ actor: user, patientId, action: 'WRITE', resource: `Prise de traitement : ${status === 'PRISE' ? 'prise' : status === 'OUBLIEE' ? 'oubliée' : 'reportée'}`, ip });

    let advice: { medication: string; text: string; source: string } | null = null;
    if (status === 'OUBLIEE') {
      const l = await this.langOf(user, lang);
      const sheet = names ? infoFor(medication) : null;
      advice = sheet
        ? { medication: sheet.name[l], text: sheet.missed[l], source: l === 'en' ? `Ganji sheet: ${sheet.name.en}` : `Fiche Ganji : ${sheet.name.fr}` }
        : {
            medication: names ? medication : MASKED_MEDICATION,
            text: l === 'en' ? 'Never take two doses at once to catch up. Ask the pharmacist what to do.' : 'Ne prenez jamais deux doses d’un coup pour rattraper. Demandez au pharmacien quoi faire.',
            source: l === 'en' ? 'Ganji safety rules' : 'Consignes de sécurité Ganji',
          };
    }
    return { dose: doseView(updated, log, info, names, now), advice };
  }

  /**
   * Prolonge les plans de prises en cours jusqu'à 14 jours d'avance, sans dépasser la fin du traitement
   * (tâche planifiée pour tous, ou ouverture de l'assistant pour un patient).
   */
  async extendPlans(patientId?: string, now = new Date()): Promise<Record<string, number>> {
    const groups = await this.prisma.reminder.groupBy({
      by: ['patientId', 'prescriptionId', 'title'],
      where: { kind: 'MEDICATION', prescriptionId: { not: null }, dueAt: { gte: startOfCotonouDay(now) }, ...(patientId ? { patientId } : {}) },
      _max: { dueAt: true },
    });
    // Par patient et par médicament, seul le plan le plus récent se prolonge (après un renouvellement,
    // l'ancienne ordonnance garde ses prises du jour déjà renseignées mais ne doit pas repartir).
    const latest = new Map<string, (typeof groups)[number]>();
    for (const g of groups) {
      const key = `${g.patientId}|${g.title}`;
      const prev = latest.get(key);
      if (!prev || (g._max.dueAt ?? 0) > (prev._max.dueAt ?? 0)) latest.set(key, g);
    }
    const due = [...latest.values()].filter((g) => g._max.dueAt && g._max.dueAt.getTime() < now.getTime() + EXTEND_WHEN_DAYS * DAY);
    if (!due.length) return { assistantPlansProlonges: 0, assistantRappelsCrees: 0 };
    const rxs = new Map((await this.prisma.prescription.findMany({ where: { id: { in: [...new Set(due.map((g) => g.prescriptionId!))] } } })).map((r) => [r.id, r]));
    const data: { patientId: string; kind: string; title: string; dueAt: Date; channels: string[]; prescriptionId: string }[] = [];
    let plans = 0;
    for (const g of due) {
      const rx = rxs.get(g.prescriptionId!);
      if (!rx || !isCurrentPrescription(rx, now)) continue;
      const item = itemsWithPlan(rx).find((i) => `${TITLE_PREFIX}${i.dci}` === g.title);
      if (!item?.plan.times.length) continue;
      const w = extensionWindow(g._max.dueAt!, treatmentUntil(rx, item.plan), now);
      if (!w) continue;
      const dates = occurrences(item.plan.times, item.plan.everyDays, w.from, w.until, treatmentStart(rx));
      if (!dates.length) continue;
      plans++;
      for (const dueAt of dates) data.push({ patientId: g.patientId, kind: 'MEDICATION', title: g.title, dueAt, channels: ['APP', 'SMS'], prescriptionId: rx.id });
    }
    if (data.length) await this.prisma.reminder.createMany({ data });
    return { assistantPlansProlonges: plans, assistantRappelsCrees: data.length };
  }

  async adherence(user: AuthUser, forPatient?: string, ip?: string) {
    const { patientId } = await this.target(user, forPatient, 'reminders', 'Traitement : observance', ip);
    const now = new Date();
    const start30 = startOfCotonouDay(new Date(now.getTime() - 29 * DAY));
    const start7 = startOfCotonouDay(new Date(now.getTime() - 6 * DAY));
    const reminders = await this.prisma.reminder.findMany({
      where: { patientId, kind: 'MEDICATION', prescriptionId: { not: null }, dueAt: { gte: start30, lte: new Date(now.getTime() + EARLY_CONFIRM) } },
      select: { id: true, dueAt: true, confirmedAt: true },
    });
    const logs = await this.logsFor(reminders.map((r) => r.id));
    const rows = reminders.map((r) => ({ ...r, log: logs.get(r.id) }));
    const days = Array.from({ length: 7 }, (_, k) => {
      const dayStart = new Date(start7.getTime() + k * DAY);
      const dayRows = rows.filter((r) => r.dueAt >= dayStart && r.dueAt < new Date(dayStart.getTime() + DAY));
      return { date: cotonouDateKey(dayStart), ...adherenceOf(dayRows, now) };
    });
    return {
      last7: adherenceOf(rows.filter((r) => r.dueAt >= start7), now),
      last30: adherenceOf(rows, now),
      days,
    };
  }

  // ─── Questions ───────────────────────────────────────────────────

  async ask(user: AuthUser, question: string, lang?: string, forPatient?: string, ip?: string) {
    const { patientId } = await this.target(user, forPatient, 'prescriptions', 'Traitement : question à l’assistant', ip);
    const l = await this.langOf(user, lang);
    const now = new Date();
    const rxs = await this.currentPrescriptions(patientId);
    const future = await this.prisma.reminder.findMany({
      where: { patientId, kind: 'MEDICATION', prescriptionId: { in: rxs.map((r) => r.id) }, dueAt: { gte: now } },
      select: { prescriptionId: true, title: true, dueAt: true },
      orderBy: { dueAt: 'asc' },
    });
    const meds: MedContext[] = rxs.flatMap((rx) =>
      itemsWithPlan(rx).map((i) => {
        // Les rappels d'un médicament comptent quelle que soit l'ordonnance qui les a créés (renouvellement).
        const mine = future.filter((r) => r.title === `${TITLE_PREFIX}${i.dci}`);
        return {
          dci: i.dci,
          strength: i.strength,
          dosage: i.dosage,
          duration: i.duration,
          plan: i.plan,
          prescriber: rx.prescriberName,
          issuedAt: rx.issuedAt,
          until: treatmentUntil(rx, i.plan),
          reminderTimes: [...new Set(mine.map((r) => hhmm(r.dueAt)))].sort(),
          nextDose: mine[0]?.dueAt ?? null,
          planned: mine.some((r) => r.prescriptionId === rx.id),
        };
      }),
    );
    return { question, ...answerQuestion(question, meds, l, OTHER_DRUGS) };
  }
}
