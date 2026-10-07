import { RRule, type Options } from 'rrule';
import type { RecurrenceInput } from '@flowboard/shared';

const DAYS = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];
/** Jour de semaine d'une date, 0 = lundi. */
const weekday = (d: Date) => (d.getUTCDay() + 6) % 7;

/** Minuit UTC du jour : les dates de récurrence sont des jours, comme les échéances sans heure. */
export const startOfDayUtc = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Règle iCal (RRULE) équivalente au formulaire, ancrée sur la première occurrence. */
export function toRRule(r: RecurrenceInput, anchor: Date): RRule {
  const base: Partial<Options> = { dtstart: anchor, interval: r.interval };
  switch (r.freq) {
    case 'daily':
      return new RRule({ ...base, freq: RRule.DAILY });
    case 'weekdays':
      return new RRule({ ...base, freq: RRule.WEEKLY, byweekday: DAYS.slice(0, 5) });
    case 'weekly':
      return new RRule({
        ...base,
        freq: RRule.WEEKLY,
        byweekday: (r.weekdays.length ? r.weekdays : [weekday(anchor)]).map((d) => DAYS[d]),
      });
    case 'monthly': {
      if (r.monthlyBy === 'day')
        return new RRule({ ...base, freq: RRule.MONTHLY, bymonthday: anchor.getUTCDate() });
      // « n-ième jour de semaine » du mois de l'ancre ; une 5e occurrence devient « le dernier ».
      const nth = Math.ceil(anchor.getUTCDate() / 7);
      return new RRule({
        ...base,
        freq: RRule.MONTHLY,
        byweekday: DAYS[weekday(anchor)].nth(nth === 5 ? -1 : nth),
      });
    }
    case 'yearly':
      return new RRule({ ...base, freq: RRule.YEARLY });
  }
}

/**
 * Prochaine date strictement après `after`, ou null si la série est terminée (date de fin).
 * ponytail: un « 31 du mois » saute les mois plus courts (sémantique RRULE standard).
 */
export function nextOccurrence(r: RecurrenceInput, anchor: Date, after: Date): Date | null {
  const next = toRRule(r, anchor).after(after, false);
  if (!next || (r.endType === 'until' && r.endUntil && next > r.endUntil)) return null;
  return next;
}
