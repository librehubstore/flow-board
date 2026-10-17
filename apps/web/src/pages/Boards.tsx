import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Columns3, Plus } from 'lucide-react';
import { api, type Board } from '../api';
import {
  Avatar,
  btnPrimary,
  card,
  ErrorText,
  formatDate,
  i18n,
  input,
  useDirectory,
  useTimeZone,
} from '../lib';

export function Boards() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tz = useTimeZone();
  const users = useDirectory().data ?? [];
  const boards = useQuery({ queryKey: ['boards'], queryFn: () => api<Board[]>('/boards') });
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const templates =
    useQuery({ queryKey: ['templates'], queryFn: () => api<Board[]>('/boards/templates') }).data ?? [];
  const create = useMutation({
    mutationFn: () => api<Board>('/boards', { body: { name, ...(templateId ? { templateId } : {}) } }),
    onSuccess: (b) => navigate(`/boards/${b._id}`),
  });
  const fullName = (id: string) => users.find((u) => u._id === id)?.fullName ?? '?';

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{t('boards.title')}</h1>
          {!!boards.data?.length && (
            <p className="text-sm text-muted">{t('boards.count', { count: boards.data.length })}</p>
          )}
        </div>
        <form
          className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <input
            className={`${input} min-w-0 flex-1 sm:w-60`}
            aria-label={t('boards.namePlaceholder')}
            placeholder={t('boards.namePlaceholder')}
            value={name}
            maxLength={255}
            onChange={(e) => setName(e.target.value)}
          />
          {templates.length > 0 && (
            <select
              className={`${input} w-full sm:w-44`}
              aria-label={t('boards.template')}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">{t('boards.noTemplate')}</option>
              {templates.map((tpl) => (
                <option key={tpl._id} value={tpl._id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          )}
          <button className={`${btnPrimary} shrink-0`} disabled={create.isPending || !name.trim()}>
            <Plus size={15} />
            {t('boards.create')}
          </button>
        </form>
      </div>
      <ErrorText error={create.error ?? boards.error} />
      {boards.data?.length === 0 && (
        <div className={`${card} flex flex-col items-center gap-2 border-dashed px-6 py-14 text-center`}>
          <Columns3 size={28} className="text-muted" />
          <p className="font-medium">{t('boards.empty')}</p>
          <p className="text-sm text-muted">{t('boards.emptyHint')}</p>
        </div>
      )}
      {!!boards.data?.length && (
        <ul className={`${card} divide-y divide-line overflow-hidden shadow-xs`}>
          {boards.data.map((b) => (
            <li key={b._id}>
              <Link
                to={`/boards/${b._id}`}
                className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/10 font-semibold text-accent"
                >
                  {b.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{b.name}</span>
                    {b.isTemplate && (
                      <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
                        {t('boards.templateBadge')}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {b.description ||
                      t('boards.createdAt', { date: formatDate(b.createdAt, i18n.language, tz) })}
                  </span>
                </span>
                <span
                  className="hidden shrink-0 items-center sm:flex"
                  title={b.members.map((m) => fullName(m.userId)).join(', ')}
                >
                  <span className="sr-only">{t('boards.members', { count: b.members.length })}</span>
                  {b.members.slice(0, 4).map((m) => (
                    <span key={m.userId} className="-ml-1.5 rounded-full ring-2 ring-surface first:ml-0">
                      <Avatar name={fullName(m.userId)} size={24} />
                    </span>
                  ))}
                  {b.members.length > 4 && (
                    <span className="-ml-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-2 px-1 text-[11px] font-medium text-muted ring-2 ring-surface">
                      +{b.members.length - 4}
                    </span>
                  )}
                </span>
                <ChevronRight
                  size={16}
                  className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
