import { deflateSync } from 'node:zlib';
import type { Lang } from '@prisma/client';
import type { SeedCtx } from './context';

/**
 * Données de démonstration du don de sang et du partage de documents (rejouable :
 * `npx tsx prisma/seed-ext/run.ts blood`). Les donneurs sont mis à jour par numéro, les demandes
 * et documents de démonstration ont des identifiants fixes.
 */

// ─── 40 donneurs éligibles dans tout le pays (repos respecté, 18-60 ans) ───
// [prénom, sexe, groupe, commune, Δlat, Δlng, dernier don (jours) ou null, smartphone, langue, dons]
type Row = [string, 'F' | 'M', string, string, number, number, number | null, boolean, Lang, number];
const DONORS: Row[] = [
  ['Cyrille', 'M', 'O+', 'Cotonou', 0.018, -0.012, 170, true, 'fr', 5],
  ['Nadège', 'F', 'A+', 'Cotonou', -0.021, 0.015, null, true, 'fr', 0],
  ['Hermann', 'M', 'B+', 'Cotonou', 0.025, 0.02, 210, true, 'fr', 8],
  ['Sènami', 'F', 'O+', 'Cotonou', -0.016, -0.022, 160, false, 'fon', 2],
  ['Aristide', 'M', 'O-', 'Cotonou', 0.03, -0.005, 190, true, 'fr', 11],
  ['Mireille', 'F', 'O+', 'Cotonou', -0.028, 0.008, null, false, 'fr', 0],
  ['Parfait', 'M', 'O+', 'Abomey-Calavi', 0.02, 0.01, 175, true, 'fr', 4],
  ['Fifamè', 'F', 'A+', 'Abomey-Calavi', -0.015, 0.02, 240, false, 'fon', 3],
  ['Rufin', 'M', 'B+', 'Abomey-Calavi', 0.01, -0.025, null, true, 'fr', 0],
  ['Carine', 'F', 'O+', 'Abomey-Calavi', -0.025, -0.01, 300, true, 'fr', 6],
  ['Dossa', 'M', 'O+', 'Abomey-Calavi', 0.03, 0.03, 155, false, 'fon', 1],
  ['Adébayo', 'M', 'O+', 'Porto-Novo', 0.012, -0.01, 180, false, 'yoruba', 7],
  ['Folake', 'F', 'B+', 'Porto-Novo', -0.01, 0.015, null, true, 'fr', 0],
  ['Olumidé', 'M', 'A+', 'Porto-Novo', 0.02, 0.02, 220, false, 'yoruba', 2],
  ['Tatiana', 'F', 'O+', 'Porto-Novo', -0.02, -0.015, 165, true, 'fr', 3],
  ['Sourou', 'M', 'O+', 'Ouidah', 0.01, 0.01, 200, false, 'fon', 4],
  ['Rosine', 'F', 'A+', 'Ouidah', -0.01, 0.012, null, true, 'fr', 0],
  ['Donatien', 'M', 'B+', 'Ouidah', 0.015, -0.01, 260, true, 'fr', 9],
  ['Houéfa', 'F', 'O+', 'Abomey', 0.01, 0.005, 190, false, 'fon', 2],
  ['Codjo', 'M', 'A+', 'Abomey', -0.012, 0.01, null, false, 'fon', 0],
  ['Ulrich', 'M', 'O+', 'Bohicon', 0.01, -0.01, 170, true, 'fr', 5],
  ['Akouavi', 'F', 'B+', 'Bohicon', -0.01, 0.012, 230, false, 'fon', 1],
  ['Fabrice', 'M', 'AB+', 'Bohicon', 0.015, 0.015, null, true, 'fr', 0],
  ['Afi', 'F', 'O+', 'Lokossa', 0.01, 0.01, 185, false, 'fr', 2],
  ['Comlan', 'M', 'O+', 'Lokossa', -0.012, 0.008, null, true, 'fr', 0],
  ['Edwige', 'F', 'A-', 'Lokossa', 0.008, -0.012, 250, true, 'fr', 4],
  ['Worou', 'M', 'O+', 'Parakou', 0.012, -0.01, 175, false, 'bariba', 6],
  ['Sabi', 'M', 'B+', 'Parakou', -0.01, 0.015, null, false, 'bariba', 0],
  ['Tchabi', 'M', 'A+', 'Parakou', 0.02, 0.01, 210, true, 'fr', 3],
  ['Zénabou', 'F', 'O+', 'Parakou', -0.015, -0.012, 160, true, 'fr', 2],
  ['Moumouni', 'M', 'O+', 'Djougou', 0.01, 0.008, 190, false, 'dendi', 5],
  ['Ramatou', 'F', 'O+', 'Djougou', -0.01, 0.01, null, true, 'fr', 0],
  ['Issifou', 'M', 'B+', 'Djougou', 0.012, -0.01, 220, false, 'dendi', 3],
  ['Aminatou', 'F', 'A+', 'Djougou', -0.008, -0.012, 170, true, 'fr', 1],
  ['N’Tcha', 'M', 'O+', 'Natitingou', 0.01, 0.01, 200, false, 'fr', 4],
  ['Kouagou', 'M', 'A+', 'Natitingou', -0.01, 0.012, null, true, 'fr', 0],
  ['Orou', 'M', 'O+', 'Kandi', 0.01, -0.01, 185, false, 'bariba', 7],
  ['Safiatou', 'F', 'B+', 'Kandi', -0.012, 0.01, null, true, 'fr', 0],
  ['Alassane', 'M', 'O+', 'Malanville', 0.008, 0.01, 210, false, 'dendi', 2],
  ['Hadiza', 'F', 'A+', 'Malanville', -0.01, -0.008, 175, false, 'dendi', 1],
];

