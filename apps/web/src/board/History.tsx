import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type TaskEvent } from '../api';
import { btn, colorLabel, ErrorText, formatDate, formatDuration, i18n, input, Modal } from '../lib';
import { useBoard, type BoardContext } from './context';

const EVENT_TYPES = [
  'taskCreated',
  'taskChanged',
  'taskMoved',
  'taskArchived',
  'taskRestored',
  'taskDeleted',
  'commentCreated',
  'commentChanged',
  'commentDeleted',
  'attachmentAdded',
  'attachmentDeleted',
] as const;

const short = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}…` : s);

/** Valeur lisible d'une propriété journalisée (spec § 4.9 : « couleur : jaune → rouge »). */
function formatValue(key: string, v: unknown, ctx: BoardContext): string {
  if (v === null || v === undefined || v === '') return '—';
  const { data, member, tz } = ctx;
  const b = data.board;
  if (key === 'color') return colorLabel(b.colorLabels, String(v));
  if (key === 'columnId' || key === 'dueTargetColumnId')
    return b.columns.find((c) => c._id === v)?.name ?? '?';
  if (key === 'swimlaneId') return b.swimlanes.find((s) => s._id === v)?.name ?? '?';
  if (key === 'responsibleUserId') return member(String(v))?.fullName ?? '?';
  if (key === 'collaboratorIds')
    return (v as string[]).map((id) => member(id)?.fullName ?? '?').join(', ') || '—';
  if (key === 'labels')
    return (
      (v as { id: string }[]).map((l) => b.labels.find((x) => x._id === l.id)?.name ?? '?').join(', ') || '—'
    );
  if (key === 'subtasks') {
    const list = v as { done: boolean }[];
    return `${list.filter((s) => s.done).length}/${list.length}`;
  }
  if (key === 'secondsEstimate') return formatDuration(Number(v));
  if (['dueAt', 'completedAt', 'archivedAt'].includes(key))
    return formatDate(String(v), i18n.language, tz, true);
  if (key === 'recurrence') return i18n.t(`recurrence.freqs.${(v as { freq: string }).freq}`);
  if (key.startsWith('customFields.')) {
    const field = b.customFields?.find((f) => f._id === key.slice('customFields.'.length));
    if (field?.type === 'dropdown') return field.options.find((o) => o._id === v)?.label ?? '?';
    if (field?.type === 'number') return `${field.numberPrefix}${v}${field.numberSuffix}`;
  }
  if (typeof v === 'boolean') return i18n.t(v ? 'common.yes' : 'common.no');
  return short(String(v));
}

function propertyLabel(key: string, ctx: BoardContext) {
  if (key.startsWith('customFields.'))
    return ctx.data.board.customFields?.find((f) => f._id === key.slice('customFields.'.length))?.name ?? '?';
  return i18n.t(`history.props.${key}`, { defaultValue: key });
}

/** Une entrée du journal : auteur, date, nature, puis « propriété : ancienne → nouvelle ». */
function EventItem({
  event,
  taskName,
  onOpen,
}: {
  event: TaskEvent;
  taskName?: string;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const ctx = useBoard();
  const changes = Object.entries(event.changes).filter(
    ([k]) => !['name', 'recurrenceOf'].includes(k) || event.type === 'taskChanged',
  );
  return (
    <li className="border-t border-line py-2 first:border-0">
      <p className="text-xs text-muted">
        <strong className="text-fg">{ctx.member(event.actorId)?.fullName ?? '?'}</strong> ·{' '}
        {formatDate(event.at, i18n.language, ctx.tz, true)} ·{' '}
        {t(`history.types.${event.type}`, { defaultValue: event.type })}
        {taskName !== undefined && (
          <>
            {' · '}
            {onOpen ? (
              <button type="button" className="underline" onClick={onOpen}>
                {taskName || '?'}
              </button>
            ) : (
              taskName
            )}
          </>
        )}
      </p>
      {event.type !== 'taskCreated' && changes.length > 0 && (
        <ul className="mt-0.5 text-sm">
          {changes.map(([key, c]) => (
            <li key={key}>
              {propertyLabel(key, ctx)} : {formatValue(key, c.old, ctx)} → {formatValue(key, c.new, ctx)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Onglet « Historique » d'une tâche. */
export function TaskHistory({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const { data } = useBoard();
  const [open, setOpen] = useState(false);
  const events = useQuery({
    queryKey: ['events', taskId],
    queryFn: () => api<TaskEvent[]>(`/boards/${data.board._id}/tasks/${taskId}/events`),
    enabled: open,
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">
        {t('history.title')}
      </summary>
      <ErrorText error={events.error} />
      <ul className="mt-1">
        {events.data?.map((e) => (
          <EventItem key={e._id} event={e} />
        ))}
      </ul>
    </details>
  );
}

/** Journal du board, filtrable par type d'événement et par auteur, chargé par pages. */
export function BoardJournal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, openTask } = useBoard();
  const [type, setType] = useState('');
  const [actorId, setActorId] = useState('');
  const journal = useInfiniteQuery({
    queryKey: ['journal', data.board._id, type, actorId],
    enabled: open,
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api<{ events: TaskEvent[]; taskNames: Record<string, string> }>(
        `/boards/${data.board._id}/events?${new URLSearchParams({
          limit: '50',
          ...(type ? { type } : {}),
          ...(actorId ? { actorId } : {}),
          ...(pageParam ? { before: pageParam } : {}),
        })}`,
      ),
    getNextPageParam: (last) => (last.events.length === 50 ? last.events.at(-1)!.at : undefined),
  });
  const pages = journal.data?.pages ?? [];
  return (
    <Modal open={open} onClose={onClose} title={t('history.journal')} wide>
      <div className="mb-3 flex flex-wrap gap-2">
        <select
          className={`${input} w-56`}
          aria-label={t('history.filterType')}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">{t('history.allTypes')}</option>
          {EVENT_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`history.types.${x}`)}
            </option>
          ))}
        </select>
        <select
          className={`${input} w-56`}
          aria-label={t('history.filterActor')}
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
        >
          <option value="">{t('history.allActors')}</option>
          {data.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.fullName}
            </option>
          ))}
        </select>
      </div>
      <ErrorText error={journal.error} />
      {pages.length > 0 && pages[0].events.length === 0 && (
        <p className="text-sm text-muted">{t('history.empty')}</p>
      )}
      <ul>
        {pages.flatMap((p) =>
          p.events.map((e) => (
            <EventItem
              key={e._id}
              event={e}
              taskName={e.taskId ? (p.taskNames[e.taskId] ?? '') : ''}
              onOpen={
                e.taskId && data.tasks.some((x) => x._id === e.taskId) ? () => openTask(e.taskId!) : undefined
              }
            />
          )),
        )}
      </ul>
      {journal.hasNextPage && (
        <button
          type="button"
          className={btn}
          disabled={journal.isFetchingNextPage}
          onClick={() => void journal.fetchNextPage()}
        >
          {t('history.more')}
        </button>
      )}
    </Modal>
  );
}
