import { describe, expect, it, vi } from 'vitest';
import { answerQuestion, detectIntent, type MedContext } from '../src/assistant/answers';
import { ConflictException } from '@nestjs/common';
import { adherenceOf, AssistantService, doseStatus, doseView, extensionWindow, MASKED_MEDICATION, PLAN_HORIZON_DAYS } from '../src/assistant/assistant.service';
import { parseDosage } from '../src/assistant/dosage';
import { isCurrentPrescription } from '../src/assistant/treatment';
import { infoFor } from '../src/data/medication-info';
import { MEDICATIONS } from '../src/data/medications';

const med = (dci: string, dosage: string, extra: Partial<MedContext> = {}): MedContext => ({
  dci,
  strength: '100 mg',
  dosage,
  duration: '30 jours',
  plan: parseDosage(dosage, '30 jours'),
  prescriber: 'Dr Houngbédji',
  issuedAt: new Date('2026-09-24T10:00:00Z'),
  until: new Date('2026-10-23T22:59:00Z'),
  reminderTimes: [],
  nextDose: null,
  ...extra,
});
const KOFFI = [med('Imatinib', '1 comprimé par jour, au cours du repas', { reminderTimes: ['13:00'] }), med('Allopurinol', '1 comprimé le matin', { reminderTimes: ['08:00'] })];
const OTHERS = MEDICATIONS.map((m) => m.dci);

describe('assistant : intention de la question (français et anglais)', () => {
  it.each([
    ['J’ai oublié ma dose, que faire ?', 'MISSED'],
    ['I forgot my pill', 'MISSED'],
    ['À quelle heure je prends mes comprimés ?', 'WHEN'],
    ['What time should I take it?', 'WHEN'],
    ['Avec ou sans repas ?', 'FOOD'],
    ['Can I take it on an empty stomach?', 'FOOD'],
    ['Quels sont les effets indésirables ?', 'SIDE_EFFECTS'],
    ['Jusqu’à quand dois-je le prendre ?', 'DURATION'],
    ['How long do I take it?', 'DURATION'],
    ['Je me sens mieux, je peux arrêter ?', 'STOP'],
    ['Je peux boire de l’alcool ?', 'INTERACTION'],
    ['Je prends une tisane en même temps, c’est grave ?', 'INTERACTION'],
    ['Je saigne du nez depuis ce matin', 'DANGER'],
    ['I have chest pain', 'DANGER'],
    ['Est-ce que j’ai le palu ?', 'DIAGNOSIS'],
    ['Je peux doubler la dose ?', 'CHANGE_DOSE'],
    ['À quoi sert ce médicament ?', 'PURPOSE'],
    ['Il fait beau aujourd’hui', 'UNKNOWN'],
  ])('« %s » → %s', (q, intent) => {
    expect(detectIntent(q)).toBe(intent);
  });
});

