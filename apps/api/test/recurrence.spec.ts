import { RecurrenceInput } from '@flowboard/shared';
import { nextOccurrence } from '../src/tasks/recurrence';

const rule = (r: Partial<RecurrenceInput>) => RecurrenceInput.parse({ freq: 'daily', ...r });
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const next = (r: Partial<RecurrenceInput>, anchor: string, after: string) =>
  nextOccurrence(rule(r), d(anchor), new Date(after))?.toISOString().slice(0, 10) ?? null;

describe('Règle de récurrence (§ 4.4)', () => {
  it('hebdomadaire due lundi, terminée mercredi → lundi suivant', () => {
    // 2026-10-05 est un lundi.
    expect(next({ freq: 'weekly' }, '2026-10-05', '2026-10-07T15:00:00Z')).toBe('2026-10-12');
  });

  it('jours ouvrés : vendredi → lundi', () => {
    expect(next({ freq: 'weekdays' }, '2026-10-05', '2026-10-09T10:00:00Z')).toBe('2026-10-12');
  });

  it('hebdomadaire sur jours choisis et tous les 2 semaines', () => {
    expect(next({ freq: 'weekly', weekdays: [1, 3] }, '2026-10-05', '2026-10-06T10:00:00Z')).toBe(
      '2026-10-08',
    );
    expect(next({ freq: 'weekly', interval: 2 }, '2026-10-05', '2026-10-05T10:00:00Z')).toBe('2026-10-19');
  });

  it('mensuelle : même jour, ou « 2e mardi »', () => {
    expect(next({ freq: 'monthly' }, '2026-10-15', '2026-10-15T10:00:00Z')).toBe('2026-11-15');
    // 2026-10-13 est le 2e mardi d'octobre ; le 2e mardi de novembre est le 10.
    expect(next({ freq: 'monthly', monthlyBy: 'nth' }, '2026-10-13', '2026-10-13T10:00:00Z')).toBe(
      '2026-11-10',
    );
  });

  it('annuelle, tous les N jours, date de fin', () => {
    expect(next({ freq: 'yearly' }, '2026-02-01', '2026-02-01T10:00:00Z')).toBe('2027-02-01');
    expect(next({ interval: 3 }, '2026-10-05', '2026-10-05T10:00:00Z')).toBe('2026-10-08');
    expect(
      next({ endType: 'until', endUntil: d('2026-10-06') }, '2026-10-05', '2026-10-06T10:00:00Z'),
    ).toBeNull();
  });
});
