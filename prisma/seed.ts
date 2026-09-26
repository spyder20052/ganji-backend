/**
 * Jeu de données Ganji.
 * Règle : tout ce qui est public est réel (départements, communes, établissements,
 * médicaments essentiels, calendrier vaccinal) ; tout ce qui est personnel est fictif.
 *
 * Usage : `tsx prisma/seed.ts` (réinitialise la démo) ou `tsx prisma/seed.ts --if-empty`.
 */
import { Prisma, PrismaClient, Role, Lang } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CryptoService } from '../src/common/crypto.service';
import { loadDotEnv } from '../src/common/env';
import { COMMUNES, DEPARTMENTS } from '../src/data/geo';
import { FACILITIES } from '../src/data/facilities';
import { MEDICATIONS } from '../src/data/medications';
import { ANC_SCHEDULE, VACCINE_SCHEDULE } from '../src/data/vaccines';
import { prescriptionSignedString } from '../src/medications/medications.service';

import { seedExtensions } from './seed-ext';

/** Persona créée par la version actuelle des données de démo : sa présence signifie « base à jour ». */
const SEED_MARK = 'ecoutante';

const prisma = new PrismaClient();
loadDotEnv();
const crypto = new CryptoService();

// ─── Aléatoire déterministe (mulberry32) : la démo est identique à chaque seed ───
let seed = 2026;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
const between = (a: number, b: number) => a + rand() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const DAY = 86_400_000;
const daysAgo = (d: number, h = 9) => {
  const x = new Date(Date.now() - d * DAY);
  x.setUTCHours(h - 1, int(0, 59), 0, 0);
  return x;
};
const inDays = (d: number, h = 9) => daysAgo(-d, h);
/** Rendez-vous à heure ronde (heure de Cotonou) : « 9 h », pas « 9 h 01 ». */
const at = (d: number, h: number, m = 0) => {
  const x = new Date(Date.now() + d * DAY);
  x.setUTCHours(h - 1, m, 0, 0);
  return x;
};

/** Fréquences ABO/Rh plausibles en Afrique de l'Ouest (approximation pour la démo). */
const BLOOD_FREQ: [string, number][] = [
  ['O+', 0.49], ['A+', 0.22], ['B+', 0.21], ['AB+', 0.04], ['O-', 0.02], ['A-', 0.01], ['B-', 0.008], ['AB-', 0.002],
];
function bloodGroup() {
  let r = rand();
  for (const [g, f] of BLOOD_FREQ) {
    if ((r -= f) <= 0) return g;
  }
  return 'O+';
}

const FIRST_F = ['Afiavi', 'Rafiatou', 'Rachidatou', 'Marcelline', 'Chimène', 'Nafissatou', 'Sèna', 'Houéfa', 'Aïcha', 'Bernadette', 'Fifamè', 'Mariam', 'Gisèle', 'Adjoa', 'Sika', 'Rosine', 'Mahougnon', 'Zénabou', 'Clémence', 'Yétondé', 'Akouavi', 'Fatouma', 'Nadège', 'Olga'];
const FIRST_M = ['Koffi', 'Serge', 'Mathieu', 'Junior', 'Rodrigue', 'Sèdjro', 'Kossi', 'Adébayo', 'Idrissou', 'Moussa', 'Gildas', 'Romaric', 'Honoré', 'Bio', 'Sourou', 'Codjo', 'Mahugnon', 'Arouna', 'Ulrich', 'Fiacre', 'Bachirou', 'Ignace', 'Landry', 'Yacoubou'];
// Prénoms réservés aux personas : aucun donneur ni patient secondaire ne les porte, sinon
// « Koffi » apparaîtrait parmi les donneurs alertés pour sa propre demande.
const PERSONA_NAMES = new Set(['Koffi', 'Afiavi', 'Bio', 'Rafiatou', 'Rachidatou', 'Serge', 'Mathieu', 'Rodrigue', 'Marcelline', 'Junior', 'Aïcha']);
const CROWD_F = FIRST_F.filter((n) => !PERSONA_NAMES.has(n));
const CROWD_M = FIRST_M.filter((n) => !PERSONA_NAMES.has(n));
const LAST = ['Houngbédji', 'Agossou', 'Dossou', 'Adjovi', 'Hounkpatin', 'Kiki', 'Gbaguidi', 'Zinsou', 'Ahouansou', 'Sagbo', 'Tossou', 'Akpovi', 'Chabi', 'Bio Sika', 'Orou', 'Yessoufou', 'Salifou', 'Adékambi', 'Ogoubiyi', 'Soglo', 'Dansou', 'Assogba', 'Lawani', 'Boni', 'Gounou', 'Worou', 'Toko', 'Idohou', 'Kpadonou', 'Amoussou'];

function npi() {
  return `${int(1, 9)}${Array.from({ length: 9 }, () => int(0, 9)).join('')}`;
}