/** Demandes de démonstration hors parcours héros (identifiants fixes : rejouables). */
const REQ_MEL = '5a9b0000-0000-4000-8000-00000000b001';
const REQ_PARAKOU = '5a9b0000-0000-4000-8000-00000000b002';
/** Documents de Koffi (résultat, compte rendu, radiographie), visibles d'un soignant qui a le volet « documents ». */
const DOC_NFS = '5a9b0000-0000-4000-8000-00000000d001';
const DOC_CR = '5a9b0000-0000-4000-8000-00000000d002';
const DOC_XRAY = '5a9b0000-0000-4000-8000-00000000d003';

export async function seedBlood(ctx: SeedCtx) {
  const { prisma, users, daysAgo, inDays } = ctx;
  const communes = await prisma.commune.findMany({ where: { name: { in: [...new Set(DONORS.map((d) => d[3]))] } } });
  const at = (name: string) => communes.find((c) => c.name === name)!;

  // 1. Donneurs éligibles (mis à jour par numéro : l'historique de leurs réponses est conservé).
  for (const [i, [firstName, sex, bloodGroup, city, dLat, dLng, last, hasSmartphone, lang, donations]] of DONORS.entries()) {
    const c = at(city);
    const data = {
      firstName, sex, bloodGroup, city, lat: c.lat + dLat, lng: c.lng + dLng, hasSmartphone, lang, donations,
      lastDonationAt: last === null ? null : daysAgo(last), available: true,
    };
    const phone = `0195${String(i + 1).padStart(6, '0')}`;
    await prisma.donor.upsert({ where: { phone }, update: data, create: { ...data, phone, createdAt: daysAgo(10 + i * 9) } });
  }

  // 2. Parcours héros : Rodrigue (téléphone simple, fon) reste le donneur le plus proche du CNHU-HKM,
  //    disponible et reposé ; Afiavi (aidante de Koffi, O+) redevient éligible (dernier don il y a 6 mois).
  await prisma.donor.updateMany({ where: { phone: '0196000000' }, data: { available: true, lastDonationAt: daysAgo(140), donations: 6, hasSmartphone: false, lang: 'fon', lat: 6.3585, lng: 2.4201 } });
  if (users.afiavi) await prisma.donor.updateMany({ where: { userId: users.afiavi.id }, data: { available: true, lastDonationAt: daysAgo(200), donations: 3, hasSmartphone: true } });
  //    Plaquettes O+/O- en tension dans le Sud, comme au seed initial : une seule poche compatible à moins de
  //    60 km du CNHU-HKM (SDTS Atlantique-Littoral), la demande par défaut en réclame 2 → donneurs alertés.
  const south = await prisma.facility.findMany({ where: { shortName: { in: ['ANTS', 'SDTS Atlantique-Littoral', 'SDTS Ouémé-Plateau'] } } });
  for (const site of south) {
    for (const bloodGroup of ['O+', 'O-']) {
      const units = bloodGroup === 'O+' && site.shortName === 'SDTS Atlantique-Littoral' ? 1 : 0;
      await prisma.bloodStock.upsert({ where: { siteId_product_bloodGroup: { siteId: site.id, product: 'PLAQUETTES', bloodGroup } }, update: { units }, create: { siteId: site.id, product: 'PLAQUETTES', bloodGroup, units } });
    }
  }
  //    Les demandes de démonstration restées ouvertes pour Koffi (essais précédents) sont closes : le parcours
  //    repart de zéro et le « 1 » de Rodrigue répond bien à la nouvelle demande.
  if (users.koffi) {
    const stale = await prisma.bloodRequest.findMany({ where: { patient: { userId: users.koffi.id }, status: { in: ['OUVERTE', 'DONNEURS_ALERTES', 'DONNEUR_TROUVE', 'POCHES_RESERVEES'] } }, select: { id: true } });
    await prisma.donorAlert.updateMany({ where: { requestId: { in: stale.map((r) => r.id) }, status: 'ENVOYEE' }, data: { status: 'EXPIREE' } });
    await prisma.bloodRequest.updateMany({ where: { id: { in: stale.map((r) => r.id) } }, data: { status: 'ANNULEE' } });
  }

  // 3. Deux demandes ouvertes ailleurs : la banque de sang peut réserver des poches, les donneurs proches se proposer.
  await prisma.notification.deleteMany({ where: { href: { in: [REQ_MEL, REQ_PARAKOU].flatMap((id) => [`/ants#demande-${id}`, `/pro/sang/${id}`]) } } });
  await prisma.bloodRequest.deleteMany({ where: { id: { in: [REQ_MEL, REQ_PARAKOU] } } });
  const secondaries = await prisma.patient.findMany({ where: { userId: null, parentId: null, bloodGroup: { in: ['O+', 'B+'] } }, orderBy: { createdAt: 'asc' }, take: 40 });
  const patientO = secondaries.find((p) => p.bloodGroup === 'O+');
  const patientB = secondaries.find((p) => p.bloodGroup === 'B+');
  const [mel, chudBa] = await Promise.all([
    prisma.facility.findFirst({ where: { shortName: 'CHU-MEL (ex-HOMEL)' } }),
    prisma.facility.findFirst({ where: { shortName: 'CHUD-BA' } }),
  ]);
  const doctorAt = async (facilityId: string | undefined) =>
    (facilityId ? await prisma.practitioner.findFirst({ where: { facilityId, user: { role: 'PRACTITIONER', demoPersona: null } }, include: { user: true } }) : null)?.user;
  const now = Date.now();
  const demos = [
    { id: REQ_MEL, facility: mel, patient: patientO, product: 'CGR', quantity: 2, urgency: 'URGENTE', neededBy: inDays(1, 12), createdAt: new Date(now - 2 * 3600_000), alertCity: 'Cotonou' },
    { id: REQ_PARAKOU, facility: chudBa, patient: patientB, product: 'PLAQUETTES', quantity: 1, urgency: 'VITALE', neededBy: new Date(now + 10 * 3600_000), createdAt: new Date(now - 40 * 60_000), alertCity: 'Parakou' },
  ];
  const antsIds = (await prisma.user.findMany({ where: { role: 'BLOOD_BANK' }, select: { id: true } })).map((u) => u.id);
  for (const d of demos) {
    if (!d.facility || !d.patient?.bloodGroup) continue;
    const doctor = await doctorAt(d.facility.id);
    const requester = doctor ?? (users.houngbedji ? { id: users.houngbedji.id, displayName: 'Dr Houngbédji' } : null);
    if (!requester) continue;
    const group = d.patient.bloodGroup;
    await prisma.bloodRequest.create({
      data: {
        id: d.id, patientId: d.patient.id, requesterId: requester.id, requesterName: requester.displayName, facilityId: d.facility.id,
        product: d.product, bloodGroup: group, quantity: d.quantity, urgency: d.urgency, neededBy: d.neededBy, status: 'DONNEURS_ALERTES', createdAt: d.createdAt,
      },
    });
    // Trois donneurs compatibles de la ville, déjà alertés, sans réponse pour l'instant.
    const compatible = group === 'O+' ? ['O+', 'O-'] : ['O+', 'O-', 'B+', 'B-'];
    const crowd = await prisma.donor.findMany({
      where: { city: d.alertCity, bloodGroup: { in: compatible }, available: true, userId: null, phone: { startsWith: '0196' }, NOT: { phone: '0196000000' }, OR: [{ lastDonationAt: null }, { lastDonationAt: { lt: daysAgo(130) } }] },
      orderBy: { phone: 'asc' },
      take: 3,
    });
    for (const [k, c] of crowd.entries()) {
      const km = Math.round(Math.hypot((c.lat - d.facility.lat) * 111, (c.lng - d.facility.lng) * 110) * 10) / 10;
      await prisma.donorAlert.create({ data: { requestId: d.id, donorId: c.id, distanceKm: km, channel: c.hasSmartphone ? 'APP' : c.lang !== 'fr' ? 'VOICE' : 'SMS', createdAt: new Date(d.createdAt.getTime() + (k + 1) * 60_000) } });
    }
    const place = d.facility.shortName ?? d.facility.name;
    const label = d.product === 'CGR' ? 'globules rouges' : 'plaquettes';
    if (antsIds.length) {
      await prisma.notification.createMany({
        data: antsIds.map((userId) => ({
          userId, kind: 'SANG', title: `Demande de sang ${group} · ${place}`, href: `/ants#demande-${d.id}`, createdAt: d.createdAt,
          body: `${d.quantity} poche${d.quantity > 1 ? 's' : ''} de ${label} ${group}, ${d.urgency === 'VITALE' ? 'urgence vitale' : 'urgente'}. Demandée par ${requester.displayName}.`,
        })),
      });
    }
  }

  // 4. Documents du carnet de Koffi : un soignant les voit seulement avec le volet « documents ».
  const koffi = users.koffi ? await prisma.patient.findUnique({ where: { userId: users.koffi.id } }) : null;
  if (koffi) {
    const docs = [
      {
        id: DOC_NFS, kind: 'RESULTAT', title: 'Numération formule sanguine', mime: 'application/pdf', createdAt: daysAgo(4, 10),
        data: pdf([
          [16, 'Laboratoire du CNHU-HKM, Cotonou'],
          [11, 'Numération formule sanguine (NFS)'],
          [11, 'Patient : Koffi Agossou, né le 14/03/1992'],
          [11, ' '],
          [11, 'Hémoglobine ........ 9,8 g/dL    (13 - 17)'],
          [11, 'Plaquettes ......... 48 G/L      (150 - 400)'],
          [11, 'Globules blancs .... 6,2 G/L     (4 - 10)'],
          [11, ' '],
          [11, 'Thrombopénie marquée. Avis de l\'hématologue demandé.'],
          [9, 'Document de démonstration Ganji : données fictives.'],
        ]),
      },
      {
        id: DOC_CR, kind: 'COMPTE_RENDU', title: 'Compte rendu d’hospitalisation', mime: 'application/pdf', createdAt: daysAgo(205, 15),
        data: pdf([
          [16, 'CNHU-HKM · Service d\'hématologie'],
          [11, 'Compte rendu d\'hospitalisation (4 jours)'],
          [11, 'Motif : fièvre, infection. Antibiothérapie intraveineuse.'],
          [11, 'Transfusion de 2 poches, bonne tolérance.'],
          [11, 'Sortie avec traitement oral. Contrôle NFS dans 15 jours.'],
          [11, 'Dr Houngbédji'],
          [9, 'Document de démonstration Ganji : données fictives.'],
        ]),
      },
      { id: DOC_XRAY, kind: 'IMAGERIE', title: 'Radiographie du thorax', mime: 'image/png', createdAt: daysAgo(90, 11), data: xray(240, 200) },
    ];
    await prisma.documentRef.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } });
    await prisma.documentRef.createMany({
      data: docs.map((d) => ({ id: d.id, patientId: koffi.id, kind: d.kind, title: d.title, mime: d.mime, size: d.data.length, dataB64: d.data.toString('base64'), createdAt: d.createdAt })),
    });
  }
}

