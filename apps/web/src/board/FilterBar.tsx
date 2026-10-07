import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COLORS, DUE_FILTERS, EMPTY_FILTER, isFilterActive, type BoardFilter } from '@flowboard/shared';
import { btn, btnGhost, colorHex, colorLabel, cx, input } from '../lib';
import { useBoard } from './context';

/** Bascule une valeur dans une liste (OU au sein d'un critère). */
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Barre de filtre persistante du board (spec § 4.5) : les tâches non retenues sont masquées, jamais supprimées. */
export function FilterBar({ hidden }: { hidden: number }) {
  const { t } = useTranslation();
  const { data, filter, setFilter } = useBoard();
  const [open, setOpen] = useState(false);
  const active = isFilterActive(filter);
  const fields = filter.fields ?? {};
  const count =
    filter.responsible.length +
    filter.labels.length +
    filter.colors.length +
    filter.due.length +
    Object.values(fields).reduce((n, v) => n + v.length, 0);
  const set = (patch: Partial<BoardFilter>) => setFilter({ ...filter, ...patch });
  const chip = (on: boolean) =>
    cx(
      'rounded-full border px-2.5 py-0.5 text-xs',
      on ? 'border-accent bg-accent text-accent-fg' : 'border-line hover:bg-surface-2',
    );

  return (
    <div className="no-print border-b border-line bg-surface px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className={`${input} max-w-64`}
          aria-label={t('filter.text')}
          placeholder={t('filter.text')}
          data-filter-input
          value={filter.text}
          onChange={(e) => set({ text: e.target.value })}
        />
        <button
          type="button"
          className={cx(btn, count > 0 && 'border-accent text-accent')}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {t('filter.title')}
          {count > 0 && ` (${count})`}
        </button>
        {active && (
          <>
            <span role="status" className="text-xs text-muted">
              {t('filter.hidden', { count: hidden })}
            </span>
            <button type="button" className={btnGhost} onClick={() => setFilter(EMPTY_FILTER)}>
              {t('filter.reset')}
            </button>
          </>
        )}
      </div>
      {open && (
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {t('filter.responsible')}
            </legend>
            <div className="flex flex-wrap gap-1">
              {[
                { id: 'me', label: t('filter.me') },
                { id: 'none', label: t('filter.unassigned') },
                ...data.members.map((m) => ({ id: m.userId, label: m.fullName })),
              ].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={filter.responsible.includes(o.id)}
                  className={chip(filter.responsible.includes(o.id))}
                  onClick={() => set({ responsible: toggle(filter.responsible, o.id) })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {t('task.labels')}
            </legend>
            <div className="flex flex-wrap gap-1">
              {data.board.labels.length === 0 && (
                <span className="text-xs text-muted">{t('common.none')}</span>
              )}
              {data.board.labels.map((l) => (
                <button
                  key={l._id}
                  type="button"
                  aria-pressed={filter.labels.includes(l._id)}
                  className={chip(filter.labels.includes(l._id))}
                  onClick={() => set({ labels: toggle(filter.labels, l._id) })}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {t('task.color')}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {[...COLORS, ...(data.board.customColors ?? [])].map((c) => {
                const label = colorLabel(data.board.colorLabels, c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={filter.colors.includes(c)}
                    aria-label={label}
                    title={label}
                    className={cx(
                      'h-6 w-6 rounded-full border-2',
                      filter.colors.includes(c) ? 'border-fg' : 'border-transparent',
                    )}
                    style={{ background: colorHex(c) }}
                    onClick={() => set({ colors: toggle(filter.colors, c) })}
                  />
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {t('task.due')}
            </legend>
            <div className="flex flex-wrap gap-1">
              {DUE_FILTERS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={filter.due.includes(d)}
                  className={chip(filter.due.includes(d))}
                  onClick={() => set({ due: toggle(filter.due, d) })}
                >
                  {t(`filter.dues.${d}`)}
                </button>
              ))}
            </div>
          </fieldset>
          {(data.board.customFields ?? [])
            .filter((f) => f.type === 'dropdown')
            .map((f) => (
              <fieldset key={f._id}>
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {f.name}
                </legend>
                <div className="flex flex-wrap gap-1">
                  {f.options.map((o) => {
                    const on = (fields[f._id] ?? []).includes(o._id);
                    return (
                      <button
                        key={o._id}
                        type="button"
                        aria-pressed={on}
                        className={chip(on)}
                        onClick={() =>
                          set({ fields: { ...fields, [f._id]: toggle(fields[f._id] ?? [], o._id) } })
                        }
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
        </div>
      )}
    </div>
  );
}
