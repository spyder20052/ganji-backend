import { describe, expect, it } from 'vitest';
import { canMove, checkPreferred, partOfDay, preferredText, reminderTitle, sortForPatient, staffFilter, startOfDayBenin, when } from '../src/appointments/appointments.logic';
import { cleanList, joinAddress, missingFields, patientBloodGroup, splitAddress, toLang, toUiLang } from '../src/profile/profile.logic';

describe('Profil : règles de saisie', () => {
  it('un groupe vérifié par un soignant ne se remplace pas par une déclaration', () => {
    expect(patientBloodGroup('O+', 'VERIFIE', 'A+')).toEqual({ refused: true });
    expect(patientBloodGroup('O+', 'VERIFIE', null)).toEqual({ refused: true });
    // Redire le même groupe n'est pas une modification.
    expect(patientBloodGroup('O+', 'VERIFIE', 'O+')).toEqual({ change: false });
  });

  it('un groupe déclaré se corrige, « Je ne sais pas » l’efface', () => {
    expect(patientBloodGroup(null, null, 'B-')).toEqual({ change: true, bloodGroup: 'B-', bloodGroupSource: 'DECLARE' });
    expect(patientBloodGroup('B-', 'DECLARE', 'AB+')).toEqual({ change: true, bloodGroup: 'AB+', bloodGroupSource: 'DECLARE' });
    expect(patientBloodGroup('B-', 'DECLARE', null)).toEqual({ change: true, bloodGroup: null, bloodGroupSource: null });
  });

  it('adresse : quartier et repère en une chaîne lisible, redécoupée à l’identique', () => {
    const a = joinAddress('  Zogbadjè ', 'près de la mosquée');
    expect(a).toBe('Zogbadjè · près de la mosquée');
    expect(splitAddress(a)).toEqual({ quartier: 'Zogbadjè', repere: 'près de la mosquée' });
    expect(joinAddress('', '')).toBeNull();
    expect(splitAddress('Rue 12')).toEqual({ quartier: 'Rue 12', repere: '' });
  });

  it('allergies sans doublon ni vide, majuscule initiale', () => {
    expect(cleanList(['pénicilline', ' Arachide ', 'Pénicilline', ''])).toEqual(['Pénicilline', 'Arachide']);
  });

  it('langues : codes de l’interface ↔ langue des SMS', () => {
    expect(toLang('yo')).toBe('yoruba');
    expect(toLang('bba')).toBe('bariba');
    expect(toUiLang('dendi')).toBe('ddn');
  });

  it('ce qui manque pour l’urgence : groupe, personne à prévenir, commune', () => {
    const base = { bloodGroup: null, emergencyPhone: null, communeId: null, allergies: [], profileDoneAt: null };
    expect(missingFields(base)).toEqual(['bloodGroup', 'emergencyContact', 'commune', 'allergies']);
    expect(missingFields({ ...base, bloodGroup: 'O+', emergencyPhone: '0190000002', communeId: 'c', profileDoneAt: new Date() })).toEqual([]);
  });
});

describe('Rendez-vous : règles', () => {
  const now = new Date('2026-09-26T10:00:00Z');

  it('souhait : pas dans le passé, pas au-delà de 90 jours ; aujourd’hui accepté', () => {
    expect(checkPreferred(new Date('2026-09-25T08:00:00Z'), now)).toMatch(/aujourd/);
    expect(checkPreferred(new Date('2027-02-01T08:00:00Z'), now)).toMatch(/trois prochains mois/);
    expect(checkPreferred(new Date('2026-09-26T08:00:00Z'), now)).toBeNull();
    expect(startOfDayBenin(now).toISOString()).toBe('2026-09-25T23:00:00.000Z');
  });

  it('matin avant midi à Cotonou (UTC+1), après-midi ensuite', () => {
    expect(partOfDay(new Date('2026-10-01T08:00:00Z'))).toBe('MATIN');
    expect(partOfDay(new Date('2026-10-01T14:00:00Z'))).toBe('APRES_MIDI');
    expect(preferredText(new Date('2026-10-01T08:00:00Z'))).toBe('jeudi 1 octobre, le matin');
    expect(when(new Date('2026-10-01T08:30:00Z'))).toBe('jeudi 1 octobre à 9 h 30');
    expect(when(new Date('2026-10-01T08:30:00Z'), 'en')).toBe('Thursday 1 October at 09:30');
  });

  it('transitions : la personne annule, l’établissement confirme, refuse, clôt ; rien après la clôture', () => {
    expect(canMove('DEMANDE', 'CONFIRME')).toBe(true);
    expect(canMove('DEMANDE', 'FAIT')).toBe(false);
    expect(canMove('CONFIRME', 'FAIT')).toBe(true);
    expect(canMove('CONFIRME', 'ANNULE')).toBe(true);
    expect(canMove('REFUSE', 'CONFIRME')).toBe(false);
    expect(canMove('ANNULE', 'ANNULE')).toBe(false);
  });

  it('liste de la personne : à venir, puis en attente, puis le reste', () => {
    const d = (s: string) => new Date(s);
    const rows = [
      { id: 'passe', status: 'FAIT', scheduledAt: d('2026-08-01T09:00:00Z'), preferredAt: d('2026-08-01T08:00:00Z'), updatedAt: d('2026-08-01T12:00:00Z') },
      { id: 'attente', status: 'DEMANDE', scheduledAt: null, preferredAt: d('2026-10-02T08:00:00Z'), updatedAt: d('2026-09-20T12:00:00Z') },
      { id: 'bientot', status: 'CONFIRME', scheduledAt: d('2026-09-29T09:00:00Z'), preferredAt: d('2026-09-29T08:00:00Z'), updatedAt: d('2026-09-20T12:00:00Z') },
    ];
    expect(sortForPatient(rows, now).map((r) => r.id)).toEqual(['bientot', 'attente', 'passe']);
  });

  it('« Enfant » : pédiatres, ou tout soignant d’un établissement qui a un service de pédiatrie', () => {
    const f = staffFilter('PEDIATRIE', ['PRACTITIONER', 'NURSE']) as { OR?: unknown[] };
    expect(f.OR).toHaveLength(2);
    expect(staffFilter('GENERALE', ['PRACTITIONER'])).not.toHaveProperty('specialty');
    expect(reminderTitle('HEMATOLOGIE')).toBe('Consultation hématologie');
    expect(reminderTitle('GENERALE')).toBe('Consultation');
  });
});