describe('assistant : réponses tirées de l’ordonnance et des fiches, jamais inventées', () => {
  it('dose oubliée : consigne de la fiche pour chaque médicament, sources et ligne de sécurité', () => {
    const a = answerQuestion('J’ai oublié ma dose, que faire ?', KOFFI, 'fr', OTHERS);
    expect(a.intent).toBe('MISSED');
    expect(a.lines.map((l) => l.medication)).toEqual(['Imatinib', 'Allopurinol']);
    expect(a.answer).toContain('Ne prenez jamais deux doses');
    expect(a.sources.map((s) => s.kind)).toEqual(['FICHE', 'FICHE']);
    expect(a.safety).toContain('118');
  });

  it('question sur un seul médicament nommé : réponse sur celui-là seulement', () => {
    const a = answerQuestion('À quoi sert l’allopurinol ?', KOFFI, 'fr', OTHERS);
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0].medication).toBe('Allopurinol');
    expect(a.lines[0].text).toBe(infoFor('Allopurinol')!.purpose.fr);
  });

  it('heures : la posologie de l’ordonnance et les rappels du plan', () => {
    const a = answerQuestion('Quand prendre mes médicaments ?', KOFFI, 'fr', OTHERS);
    expect(a.answer).toContain('1 comprimé le matin');
    expect(a.answer).toContain('08:00');
    expect(a.sources[0].kind).toBe('ORDONNANCE');
  });

  it('un autre médicament cité → pharmacien, sans rien affirmer', () => {
    const a = answerQuestion('Je peux prendre du paracétamol avec ?', KOFFI, 'fr', OTHERS);
    expect(a.intent).toBe('INTERACTION');
    expect(a.answer).toContain('pharmacien');
    const b = answerQuestion('À quoi sert l’ibuprofène ?', KOFFI, 'fr', OTHERS);
    expect(b.intent).toBe('OTHER_MEDICINE');
  });

  it('signes de danger → 118, réponse urgente', () => {
    const a = answerQuestion('Je respire mal et j’ai le visage gonflé', KOFFI, 'fr', OTHERS);
    expect(a.urgent).toBe(true);
    expect(a.answer).toContain('118');
  });

  it('sans ordonnance en cours : aucune réponse sur un médicament', () => {
    const a = answerQuestion('J’ai oublié ma dose', [], 'fr', OTHERS);
    expect(a.answer).toContain('pas d’ordonnance en cours');
  });

  it('répond en anglais quand la langue est l’anglais', () => {
    const a = answerQuestion('I forgot my dose', KOFFI, 'en', OTHERS);
    expect(a.answer).toContain('Never take two doses');
    expect(a.safety).toContain('call 118');
  });

  it('médicament sans fiche : renvoi au pharmacien', () => {
    const a = answerQuestion('Quels effets indésirables ?', [med('Losartan', '1 comprimé le matin')], 'fr', OTHERS);
    expect(a.answer).toContain('demandez au pharmacien');
  });

  it('une fiche existe pour les médicaments prescrits dans la démonstration', () => {
    for (const dci of ['Imatinib', 'Allopurinol', 'Paracétamol', 'Artéméther + luméfantrine', 'Metformine', 'Sulfate ferreux + acide folique', 'Hydroxyurée (hydroxycarbamide)']) {
      expect(infoFor(dci), dci).not.toBeNull();
    }
    expect(infoFor('Sulfate ferreux + acide folique')!.match).toBe('sulfate ferreux');
  });
});

describe('assistant : statut des prises et observance', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it('statut d’une prise selon l’heure et le journal', () => {
    expect(doseStatus({ dueAt: at(120), confirmedAt: null }, undefined, now)).toBe('A_VENIR');
    expect(doseStatus({ dueAt: at(10), confirmedAt: null }, undefined, now)).toBe('A_PRENDRE');
    expect(doseStatus({ dueAt: at(-45), confirmedAt: null }, undefined, now)).toBe('A_PRENDRE');
    expect(doseStatus({ dueAt: at(-120), confirmedAt: null }, undefined, now)).toBe('EN_RETARD');
    expect(doseStatus({ dueAt: at(-120), confirmedAt: now }, undefined, now)).toBe('PRISE');
    expect(doseStatus({ dueAt: at(-120), confirmedAt: null }, { status: 'OUBLIEE' }, now)).toBe('OUBLIEE');
    expect(doseStatus({ dueAt: at(20), confirmedAt: null }, { status: 'DECALEE' }, now)).toBe('DECALEE');
  });

  it('observance : prises confirmées sur prises dues, les prises à venir ne comptent pas', () => {
    const rows = [
      { dueAt: at(-600), confirmedAt: at(-590) },
      { dueAt: at(-300), confirmedAt: null, log: { status: 'OUBLIEE' } },
      { dueAt: at(-200), confirmedAt: null },
      { dueAt: at(-30), confirmedAt: null },
      { dueAt: at(60), confirmedAt: null, log: { status: 'PRISE' } },
      { dueAt: at(300), confirmedAt: null },
    ];
    expect(adherenceOf(rows, now)).toEqual({ due: 4, taken: 2, rate: 50 });
    expect(adherenceOf([], now)).toEqual({ due: 0, taken: 0, rate: null });
  });

  it('ordonnance en cours : valide non délivrée, ou délivrée et traitement non fini', () => {
    const items = [{ medicationId: 'x', dci: 'Imatinib', form: 'comprimé', strength: '400 mg', dosage: '1 comprimé par jour', duration: '30 jours', quantity: 1 }];
    const base = { items, issuedAt: new Date('2026-09-01T10:00:00Z'), expiresAt: new Date('2026-10-01T10:00:00Z'), dispensedAt: null };
    expect(isCurrentPrescription({ ...base, status: 'ACTIVE' }, now)).toBe(true);
    expect(isCurrentPrescription({ ...base, status: 'CANCELLED' }, now)).toBe(false);
    expect(isCurrentPrescription({ ...base, status: 'DISPENSED', dispensedAt: new Date('2026-09-10T10:00:00Z') }, now)).toBe(true);
    expect(isCurrentPrescription({ ...base, status: 'DISPENSED', dispensedAt: new Date('2026-08-20T10:00:00Z') }, now)).toBe(false);
  });
});