// ─── Personas de démonstration (NPI et numéros fictifs) ───
interface Persona {
  persona: string;
  role: Role;
  name: string;
  phone: string;
  lang?: Lang;
  simpleMode?: boolean;
  npi?: string;
}
const P: Record<string, Persona> = {
  koffi: { persona: 'koffi', role: 'PATIENT', name: 'Koffi Agossou', phone: '0190000001', npi: '1034567201' },
  afiavi: { persona: 'afiavi', role: 'CAREGIVER', name: 'Afiavi Agossou', phone: '0190000002', lang: 'fon', simpleMode: true, npi: '1034567202' },
  bio: { persona: 'bio', role: 'PATIENT', name: 'Bio Orou', phone: '0190000003', lang: 'bariba', simpleMode: true, npi: '1034567203' },
  houngbedji: { persona: 'houngbedji', role: 'PRACTITIONER', name: 'Dr Houngbédji', phone: '0190000010' },
  agossou: { persona: 'dr-sans-consentement', role: 'PRACTITIONER', name: 'Dr Dansou', phone: '0190000011' },
  rachidatou: { persona: 'rachidatou', role: 'NURSE', name: 'Rachidatou Salifou', phone: '0190000012' },
  pharmaParakou: { persona: 'pharmacie-parakou', role: 'PHARMACIST', name: 'Dr Chabi (pharmacie)', phone: '0190000020' },
  pharmaCotonou: { persona: 'pharmacie-cotonou', role: 'PHARMACIST', name: 'Dr Zinsou (pharmacie)', phone: '0190000021' },
  ants: { persona: 'ants', role: 'BLOOD_BANK', name: 'ANTS · site de Cotonou', phone: '0190000030' },
  ministere: { persona: 'ministere', role: 'MINISTRY', name: 'Direction de la santé publique', phone: '0190000040' },
  mathieu: { persona: 'mathieu', role: 'RELAY', name: 'Mathieu Gounou (relais)', phone: '0190000050' },
  rafiatou: { persona: 'rafiatou', role: 'PATIENT', name: 'Rafiatou Yessoufou', phone: '0190000060', lang: 'bariba', npi: '1034567260' },
  serge: { persona: 'serge', role: 'PATIENT', name: 'Serge Dossou', phone: '0190000070', npi: '1034567270' },
  admin: { persona: 'controleur', role: 'ADMIN', name: 'Contrôleur des accès', phone: '0190000090' },
};

