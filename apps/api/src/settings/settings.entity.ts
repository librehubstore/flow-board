export interface Settings {
  _id: 'instance';
  instanceName: string;
  defaultLocale: 'fr' | 'en';
  defaultTimezone: string;
  maxAttachmentMb: number;
  /** `admin` : comptes créés par un administrateur ; `open` : inscription en libre-service. */
  onboarding: 'admin' | 'open';
  registration: { password: boolean; google: boolean };
  /** Domaines email autorisés à s'inscrire (vide = tous). */
  allowedDomains: string[];
}
