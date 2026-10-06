import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Board } from '../api';
import { btnPrimary, card, ErrorText, input } from '../lib';

export function Boards() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const boards = useQuery({ queryKey: ['boards'], queryFn: () => api<Board[]>('/boards') });
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const templates =
    useQuery({ queryKey: ['templates'], queryFn: () => api<Board[]>('/boards/templates') }).data ?? [];
  const create = useMutation({
    mutationFn: () => api<Board>('/boards', { body: { name, ...(templateId ? { templateId } : {}) } }),
    onSuccess: (b) => navigate(`/boards/${b._id}`),
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">{t('boards.title')}</h1>
      <form
        className="flex max-w-2xl flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input
          className={input}
          aria-label={t('boards.namePlaceholder')}
          placeholder={t('boards.namePlaceholder')}
          value={name}
          maxLength={255}
          onChange={(e) => setName(e.target.value)}
        />
        {templates.length > 0 && (
          <select
            className={`${input} w-56`}
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
          {t('boards.create')}
        </button>
      </form>
      <ErrorText error={create.error ?? boards.error} />
      {boards.data?.length === 0 && <p className="text-muted">{t('boards.empty')}</p>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {boards.data?.map((b) => (
          <li key={b._id}>
            <Link to={`/boards/${b._id}`} className={`${card} block h-full p-4 hover:border-accent`}>
              <span className="block font-semibold">
                {b.name}
                {b.isTemplate && (
                  <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-normal">
                    {t('boards.templateBadge')}
                  </span>
                )}
              </span>
              {b.description && (
                <span className="mt-1 line-clamp-2 block text-sm text-muted">{b.description}</span>
              )}
              <span className="mt-2 block text-xs text-muted">
                {t('boards.members', { count: b.members.length })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
