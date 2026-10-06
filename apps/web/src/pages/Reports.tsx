import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { TIME_GROUPS, type TimeReportRow } from '@flowboard/shared';
import { api, type Board } from '../api';
import {
  btn,
  card,
  cx,
  ErrorText,
  Field,
  formatDuration,
  fromZoned,
  input,
  toZoned,
  useDirectory,
  useTimeZone,
} from '../lib';

const PRESETS = ['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'custom'] as const;
type Preset = (typeof PRESETS)[number];

/** Bornes [début, fin] (dates AAAA-MM-JJ incluses) d'une période prédéfinie, dans le fuseau de l'utilisateur. */
function range(preset: Preset, today: string): [string, string] {
  const d = new Date(`${today}T12:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const shift = (x: Date, days: number) => new Date(x.getTime() + days * 86_400_000);
  const monday = shift(d, -((d.getUTCDay() + 6) % 7));
  if (preset === 'thisWeek') return [iso(monday), iso(shift(monday, 6))];
  if (preset === 'lastWeek') return [iso(shift(monday, -7)), iso(shift(monday, -1))];
  const first = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (preset === 'lastMonth' ? 1 : 0), 1, 12),
  );
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12));
  return [iso(first), iso(last)];
}

/** Rapport « temps passé » (spec § 4.7) : période, filtres, regroupement, totaux, export CSV. */
export function Reports() {
  const { t } = useTranslation();
  const tz = useTimeZone();
  const today = toZoned(new Date().toISOString(), tz).date;
  const [preset, setPreset] = useState<Preset>('thisWeek');
  const [custom, setCustom] = useState<[string, string]>(range('thisWeek', today));
  const [groupBy, setGroupBy] = useState<(typeof TIME_GROUPS)[number]>('user');
  const [users, setUsers] = useState<string[]>([]);
  const [boards, setBoards] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const directory = useDirectory().data ?? [];
  const myBoards = useQuery({ queryKey: ['boards'], queryFn: () => api<Board[]>('/boards') }).data ?? [];
  const knownLabels =
    useQuery({ queryKey: ['timeLabels'], queryFn: () => api<string[]>('/time-entries/labels') }).data ?? [];

  const [start, end] = preset === 'custom' ? custom : range(preset, today);
  const endExclusive = new Date(Date.parse(`${end}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    from: fromZoned(start, '00:00', tz),
    to: fromZoned(endExclusive, '00:00', tz),
    groupBy,
    timeZone: tz,
    ...(users.length ? { users: users.join(',') } : {}),
    ...(boards.length ? { boards: boards.join(',') } : {}),
    ...(labels.length ? { labels: labels.join(',') } : {}),
  });
  const report = useQuery({
    queryKey: ['report', params.toString()],
    queryFn: () => api<{ rows: TimeReportRow[]; total: number }>(`/reports/time?${params}`),
    enabled: start <= end,
  });
  const max = Math.max(1, ...(report.data?.rows.map((r) => r.seconds) ?? []));
  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const multi = (
    label: string,
    options: { id: string; name: string }[],
    value: string[],
    set: (v: string[]) => void,
  ) => (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</legend>
      <div className="flex max-h-32 flex-wrap gap-1 overflow-auto">
        {options.length === 0 && <span className="text-xs text-muted">{t('common.none')}</span>}
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value.includes(o.id)}
            className={cx(
              'rounded-full border px-2.5 py-0.5 text-xs',
              value.includes(o.id)
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-line hover:bg-surface-2',
            )}
            onClick={() => set(toggle(value, o.id))}
          >
            {o.name}
          </button>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">{t('reports.title')}</h1>
      <div className={`${card} no-print space-y-4 p-4`}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t('reports.period')}>
            <select className={input} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {t(`reports.presets.${p}`)}
                </option>
              ))}
            </select>
          </Field>
          {preset === 'custom' && (
            <>
              <Field label={t('reports.from')}>
                <input
                  type="date"
                  className={input}
                  value={custom[0]}
                  onChange={(e) => setCustom([e.target.value, custom[1]])}
                />
              </Field>
              <Field label={t('reports.to')}>
                <input
                  type="date"
                  className={input}
                  value={custom[1]}
                  onChange={(e) => setCustom([custom[0], e.target.value])}
                />
              </Field>
            </>
          )}
          <Field label={t('reports.groupBy')}>
            <select
              className={input}
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
            >
              {TIME_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {t(`reports.groups.${g}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {multi(
            t('reports.users'),
            directory.map((u) => ({ id: u._id, name: u.fullName })),
            users,
            setUsers,
          )}
          {multi(
            t('reports.boards'),
            myBoards.map((b) => ({ id: b._id, name: b.name })),
            boards,
            setBoards,
          )}
          {multi(
            t('reports.labels'),
            [...new Set(['Facturable', ...knownLabels])].map((l) => ({ id: l, name: l })),
            labels,
            setLabels,
          )}
        </div>
      </div>
      <ErrorText error={report.error} />
      {report.data && (
        <section className={`${card} p-4`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">
              {t('reports.total')} : {formatDuration(report.data.total)}
            </h2>
            <a className={`${btn} no-print`} href={`/api/reports/time?${params}&format=csv`} download>
              {t('reports.exportCsv')}
            </a>
          </div>
          {report.data.rows.length === 0 ? (
            <p className="text-sm text-muted">{t('reports.empty')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted">
                <tr>
                  <th className="py-1">{t(`reports.groups.${groupBy}`)}</th>
                  <th className="w-24 py-1 text-right">{t('reports.duration')}</th>
                  <th className="w-1/3 py-1">
                    <span className="sr-only">{t('reports.share')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.data.rows.map((r) => (
                  <tr key={r.key} className="border-t border-line">
                    <td className="py-1.5">{r.label}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{formatDuration(r.seconds)}</td>
                    <td className="py-1.5 pl-3">
                      <div
                        className="h-2 rounded bg-accent"
                        style={{ width: `${(r.seconds / max) * 100}%` }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