async function reset() {
  // Le journal d'audit est protégé en ajout seul : on désactive le trigger le temps du reset de démo.
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" DISABLE TRIGGER USER').catch(() => undefined);
  const tables = [
    'Notification', 'Appointment', 'Order', 'ListenMessage', 'ListenThread', 'Coverage', 'CareTariff', 'Payment', 'DoseLog', 'RelayVisit',
    'Inbound', 'Outbox', 'HealthAlertCommune', 'HealthAlert', 'CommunityReport', 'Immunization', 'AncVisit', 'Pregnancy',
    'TeleExpertise', 'Prescription', 'PharmacyStock', 'DonorAlert', 'Donor', 'BloodRequest', 'BloodStock', 'SymptomLog',
    'Reminder', 'CarePlan', 'DocumentRef', 'Observation', 'Encounter', 'Condition', 'AuditEvent', 'Consent', 'CareTeamMember',
    'Practitioner', 'Delegation', 'Patient', 'OtpCode', 'User', 'Medication', 'Facility', 'Commune', 'Department',
  ];
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`);
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditEvent" ENABLE TRIGGER USER').catch(() => undefined);
}

async function main() {
  // DEMO_RESET=true (variable posée le temps d'un déploiement) : remet la démo à l'état initial.
  // Base déjà initialisée avec le jeu de données actuel (repère : la persona ajoutée par la dernière version
  // des données, l'écoutante) : rien à faire. Base d'une version antérieure : on la remet à jour.
  if (process.argv.includes('--if-empty') && process.env.DEMO_RESET !== 'true' && (await prisma.department.count()) > 0) {
    if (await prisma.user.findUnique({ where: { demoPersona: SEED_MARK } })) {
      console.log('Base déjà initialisée : seed ignoré.');
      return;
    }
    console.log('Jeu de données d’une version antérieure : réinitialisation de la démo.');
  }
  console.time('seed');
  await reset();

  // ─── 1. Référentiels réels ───
  await prisma.department.createMany({
    data: DEPARTMENTS.map((d) => ({ code: d.code, name: d.name, chefLieu: d.chefLieu, lat: d.lat, lng: d.lng, population: d.population2013 })),
  });
  await prisma.commune.createMany({ data: COMMUNES.map((c) => ({ name: c.name, departmentCode: c.department, lat: c.lat, lng: c.lng })) });
  const communes = await prisma.commune.findMany();
  const communeId = (name: string) => communes.find((c) => c.name === name)!.id;
  const communeByName = (name: string) => communes.find((c) => c.name === name)!;

  let pharmacyIndex = 0;
  await prisma.facility.createMany({
    data: FACILITIES.map((f) => ({
      name: f.name,
      shortName: f.shortName,
      type: f.type,
      communeId: communeId(f.commune),
      lat: f.lat,
      lng: f.lng,
      services: f.services,
      open24h: f.open24h,
      // Pharmacies de garde simulées : environ une sur trois.
      onDuty: f.type === 'PHARMACIE' ? pharmacyIndex++ % 3 === 0 : false,
    })),
  });
  const facilities = await prisma.facility.findMany();
  const fac = (shortOrName: string) => facilities.find((f) => f.shortName === shortOrName || f.name === shortOrName)!;

  await prisma.medication.createMany({
    data: MEDICATIONS.map((m) => ({ dci: m.dci, form: m.form, strength: m.strength, atc: m.atc, category: m.category, priceFcfa: m.indicativePriceFcfa, chronic: m.chronic ?? false })),
  });
  const meds = await prisma.medication.findMany();
  const med = (dci: string) => meds.find((m) => m.dci.startsWith(dci))!;

  // ─── 2. Stocks fictifs : pharmacies et sang ───
  const pharmacies = facilities.filter((f) => f.type === 'PHARMACIE');
  const stock: Prisma.PharmacyStockCreateManyInput[] = [];
  for (const ph of pharmacies) {
    for (const m of meds) {
      if (rand() < 0.35) continue; // non référencé
      let qty = int(0, 60);
      if (rand() < 0.12) qty = 0; // rupture
      if (m.dci.startsWith('Imatinib')) qty = ['Pharmacie Camp Guézo', 'Pharmacie du marché Arzèkè (Parakou)', 'Pharmacie Jonquet'].includes(ph.name) ? int(4, 12) : 0;
      if (m.dci.startsWith('Hydroxyurée')) qty = rand() < 0.4 ? int(2, 20) : 0;
      stock.push({ pharmacyId: ph.id, medicationId: m.id, quantity: qty, priceFcfa: m.priceFcfa ? Math.round((m.priceFcfa * between(0.95, 1.15)) / 25) * 25 : null });
    }
  }
  await prisma.pharmacyStock.createMany({ data: stock });

  const sites = facilities.filter((f) => f.type === 'TRANSFUSION');
  const bloodStock: Prisma.BloodStockCreateManyInput[] = [];
  for (const s of sites) {
    for (const product of ['CGR', 'PLAQUETTES', 'PLASMA']) {
      for (const [g, f] of BLOOD_FREQ) {
        const base = product === 'CGR' ? 120 : product === 'PLAQUETTES' ? 14 : 40;
        let units = Math.round(base * f * between(0.3, 1.4) * (s.shortName === 'ANTS' ? 2 : 1));
        // Parcours héros : plaquettes O+ / O- en tension dans le Sud. Une seule poche compatible
        // à moins de 60 km du CNHU-HKM, alors que la demande par défaut en réclame 2 : les donneurs
        // sont alertés.
        if (product === 'PLAQUETTES' && ['O+', 'O-'].includes(g) && ['ANTS', 'SDTS Atlantique-Littoral', 'SDTS Ouémé-Plateau'].includes(s.shortName ?? '')) {
          units = g === 'O+' && s.shortName === 'SDTS Atlantique-Littoral' ? 1 : 0;
        }
        bloodStock.push({ siteId: s.id, product, bloodGroup: g, units });
      }
    }
  }
  await prisma.bloodStock.createMany({ data: bloodStock });

  // ─── 3. Personas ───
  const users: Record<string, { id: string }> = {};
  for (const [key, p] of Object.entries(P)) {
    users[key] = await prisma.user.create({
      data: {
        role: p.role,
        displayName: p.name,
        phone: p.phone,
        lang: p.lang ?? 'fr',
        simpleMode: p.simpleMode ?? false,
        demoPersona: p.persona,
        npiHash: p.npi ? crypto.hashNpi(p.npi) : null,
        npiLast4: p.npi ? p.npi.slice(-4) : null,
      },
    });
  }
  const prac = async (userKey: string, title: string, specialty: string, facility: string, verified = true) =>
    prisma.practitioner.create({ data: { userId: users[userKey].id, title, specialty, facilityId: fac(facility).id, orderNumber: `ONMB-${int(1000, 9999)}`, verifiedAt: verified ? daysAgo(200) : null } });
  const drH = await prac('houngbedji', 'Dr', 'HEMATOLOGIE', 'CNHU-HKM');
  await prac('agossou', 'Dr', 'MEDECINE_INTERNE', 'HZ Suru-Léré');
  const rachi = await prac('rachidatou', 'Inf.', 'SOINS_INFIRMIERS', 'CSC Djougou');
  await prac('pharmaParakou', 'Pharm.', 'PHARMACIE', 'Pharmacie du marché Arzèkè (Parakou)');
  await prac('pharmaCotonou', 'Pharm.', 'PHARMACIE', 'Pharmacie Camp Guézo');
  await prac('ants', '', 'TRANSFUSION', 'ANTS');
  void rachi;

  // 30 soignants répartis sur les 12 départements, dont 3 hématologues au total.
  const hospitals = facilities.filter((f) => ['CHU', 'CHD', 'HZ', 'CONFESSIONNEL', 'CS'].includes(f.type));
  const specialties = ['MEDECINE_INTERNE', 'PEDIATRIE', 'GYNECOLOGIE', 'CARDIOLOGIE', 'SOINS_INFIRMIERS', 'SAGE_FEMME', 'ONCOLOGIE', 'DERMATOLOGIE'];
  const deptsCovered = new Set<string>();
  for (let i = 0; i < 26; i++) {
    const dept = DEPARTMENTS[i % 12].code;
    deptsCovered.add(dept);
    const inDept = hospitals.filter((h) => communes.find((c) => c.id === h.communeId)?.departmentCode === dept);
    const site = inDept.length ? pick(inDept) : pick(hospitals);
    const female = rand() < 0.5;
    const u = await prisma.user.create({
      data: { role: i % 4 === 0 ? 'NURSE' : 'PRACTITIONER', displayName: `Dr ${pick(LAST)}`, phone: `01910${String(i).padStart(5, '0')}` },
    });
    await prisma.practitioner.create({
      data: { userId: u.id, title: female ? 'Dr' : 'Dr', specialty: i < 2 ? 'HEMATOLOGIE' : pick(specialties), facilityId: site.id, verifiedAt: daysAgo(int(30, 900)) },
    });
  }

  // ─── 4. Koffi : 12 mois d'historique complet (leucémie myéloïde chronique) ───
  const koffi = await prisma.patient.create({
    data: {
      userId: users.koffi.id,
      firstName: 'Koffi',
      lastName: 'Agossou',
      birthDate: new Date('1992-03-14'),
      sex: 'M',
      bloodGroup: 'O+',
      allergies: ['Pénicilline'],
      treatmentsEnc: crypto.encrypt('Imatinib 400 mg, 1 comprimé par jour · Allopurinol 300 mg · Acide folique 5 mg'),
      emergencyName: 'Afiavi Agossou (mère)',
      emergencyPhone: P.afiavi.phone,
      communeId: communeId('Abomey-Calavi'),
    },
  });
  await prisma.condition.create({ data: { patientId: koffi.id, code: 'C92.1', labelEnc: crypto.encrypt('Leucémie myéloïde chronique')!, onsetAt: daysAgo(420) } });
  await prisma.condition.create({ data: { patientId: koffi.id, code: 'Z21', labelEnc: crypto.encrypt('Suivi psychologique (compartiment sensible)')!, sensitive: true, onsetAt: daysAgo(300) } });
  await prisma.careTeamMember.create({ data: { patientId: koffi.id, practitionerId: drH.id, role: 'Hématologue référent' } });
  await prisma.delegation.create({ data: { patientId: koffi.id, caregiverId: users.afiavi.id, relation: 'mère', scopes: ['summary', 'reminders', 'blood'] } });

  const encounters: Prisma.EncounterCreateManyInput[] = [];
  for (let m = 12; m >= 1; m--) {
    encounters.push({
      patientId: koffi.id,
      type: 'CONSULTATION',
      date: daysAgo(m * 30 + int(0, 4), 10),
      facilityName: 'CNHU-HKM',
      authorName: 'Dr Houngbédji',
      summaryEnc: crypto.encrypt(m > 8 ? 'Suivi hématologique. Tolérance correcte de l’imatinib. Poursuite du traitement.' : 'Contrôle NFS. Fatigue signalée, plaquettes en baisse. Surveillance rapprochée.'),
    });
  }
  encounters.push({ patientId: koffi.id, type: 'HOSPITALISATION', date: daysAgo(210), facilityName: 'CNHU-HKM', authorName: 'Dr Houngbédji', summaryEnc: crypto.encrypt('Hospitalisation 4 jours : infection, antibiothérapie IV. Sortie avec traitement oral.') });
  for (const d of [205, 95, 33]) {
    encounters.push({ patientId: koffi.id, type: 'TRANSFUSION', date: daysAgo(d), facilityName: 'CNHU-HKM', authorName: 'Service de transfusion', summaryEnc: crypto.encrypt('Transfusion de 2 poches, bonne tolérance.') });
  }
  await prisma.encounter.createMany({ data: encounters });

  const obs: Prisma.ObservationCreateManyInput[] = [];
  for (let m = 12; m >= 0; m--) {
    const date = daysAgo(m * 30 + 1, 8);
    const trend = m / 12; // les plaquettes baissent sur l'année
    obs.push({ patientId: koffi.id, code: 'HB', label: 'Hémoglobine', unit: 'g/dL', refLow: 13, refHigh: 17, value: +(between(9.2, 11.8) - (1 - trend) * 1.2).toFixed(1), date, source: 'Laboratoire CNHU-HKM' });
    obs.push({ patientId: koffi.id, code: 'PLT', label: 'Plaquettes', unit: 'G/L', refLow: 150, refHigh: 400, value: Math.round(between(110, 170) * (0.35 + 0.65 * trend)), date, source: 'Laboratoire CNHU-HKM' });
    obs.push({ patientId: koffi.id, code: 'WBC', label: 'Globules blancs', unit: 'G/L', refLow: 4, refHigh: 10, value: +between(3.2, 9.5).toFixed(1), date, source: 'Laboratoire CNHU-HKM' });
  }
  await prisma.observation.createMany({ data: obs });

  await prisma.carePlan.create({
    data: {
      patientId: koffi.id,
      title: 'Leucémie myéloïde chronique : traitement ciblé',
      protocol: 'Imatinib 400 mg/j, NFS mensuelle, réponse moléculaire tous les 3 mois',
      goals: ['Réponse hématologique complète', 'Plaquettes > 100 G/L', 'Aucune interruption de traitement'],
      steps: [
        { label: 'NFS de contrôle', dueAt: inDays(3), done: false },
        { label: 'Consultation hématologie', dueAt: inDays(6), done: false },
        { label: 'Bilan moléculaire BCR-ABL (envoi du prélèvement)', dueAt: inDays(40), done: false },
      ],
    },
  });
  await prisma.reminder.createMany({
    data: [
      { patientId: koffi.id, kind: 'MEDICATION', title: 'Prise du traitement du soir', dueAt: at(0.4, 20), channels: ['APP', 'SMS'] },
      { patientId: koffi.id, kind: 'LAB', title: 'Prise de sang (NFS)', place: 'Laboratoire CNHU-HKM', dueAt: at(3, 8), channels: ['APP', 'SMS'] },
      { patientId: koffi.id, kind: 'APPOINTMENT', title: 'Consultation hématologie', place: 'CNHU-HKM, Cotonou', dueAt: at(6, 10), channels: ['APP', 'SMS', 'VOICE'] },
    ],
  });
  await prisma.symptomLog.createMany({
    data: [
      { patientId: koffi.id, symptom: 'fatigue', severity: 2, at: daysAgo(6) },
      { patientId: koffi.id, symptom: 'bruise', severity: 1, at: daysAgo(3) },
    ],
  });
  const rxItems = [
    { medicationId: med('Imatinib').id, dci: med('Imatinib').dci, form: med('Imatinib').form, strength: med('Imatinib').strength, dosage: '1 comprimé par jour, au cours du repas', duration: '30 jours', quantity: 1 },
    { medicationId: med('Allopurinol').id, dci: med('Allopurinol').dci, form: med('Allopurinol').form, strength: med('Allopurinol').strength, dosage: '1 comprimé le matin', duration: '30 jours', quantity: 1 },
  ];
  const rxId = randomUUID();
  await prisma.prescription.create({
    data: {
      id: rxId,
      patientId: koffi.id,
      prescriberId: users.houngbedji.id,
      prescriberName: 'Dr Houngbédji (CNHU-HKM)',
      items: rxItems,
      signature: crypto.sign(prescriptionSignedString(rxId, koffi.id, rxItems)),
      issuedAt: daysAgo(1, 11),
      expiresAt: inDays(29),
    },
  });
  // Journal d'accès historique : ce que Koffi voit dans « qui a consulté mon carnet ».
  await prisma.auditEvent.createMany({
    data: [
      { at: daysAgo(30, 10), actorId: users.houngbedji.id, actorName: 'Dr Houngbédji', actorRole: 'PRACTITIONER', patientId: koffi.id, action: 'READ', resource: "Résultats d'analyses", reason: 'via CARE_TEAM' },
      { at: daysAgo(30, 10), actorId: users.houngbedji.id, actorName: 'Dr Houngbédji', actorRole: 'PRACTITIONER', patientId: koffi.id, action: 'WRITE', resource: 'Compte rendu' },
      { at: daysAgo(12, 15), actorId: users.afiavi.id, actorName: 'Afiavi Agossou', actorRole: 'CAREGIVER', patientId: koffi.id, action: 'READ', resource: 'Fiche vitale', reason: 'via DELEGATION' },
    ],
  });

  // ─── 5. Bio : diabétique à Natitingou, téléphone simple ───
  const bio = await prisma.patient.create({
    data: {
      userId: users.bio.id, firstName: 'Bio', lastName: 'Orou', birthDate: new Date('1965-06-02'), sex: 'M', bloodGroup: 'B+', allergies: [],
      treatmentsEnc: crypto.encrypt('Metformine 850 mg matin et soir · Glibenclamide 5 mg'), emergencyName: 'Idrissou Orou (fils)', emergencyPhone: '0190000004',
      communeId: communeId('Natitingou'),
    },
  });
  await prisma.condition.create({ data: { patientId: bio.id, code: 'E11', labelEnc: crypto.encrypt('Diabète de type 2')!, onsetAt: daysAgo(2200) } });
  await prisma.observation.createMany({
    data: Array.from({ length: 8 }, (_, i) => ({ patientId: bio.id, code: 'GLY', label: 'Glycémie à jeun', unit: 'g/L', refLow: 0.7, refHigh: 1.1, value: +between(1.05, 1.8).toFixed(2), date: daysAgo(i * 45 + 2, 7), source: 'CHD Atacora' })),
  });
  await prisma.reminder.createMany({
    data: [
      { patientId: bio.id, kind: 'MEDICATION', title: 'Traitement du matin', dueAt: at(0.6, 7), channels: ['SMS', 'VOICE'] },
      { patientId: bio.id, kind: 'APPOINTMENT', title: 'Consultation diabète', place: 'CHD Atacora, Natitingou', dueAt: at(9, 9), channels: ['SMS', 'VOICE'] },
    ],
  });

  // ─── 6. Rafiatou : 1re grossesse à Kandi, rappels en bariba ───
  const rafi = await prisma.patient.create({
    data: {
      userId: users.rafiatou.id, firstName: 'Rafiatou', lastName: 'Yessoufou', birthDate: new Date('2003-01-20'), sex: 'F', bloodGroup: 'A+', allergies: [],
      emergencyName: 'Arouna Yessoufou (mari)', emergencyPhone: '0190000061', communeId: communeId('Kandi'),
    },
  });
  // 31 SA + 6 j : la 3e CPN du protocole national (32 SA) tombe demain, comme son rappel.
  const lmp = daysAgo(32 * 7 - 1);
  const pregnancy = await prisma.pregnancy.create({
    data: { patientId: rafi.id, lmp, edd: new Date(lmp.getTime() + 280 * DAY), maternity: 'HZ Kandi' },
  });
  for (const v of ANC_SCHEDULE) {
    const dueFrom = new Date(lmp.getTime() + v.weekFrom * 7 * DAY);
    const dueTo = new Date(lmp.getTime() + v.weekTo * 7 * DAY);
    const done = v.code === 'CPN1' ? daysAgo(20 * 7) : v.code === 'CPN2' ? daysAgo(6 * 7) : null;
    await prisma.ancVisit.create({ data: { pregnancyId: pregnancy.id, code: v.code, dueFrom, dueTo, doneAt: done, place: done ? 'HZ Kandi' : null } });
  }
  await prisma.reminder.create({
    data: { patientId: rafi.id, kind: 'CPN', title: '3e consultation prénatale', place: 'Hôpital de zone de Kandi', dueAt: at(1, 9), channels: ['SMS', 'VOICE'] },
  });

  // ─── 7. Serge : père de jumeaux à Porto-Novo, carnet de vaccination ───
  const serge = await prisma.patient.create({
    data: { userId: users.serge.id, firstName: 'Serge', lastName: 'Dossou', birthDate: new Date('1988-09-09'), sex: 'M', bloodGroup: 'O+', allergies: [], communeId: communeId('Porto-Novo'), emergencyName: 'Chimène Dossou (épouse)', emergencyPhone: '0190000071' },
  });
  // 10 semaines moins un jour : les vaccins de 10 semaines sont dus demain, comme le rappel.
  const twinsBirth = daysAgo(10 * 7 - 1);
  for (const name of ['Kenny', 'Kelly']) {
    const child = await prisma.patient.create({
      data: { firstName: name, lastName: 'Dossou', birthDate: twinsBirth, sex: name === 'Kenny' ? 'M' : 'F', bloodGroup: null, allergies: [], communeId: communeId('Porto-Novo'), parentId: serge.id },
    });
    await prisma.immunization.createMany({
      data: VACCINE_SCHEDULE.map((v) => {
        const dueAt = new Date(twinsBirth.getTime() + v.ageDays * DAY);
        const given = v.ageDays <= 42 ? new Date(dueAt.getTime() + int(0, 3) * DAY) : null;
        return { patientId: child.id, vaccineCode: v.code, vaccineName: v.name, dose: v.dose, dueAt, givenAt: given, place: given ? 'CHUD-OP, Porto-Novo' : null, lot: given ? `LOT-${int(10000, 99999)}` : null };
      }),
    });
    await prisma.observation.createMany({
      data: [0, 42].map((d) => ({ patientId: child.id, code: 'WEIGHT', label: 'Poids', unit: 'kg', value: +(2.6 + d * 0.028 + between(-0.1, 0.1)).toFixed(2), date: new Date(twinsBirth.getTime() + d * DAY), source: 'CHUD-OP' })),
    });
  }
  await prisma.reminder.create({
    data: { patientId: serge.id, kind: 'VACCINE', title: 'Vaccins de 10 semaines des jumeaux', place: 'CHUD Ouémé-Plateau', dueAt: at(1, 8, 30), channels: ['APP', 'SMS', 'VOICE'] },
  });

  // ─── 8. Relais et Mathieu (Djougou) : lien patient pour rattacher le relais à sa commune ───
  await prisma.patient.create({ data: { userId: users.mathieu.id, firstName: 'Mathieu', lastName: 'Gounou', birthDate: new Date('1984-02-11'), sex: 'M', allergies: [], communeId: communeId('Djougou') } });
  await prisma.patient.create({ data: { userId: users.afiavi.id, firstName: 'Afiavi', lastName: 'Agossou', birthDate: new Date('1974-05-30'), sex: 'F', bloodGroup: 'O+', allergies: [], communeId: communeId('Abomey-Calavi') } });

  // ─── 9. 200 patients secondaires ───
  const weighted = ['Cotonou', 'Cotonou', 'Abomey-Calavi', 'Abomey-Calavi', 'Porto-Novo', 'Parakou', 'Parakou', 'Djougou', 'Bohicon', 'Natitingou', 'Kandi', 'Lokossa', 'Ouidah', 'Savè', 'Pobè', 'Aplahoué', 'Malanville', 'Dassa-Zoumè', 'Sèmè-Kpodji', 'Abomey'];
  const chronic = [
    { code: 'D57', label: 'Drépanocytose', sensitive: false },
    { code: 'E11', label: 'Diabète de type 2', sensitive: false },
    { code: 'I10', label: 'Hypertension artérielle', sensitive: false },
    { code: 'B24', label: 'Infection à VIH', sensitive: true },
    { code: 'C50', label: 'Cancer du sein', sensitive: false },
  ];
  for (let i = 0; i < 200; i++) {
    const female = rand() < 0.52;
    const p = await prisma.patient.create({
      data: {
        firstName: pick(female ? CROWD_F : CROWD_M),
        lastName: pick(LAST),
        birthDate: daysAgo(int(1, 80) * 365 + int(0, 364)),
        sex: female ? 'F' : 'M',
        bloodGroup: bloodGroup(),
        allergies: rand() < 0.1 ? [pick(['Pénicilline', 'Sulfamides', 'Arachide', 'Aspirine'])] : [],
        communeId: communeId(rand() < 0.7 ? pick(weighted) : pick(COMMUNES).name),
        provisionalId: rand() < 0.05 ? `ALF-${int(100000, 999999)}` : null,
      },
    });
    if (rand() < 0.45) {
      const c = pick(chronic);
      await prisma.condition.create({ data: { patientId: p.id, code: c.code, labelEnc: crypto.encrypt(c.label)!, sensitive: c.sensitive, onsetAt: daysAgo(int(60, 3000)) } });
    }
  }
  void npi;

  // ─── 10. 500 donneurs autour de Cotonou, Porto-Novo et Parakou ───
  const donorCities = [
    { city: 'Cotonou', c: communeByName('Cotonou'), n: 230, r: 0.06 },
    { city: 'Abomey-Calavi', c: communeByName('Abomey-Calavi'), n: 110, r: 0.07 },
    { city: 'Porto-Novo', c: communeByName('Porto-Novo'), n: 80, r: 0.05 },
    { city: 'Parakou', c: communeByName('Parakou'), n: 80, r: 0.05 },
  ];
  const donors: Prisma.DonorCreateManyInput[] = [];
  let dn = 0;
  for (const dc of donorCities) {
    for (let i = 0; i < dc.n; i++) {
      const female = rand() < 0.35;
      const smart = rand() < 0.6;
      const recent = rand() < 0.3;
      donors.push({
        firstName: pick(female ? CROWD_F : CROWD_M),
        phone: `0196${String(++dn).padStart(6, '0')}`,
        bloodGroup: bloodGroup(),
        sex: female ? 'F' : 'M',
        lat: dc.c.lat + between(-dc.r, dc.r),
        lng: dc.c.lng + between(-dc.r, dc.r),
        city: dc.city,
        lastDonationAt: recent ? daysAgo(int(10, 50)) : rand() < 0.5 ? daysAgo(int(90, 400)) : null,
        available: rand() < 0.92,
        hasSmartphone: smart,
        lang: smart ? 'fr' : pick(['fr', 'fon', 'fon', 'yoruba'] as Lang[]),
        donations: int(0, 14),
      });
    }
  }
  // Donneur de démonstration du parcours héros : téléphone simple, le plus proche du CNHU-HKM.
  donors.unshift({ firstName: 'Rodrigue', phone: '0196000000', bloodGroup: 'O+', sex: 'M', lat: 6.3585, lng: 2.4201, city: 'Cotonou', lastDonationAt: daysAgo(140), available: true, hasSmartphone: false, lang: 'fon', donations: 6 });
  await prisma.donor.createMany({ data: donors });
  // Afiavi est aussi donneuse (O+), mais a donné récemment : elle ne doit pas être sollicitée.
  await prisma.donor.create({ data: { userId: users.afiavi.id, firstName: 'Afiavi', phone: P.afiavi.phone, bloodGroup: 'O+', sex: 'F', lat: 6.45, lng: 2.35, city: 'Abomey-Calavi', lastDonationAt: daysAgo(20), available: true, hasSmartphone: true, lang: 'fon', donations: 3 } });

  // ─── 11. Historique sang (indicateurs du tableau de bord) ───
  const allDonors = await prisma.donor.findMany({ take: 60, where: { city: { in: ['Cotonou', 'Parakou'] } } });
  const secondaries = await prisma.patient.findMany({ where: { userId: null, parentId: null }, take: 12 });
  for (let i = 0; i < 10; i++) {
    const created = daysAgo(int(2, 28), int(7, 20));
    const site = pick([fac('CNHU-HKM'), fac('CHUD-BA'), fac('CHU-MEL (ex-HOMEL)'), fac('CHUD-OP')]);
    const r = await prisma.bloodRequest.create({
      data: { patientId: secondaries[i].id, requesterId: users.houngbedji.id, requesterName: pick(['Dr Houngbédji', 'Dr Kiki', 'Dr Sagbo']), facilityId: site.id, product: pick(['CGR', 'CGR', 'PLAQUETTES']), bloodGroup: secondaries[i].bloodGroup ?? 'O+', quantity: int(1, 3), urgency: pick(['VITALE', 'URGENTE', 'PROGRAMMEE']), neededBy: new Date(created.getTime() + DAY), status: 'SERVIE', createdAt: created },
    });
    const d = allDonors[i * 3];
    await prisma.donorAlert.create({ data: { requestId: r.id, donorId: d.id, distanceKm: +between(2, 18).toFixed(1), channel: 'SMS', status: 'ACCEPTEE', createdAt: created, respondedAt: new Date(created.getTime() + int(18, 170) * 60_000) } });
  }

  // ─── 12. Télé-expertise ───
  const child = await prisma.patient.create({
    data: { firstName: 'Nafissatou', lastName: 'Worou', birthDate: daysAgo(7 * 365), sex: 'F', bloodGroup: 'O+', allergies: [], communeId: communeId('Djougou') },
  });
  await prisma.condition.create({ data: { patientId: child.id, code: 'D57', labelEnc: crypto.encrypt('Drépanocytose SS (suspectée)')!, onsetAt: daysAgo(30) } });
  await prisma.observation.createMany({
    data: [
      { patientId: child.id, code: 'HB', label: 'Hémoglobine', unit: 'g/dL', refLow: 11, refHigh: 14, value: 6.8, date: daysAgo(1), source: 'CSC Djougou' },
      { patientId: child.id, code: 'WBC', label: 'Globules blancs', unit: 'G/L', refLow: 4, refHigh: 12, value: 14.2, date: daysAgo(1), source: 'CSC Djougou' },
    ],
  });
  await prisma.careTeamMember.create({ data: { patientId: child.id, practitionerId: rachi.id, role: 'Infirmière référente' } });
  await prisma.consent.create({ data: { patientId: child.id, granteeId: users.houngbedji.id, granteeName: 'Dr Houngbédji', scopes: ['summary', 'timeline', 'observations', 'documents'], source: 'TEAM', redeemedAt: daysAgo(0.2), expiresAt: inDays(7) } });
  await prisma.teleExpertise.create({
    data: {
      patientId: child.id, requesterId: users.rachidatou.id, requesterName: 'Rachidatou Salifou', requesterSite: 'CSC Djougou', specialty: 'HEMATOLOGIE', urgency: 'URGENTE',
      question: "Fillette de 7 ans, pâleur marquée, douleurs osseuses depuis 3 jours, Hb 6,8 g/dL au labo du centre. Test d'Emmel positif. Faut-il transférer au CHD ou peut-on transfuser ici ? Photos des conjonctives jointes.",
      createdAt: daysAgo(0.2),
    },
  });
  const oldTele = await prisma.patient.findFirst({ where: { userId: null, communeId: communeId('Parakou') } });
  if (oldTele) {
    await prisma.teleExpertise.create({
      data: {
        patientId: oldTele.id, requesterId: users.rachidatou.id, requesterName: 'Rachidatou Salifou', requesterSite: 'CSC Djougou', specialty: 'HEMATOLOGIE', urgency: 'NORMALE', status: 'REPONDUE',
        question: 'Adulte drépanocytaire connu, crises plus fréquentes ces 2 derniers mois. Faut-il débuter l’hydroxyurée ?', createdAt: daysAgo(9), answeredAt: daysAgo(8, 14), answeredById: users.houngbedji.id, answeredByName: 'Dr Houngbédji',
        answer: 'Oui, indication d’hydroxyurée (≥ 3 crises/an). Débuter à 15 mg/kg/j, NFS à 4 semaines. Adresser au CHD Donga pour la première prescription.',
      },
    });
  }

  // ─── 13. Santé publique : alertes et signalements ───
  await prisma.healthAlert.create({
    data: { kind: 'EPIDEMIE', severity: 'ATTENTION', title: 'Saison des pluies : paludisme', message: 'Dormez sous moustiquaire imprégnée. Toute fièvre chez un enfant de moins de 5 ans doit être vue au centre de santé le jour même.', audioKey: 'advice.bednet', expiresAt: inDays(60) },
  });
  await prisma.healthAlert.create({
    data: {
      kind: 'VACCINATION', severity: 'INFO', title: 'Campagne de vaccination contre la rougeole', message: 'Vaccination gratuite des enfants de 9 mois à 5 ans dans tous les centres de santé de l’Alibori, du 1er au 10 octobre.', expiresAt: inDays(20),
      communes: { create: ['Kandi', 'Malanville', 'Banikoara', 'Gogounou', 'Karimama', 'Ségbana'].map((n) => ({ communeId: communeId(n) })) },
    },
  });
  await prisma.communityReport.createMany({
    data: [
      { relayId: users.mathieu.id, relayName: 'Mathieu Gounou (relais)', communeId: communeId('Djougou'), village: 'Kolokondé', syndrome: 'DIARRHEE', cases: 3, createdAt: daysAgo(2, 16) },
      { relayName: 'Relais Barei', communeId: communeId('Djougou'), village: 'Barei', syndrome: 'DIARRHEE', cases: 2, createdAt: daysAgo(1, 11) },
      { relayName: 'Relais Kpébié', communeId: communeId('Parakou'), village: 'Kpébié', syndrome: 'TOUX', cases: 1, createdAt: daysAgo(3, 9) },
    ],
  });

  // ─── 14. Fonctions ajoutées : profil, rendez-vous, sang, commandes, écoute, droits, assistant, cercle ───
  await seedExtensions({ prisma, users, communeId, daysAgo, inDays, at });

  console.timeEnd('seed');
  console.log(`Seed terminé : ${await prisma.facility.count()} établissements, ${await prisma.patient.count()} patients, ${await prisma.donor.count()} donneurs.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
