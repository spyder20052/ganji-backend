import { occurrences, parseDosage, startOfCotonouDay } from '../../src/assistant/dosage';
import { PLAN_HORIZON_DAYS } from '../../src/assistant/assistant.service';
import { isCurrentPrescription, treatmentStart, treatmentUntil } from '../../src/assistant/treatment';
import type { SeedCtx } from './context';

const DAY = 86_400_000;
const HISTORY_DAYS = 8;

/**
 * Données de démonstration : assistant de traitement. Rejouable.
 * Plan de prises de l'ordonnance en cours de Koffi (Imatinib au déjeuner, Allopurinol le matin) :
 * 8 jours d'historique, environ 80 % des prises confirmées (une oubliée signalée, deux sans réponse),
 * puis les rappels des 14 prochains jours (prolongés par la tâche planifiée). Les prises d'aujourd'hui restent à renseigner.
 */
export async function seedAssistant(ctx: SeedCtx) {
  const { prisma, users } = ctx;
  const koffi = users.koffi && (await prisma.patient.findUnique({ where: { userId: users.koffi.id }, select: { id: true } }));
  if (!koffi) return;

  // Le traitement que Koffi prend en ce moment (Imatinib + Allopurinol) : de préférence l'ordonnance
  // déjà délivrée (il a les boîtes), la plus ancienne encore en cours ; sinon la plus récente valide.
  const rxs = (await prisma.prescription.findMany({ where: { patientId: koffi.id, status: { in: ['ACTIVE', 'DISPENSED'] } }, orderBy: { issuedAt: 'desc' } }))
    .filter((r) => isCurrentPrescription(r) && (r.items as { dci: string }[]).some((i) => i.dci === 'Allopurinol'));
  const dispensed = rxs.filter((r) => r.status === 'DISPENSED').sort((a, b) => treatmentStart(a).getTime() - treatmentStart(b).getTime());
  const rx = dispensed[0] ?? rxs[0];

  // Rejouable : on efface le plan de prises (rappels liés à une ordonnance) et son journal.
  await prisma.doseLog.deleteMany({ where: { patientId: koffi.id } });
  await prisma.reminder.deleteMany({ where: { patientId: koffi.id, kind: 'MEDICATION', prescriptionId: { not: null } } });
  if (!rx) return;

  const now = new Date();
  const from = startOfCotonouDay(new Date(now.getTime() - HISTORY_DAYS * DAY));
  const horizon = new Date(now.getTime() + PLAN_HORIZON_DAYS * DAY);
  const items = rx.items as { dci: string; dosage: string; duration: string }[];
  const rows = items.flatMap((i) => {
    const plan = parseDosage(i.dosage, i.duration);
    const end = treatmentUntil(rx, plan);
    const until = end && end < horizon ? end : horizon;
    return occurrences(plan.times, plan.everyDays, from, until, treatmentStart(rx)).map((dueAt) => ({ dueAt, dci: i.dci }));
  });
  rows.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  // Passé (hors aujourd'hui) : 3 prises manquées sur 8 jours (2 dans les 7 derniers), le reste confirmé :
  // environ 83 % sur 7 jours, 81 % sur 30 jours.
  const today = startOfCotonouDay(now);
  const past = rows.filter((r) => r.dueAt < today);
  const missed = new Map<number, 'OUBLIEE' | null>([
    [past.length - 4, null],
    [past.length - 9, 'OUBLIEE'],
    [past.length - 15, null],
  ]);
  let k = 0;
  for (const r of rows) {
    const isPast = r.dueAt < today;
    const index = isPast ? k++ : -1;
    const miss = missed.get(index);
    const taken = isPast && miss === undefined;
    const reminder = await prisma.reminder.create({
      data: {
        patientId: koffi.id,
        kind: 'MEDICATION',
        title: `Prise : ${r.dci}`,
        dueAt: r.dueAt,
        channels: ['APP', 'SMS'],
        prescriptionId: rx.id,
        sentAt: isPast ? r.dueAt : null,
        confirmedAt: taken ? new Date(r.dueAt.getTime() + 12 * 60_000) : null,
      },
    });
    if (taken || miss === 'OUBLIEE') {
      await prisma.doseLog.create({
        data: {
          patientId: koffi.id,
          reminderId: reminder.id,
          prescriptionId: rx.id,
          medication: r.dci,
          status: taken ? 'PRISE' : 'OUBLIEE',
          at: new Date(r.dueAt.getTime() + (taken ? 12 : 95) * 60_000),
        },
      });
    }
  }
}