// ─── Revue de sécurité : masquage, cercle de soins, prolongation ─────────────

const RX_ID = '5ac8cd90-3416-4eae-9061-c17581c4dec5';
const reminderRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  patientId: 'p1',
  kind: 'MEDICATION',
  title: 'Prise : Imatinib',
  place: null,
  dueAt: new Date(Date.now() - 20 * 60_000),
  channels: ['APP', 'SMS'],
  sentAt: new Date(Date.now() - 3600_000),
  confirmedAt: null as Date | null,
  appointmentId: null,
  prescriptionId: RX_ID,
  escalation: 1,
  ...over,
});
const rxRow = {
  id: RX_ID,
  items: [{ medicationId: 'm1', dci: 'Imatinib', form: 'comprimé', strength: '400 mg', dosage: '1 comprimé par jour, au cours du repas', duration: '30 jours', quantity: 1 }],
};

function makeService(opts: { reminder?: ReturnType<typeof reminderRow>; prescriptionsScope?: boolean } = {}) {
  const r = opts.reminder ?? reminderRow();
  const prisma = {
    reminder: {
      findUnique: vi.fn().mockResolvedValue(r),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...r, ...data })),
    },
    prescription: { findMany: vi.fn().mockResolvedValue([rxRow]) },
    doseLog: { upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({ ...create })) },
    user: { findUnique: vi.fn().mockResolvedValue({ lang: 'fr' }) },
  };
  const access = {
    assert: vi.fn().mockResolvedValue({ allowed: true, via: 'DELEGATION' }),
    decide: vi.fn().mockResolvedValue({ allowed: !!opts.prescriptionsScope, via: opts.prescriptionsScope ? 'DELEGATION' : undefined }),
  };
  const audit = { log: vi.fn() };
  const circle = {
    markConfirmed: vi.fn().mockImplementation((id: string) => Promise.resolve({ ...r, id, confirmedAt: new Date() })),
    cancelPendingVisits: vi.fn().mockResolvedValue(0),
  };
  const ticks = { register: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new AssistantService(prisma as any, access as any, audit as any, circle as any, ticks as any);
  return { svc, prisma, access, circle, audit };
}
const koffiUser = { id: 'u1', role: 'PATIENT' as const, name: 'Koffi', patientId: 'p1' };
const afiaviUser = { id: 'u2', role: 'CAREGIVER' as const, name: 'Afiavi', patientId: 'p9' };