/** PDF d'une page, texte en Helvetica (WinAnsi pour les accents), sans dépendance. */
function pdf(lines: [number, string][]): Buffer {
  const esc = (s: string) => s.replace(/[’‘]/g, "'").replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let y = 780;
  const ops = ['BT'];
  for (const [size, text] of lines) {
    ops.push(`/F1 ${size} Tf 1 0 0 1 56 ${y} Tm (${esc(text)}) Tj`);
    y -= size + 12;
  }
  ops.push('ET');
  const stream = Buffer.from(ops.join('\n'), 'latin1');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Image PNG en niveaux de gris évoquant une radiographie du thorax (démonstration). */
function xray(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w + 1) * h);
  const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let v = 18;
      const body = inEllipse(x, y, w / 2, h * 0.62, w * 0.46, h * 0.62);
      if (body < 1) v = 150 - body * 60;
      const lung = Math.min(inEllipse(x, y, w * 0.32, h * 0.55, w * 0.14, h * 0.3), inEllipse(x, y, w * 0.68, h * 0.55, w * 0.14, h * 0.3));
      if (lung < 1) v = 45 + lung * 50;
      if (Math.abs(x - w / 2) < w * 0.035 && y > h * 0.1) v = 215;
      const rib = Math.sin((y - Math.abs(x - w / 2) * 0.35) / 7);
      if (lung < 1.15 && rib > 0.93) v = Math.min(255, v + 55);
      const heart = inEllipse(x, y, w * 0.56, h * 0.72, w * 0.12, h * 0.14);
      if (heart < 1) v = Math.max(v, 170 - heart * 40);
      raw[y * (w + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 0; // niveaux de gris
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c;
}
