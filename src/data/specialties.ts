/** Libellés des spécialités de télé-expertise, tels qu'ils s'affichent dans le carnet et le journal. */
export const SPECIALTY_LABEL: Record<string, string> = {
  HEMATOLOGIE: 'hématologie',
  ONCOLOGIE: 'oncologie',
  PEDIATRIE: 'pédiatrie',
  GYNECOLOGIE: 'gynécologie',
  CARDIOLOGIE: 'cardiologie',
  DERMATOLOGIE: 'dermatologie',
  MEDECINE_INTERNE: 'médecine interne',
};

export const specialtyLabel = (code: string) => SPECIALTY_LABEL[code] ?? code.toLowerCase();