describe('assistant : revue de sécurité', () => {
  it('sans accès aux ordonnances, une prise ne montre ni nom, ni dosage, ni ordonnance', () => {
    const r = reminderRow();
    const info = { dci: 'Imatinib', strength: '400 mg', form: 'comprimé', plan: parseDosage('1 comprimé par jour, au cours du repas') };
    const open = doseView(r as never, undefined, info, true);
    expect(open).toMatchObject({ medication: 'Imatinib', strength: '400 mg', masked: false, prescriptionId: RX_ID });
    const masked = doseView(r as never, undefined, info, false);
    expect(masked).toMatchObject({ medication: MASKED_MEDICATION, strength: null, form: null, prescriptionId: null, masked: true, dose: '1 comprimé' });
    expect(JSON.stringify(masked)).not.toContain('Imatinib');
  });

  it('« Pris » passe par la confirmation du cercle de soins, sans écrire confirmedAt directement', async () => {
    const { svc, prisma, circle } = makeService();
    const out = await svc.markDose(koffiUser, 'r1', 'PRISE', 'fr');
    expect(circle.markConfirmed).toHaveBeenCalledWith('r1', { userId: 'u1' });
    expect(prisma.reminder.update).not.toHaveBeenCalled();
    expect(prisma.doseLog.upsert.mock.calls[0][0].create.status).toBe('PRISE');
    expect(out.dose.status).toBe('PRISE');
  });

  it('« Plus tard » annule la visite du relais et déplace l’heure sans relancer l’envoi ni l’escalade', async () => {
    const { svc, prisma, circle } = makeService();
    await svc.markDose(koffiUser, 'r1', 'DECALEE', 'fr');
    expect(circle.cancelPendingVisits).toHaveBeenCalledWith(['r1'], 'answered');
    const data = prisma.reminder.update.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(['dueAt']);
    expect(data.dueAt.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
  });

  it('« Oublié » annule la visite du relais ; une prise confirmée ne peut plus devenir oubliée', async () => {
    const a = makeService();
    const out = await a.svc.markDose(koffiUser, 'r1', 'OUBLIEE', 'fr');
    expect(a.circle.cancelPendingVisits).toHaveBeenCalledWith(['r1'], 'answered');
    expect(a.prisma.reminder.update).not.toHaveBeenCalled();
    expect(out.advice?.source).toBe('Fiche Ganji : Imatinib');
    const b = makeService({ reminder: reminderRow({ confirmedAt: new Date() }) });
    await expect(b.svc.markDose(koffiUser, 'r1', 'OUBLIEE', 'fr')).rejects.toBeInstanceOf(ConflictException);
  });

  it('aidante « rappels » seule : elle peut dire « c’est pris », sans voir le nom du médicament', async () => {
    const { svc, circle } = makeService({ prescriptionsScope: false });
    const taken = await svc.markDose(afiaviUser, 'r1', 'PRISE', 'fr');
    expect(circle.markConfirmed).toHaveBeenCalled();
    expect(taken.dose.medication).toBe(MASKED_MEDICATION);
    const missed = await makeService({ prescriptionsScope: false }).svc.markDose(afiaviUser, 'r1', 'OUBLIEE', 'fr');
    expect(JSON.stringify(missed)).not.toContain('Imatinib');
    const withRx = await makeService({ prescriptionsScope: true }).svc.markDose(afiaviUser, 'r1', 'PRISE', 'fr');
    expect(withRx.dose.medication).toBe('Imatinib');
  });

  it('prolongation du plan : 14 jours d’avance, jamais au-delà de la fin du traitement', () => {
    const now = new Date('2026-09-26T09:00:00Z');
    const day = 86_400_000;
    expect(PLAN_HORIZON_DAYS).toBe(14);
    expect(extensionWindow(new Date(now.getTime() + 10 * day), null, now)).toBeNull();
    const w = extensionWindow(new Date(now.getTime() + 3 * day), null, now)!;
    expect(w.from.getTime()).toBe(now.getTime() + 3 * day + 60_000);
    expect(w.until.getTime()).toBe(now.getTime() + 14 * day);
    const end = new Date(now.getTime() + 5 * day);
    expect(extensionWindow(new Date(now.getTime() + 3 * day), end, now)!.until).toEqual(end);
    expect(extensionWindow(new Date(now.getTime() + 3 * day), new Date(now.getTime() + 2 * day), now)).toBeNull();
    // Plan en retard (tâche non passée) : on repart de maintenant, pas du passé.
    expect(extensionWindow(new Date(now.getTime() - 2 * day), null, now)!.from).toEqual(now);
  });
});
