import type { SeedCtx } from './context';

/**
 * Données de démonstration : rendez-vous.
 * - Koffi : consultation d'hématologie confirmée au CNHU-HKM dans 3 jours à 10 h (après la NFS de 8 h),
 *   avec son rappel (SMS + application) ; une consultation passée, honorée.
 * - Trois demandes en attente au CNHU-HKM, l'établissement du Dr Houngbédji (Serge, Afiavi, Bio).
 * - Afiavi, aidante de Koffi, reçoit aussi le droit « rendez-vous ».
 * Rejouable : efface d'abord les rendez-vous de ces personnes et ceux du CNHU-HKM.
 */
export async function seedAppointments(ctx: SeedCtx) {
  const { prisma, users, at, daysAgo } = ctx;
  const cnhu = await prisma.facility.findFirst({ where: { shortName: 'CNHU-HKM' }, select: { id: true, shortName: true, name: true } });
  if (!cnhu || !users.koffi || !users.houngbedji) return;
  const place = cnhu.shortName ?? cnhu.name;

  const patientOf = async (key: string) => (users[key] ? prisma.patient.findUnique({ where: { userId: users[key].id }, select: { id: true } }) : null);
  const [koffi, serge, afiavi, bio] = await Promise.all(['koffi', 'serge', 'afiavi', 'bio'].map(patientOf));
  if (!koffi) return;
  const demoPatients = [koffi, serge, afiavi, bio].filter((p): p is { id: string } => Boolean(p)).map((p) => p.id);

  // Nettoyage : rendez-vous de démonstration, leurs rappels, et l'ancien rappel de consultation de Koffi sans rendez-vous.
  const old = await prisma.appointment.findMany({ where: { OR: [{ facilityId: cnhu.id }, { patientId: { in: demoPatients } }] }, select: { id: true } });
  await prisma.reminder.deleteMany({ where: { appointmentId: { in: old.map((a) => a.id) } } });
  await prisma.appointment.deleteMany({ where: { id: { in: old.map((a) => a.id) } } });
  await prisma.reminder.deleteMany({ where: { patientId: koffi.id, kind: 'APPOINTMENT', appointmentId: null, title: 'Consultation hématologie' } });
  await prisma.notification.deleteMany({ where: { kind: 'RDV', userId: { in: Object.values(users).map((u) => u.id) } } });

  // Afiavi gère aussi les rendez-vous de son fils.
  const delegation = await prisma.delegation.findFirst({ where: { patientId: koffi.id, caregiverId: users.afiavi?.id } });
  if (delegation && !delegation.scopes.includes('appointments')) {
    await prisma.delegation.update({ where: { id: delegation.id }, data: { scopes: [...delegation.scopes, 'appointments'] } });
  }

  const drName = 'Dr Houngbédji';
  const confirmed = await prisma.appointment.create({
    data: {
      patientId: koffi.id,
      facilityId: cnhu.id,
      facilityName: place,
      specialty: 'HEMATOLOGIE',
      reason: 'Contrôle du traitement',
      preferredAt: at(3, 9),
      scheduledAt: at(3, 10),
      status: 'CONFIRME',
      answer: 'Passez d’abord au laboratoire pour la prise de sang de 8 h.',
      answeredById: users.houngbedji.id,
      answeredByName: drName,
      createdById: users.koffi.id,
      createdAt: daysAgo(4, 18),
    },
  });
  await prisma.reminder.create({
    data: { patientId: koffi.id, kind: 'APPOINTMENT', title: 'Consultation hématologie', place, dueAt: at(3, 10), channels: ['SMS', 'APP'], appointmentId: confirmed.id },
  });
  await prisma.appointment.create({
    data: {
      patientId: koffi.id,
      facilityId: cnhu.id,
      facilityName: place,
      specialty: 'HEMATOLOGIE',
      preferredAt: daysAgo(34, 9),
      scheduledAt: daysAgo(33, 10),
      status: 'FAIT',
      answeredById: users.houngbedji.id,
      answeredByName: drName,
      createdById: users.koffi.id,
      createdAt: daysAgo(40, 11),
    },
  });

  const pending = [
    { p: serge, by: 'serge', specialty: 'GENERALE', reason: 'Fatigue et maux de tête depuis deux semaines', preferredAt: at(2, 9), createdAt: daysAgo(0, 7) },
    { p: afiavi, by: 'afiavi', specialty: 'GENERALE', reason: 'Contrôle de la tension', preferredAt: at(4, 15), createdAt: daysAgo(1, 16) },
    { p: bio, by: 'bio', specialty: 'HEMATOLOGIE', reason: 'Avis demandé par le CHD Atacora', preferredAt: at(6, 9), createdAt: daysAgo(1, 10) },
  ];
  for (const r of pending) {
    if (!r.p || !users[r.by]) continue;
    await prisma.appointment.create({
      data: {
        patientId: r.p.id,
        facilityId: cnhu.id,
        facilityName: place,
        specialty: r.specialty,
        reason: r.reason,
        preferredAt: r.preferredAt,
        createdById: users[r.by].id,
        createdAt: r.createdAt,
      },
    });
  }

  // Cloche : le Dr Houngbédji a trois demandes à traiter, Koffi a reçu sa confirmation.
  await prisma.notification.createMany({
    data: [
      { userId: users.houngbedji.id, kind: 'RDV', title: 'Nouvelle demande de rendez-vous', body: 'Serge D. · consultation · dans 2 jours, le matin', href: '/pro/rendez-vous', createdAt: daysAgo(0, 7) },
      { userId: users.houngbedji.id, kind: 'RDV', title: 'Nouvelle demande de rendez-vous', body: 'Afiavi A. · consultation · dans 4 jours, l’après-midi', href: '/pro/rendez-vous', createdAt: daysAgo(1, 16) },
      { userId: users.houngbedji.id, kind: 'RDV', title: 'Nouvelle demande de rendez-vous', body: 'Bio O. · hématologie · dans 6 jours, le matin', href: '/pro/rendez-vous', createdAt: daysAgo(1, 10) },
      { userId: users.koffi.id, kind: 'RDV', title: 'Rendez-vous confirmé', body: `${place} · dans 3 jours à 10 h`, href: '/app/rendez-vous', createdAt: daysAgo(3, 9), readAt: daysAgo(3, 12) },
    ],
  });
}
