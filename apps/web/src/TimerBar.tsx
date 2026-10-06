import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DEFAULT_POMODORO, INTERRUPTION_REASONS, type InterruptInput } from '@flowboard/shared';
import { api } from './api';
import { btn, btnGhost, btnPrimary, cx, input, useErrorText, useMe } from './lib';
import { getSocket } from './socket';

export interface TimerView {
  kind: 'pomodoro' | 'stopwatch';
  phase: 'work' | 'shortBreak' | 'longBreak';
  taskId: string;
  boardId: string;
  taskName: string;
  startedAt: string;
  endsAt: string | null;
  partStartedAt: string;
  cycle: number;
}
interface TimerState {
  timer: TimerView | null;
  serverNow: string;
}

/** Minuteur global de l'utilisateur, synchronisé en temps réel entre ses appareils. */
export function useTimer() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['timer'],
    queryFn: async () => {
      const state = await api<TimerState>('/timer');
      return { ...state, offset: Date.parse(state.serverNow) - Date.now() };
    },
  });
  useEffect(() => {
    const socket = getSocket();
    const onTimer = (state: TimerState) =>
      qc.setQueryData(['timer'], { ...state, offset: Date.parse(state.serverNow) - Date.now() });
    socket.on('timer', onTimer);
    return () => {
      socket.off('timer', onTimer);
    };
  }, [qc]);
  const action = useMutation({
    mutationFn: (v: { path: string; body?: object }) =>
      api<TimerState>(`/timer/${v.path}`, { method: 'POST', body: v.body ?? {} }),
    onSuccess: (state) =>
      qc.setQueryData(['timer'], { ...state, offset: Date.parse(state.serverNow) - Date.now() }),
  });
  return {
    timer: query.data?.timer ?? null,
    offset: query.data?.offset ?? 0,
    action,
    refetch: query.refetch,
  };
}

/** Bip court par Web Audio : pas de fichier son à charger. */
function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Audio indisponible (politique d'autoplay) : la notification visuelle suffit.
  }
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** Barre compacte et non bloquante, visible seulement quand un minuteur tourne (spec § 4.6). */
export function TimerBar() {
  const { t } = useTranslation();
  const me = useMe().data!;
  const settings = { ...DEFAULT_POMODORO, ...me.pomodoro };
  const errorText = useErrorText();
  const { timer, offset, action, refetch } = useTimer();
  const [now, setNow] = useState(() => Date.now());
  const [interrupting, setInterrupting] = useState(false);
  const [reason, setReason] = useState<InterruptInput>({ reason: 'internal', comment: '' });
  const notified = useRef<string | null>(null);

  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const serverNow = now + offset;
  const remaining = timer?.endsAt ? Date.parse(timer.endsAt) - serverNow : null;

  // Fin de phase : le serveur applique la transition à la lecture ; son et notification une seule fois.
  useEffect(() => {
    if (!timer?.endsAt || remaining === null || remaining > 0 || notified.current === timer.endsAt) return;
    notified.current = timer.endsAt;
    if (settings.sound) beep();
    if (settings.notify && 'Notification' in window && Notification.permission === 'granted')
      new Notification(t(timer.phase === 'work' ? 'timer.workDone' : 'timer.breakDone'), {
        body: timer.taskName,
      });
    void refetch();
  }, [timer, remaining, settings.sound, settings.notify, refetch, t]);

  if (!timer) return null;
  const running = timer.kind === 'stopwatch' ? serverNow - Date.parse(timer.startedAt) : (remaining ?? 0);
  const label =
    timer.kind === 'stopwatch'
      ? t('timer.stopwatch')
      : timer.phase === 'work'
        ? t('timer.pomodoro')
        : t(`timer.${timer.phase}`);

  return (
    <div
      role="timer"
      aria-label={label}
      className={cx(
        'no-print flex flex-wrap items-center gap-2 border-b border-line px-4 py-1.5 text-sm',
        timer.phase === 'work' ? 'bg-accent/10' : 'bg-ok/10',
      )}
    >
      <span aria-hidden>{timer.kind === 'stopwatch' ? '⏱' : timer.phase === 'work' ? '🍅' : '☕'}</span>
      <strong>{label}</strong>
      <span className="font-mono tabular-nums">{clock(running)}</span>
      {timer.phase === 'work' && (
        <Link to={`/boards/${timer.boardId}?task=${timer.taskId}`} className="min-w-0 truncate underline">
          {timer.taskName}
        </Link>
      )}
      <span className="ml-auto flex items-center gap-1">
        {timer.kind === 'pomodoro' && timer.phase === 'work' ? (
          <button type="button" className={btn} onClick={() => setInterrupting((v) => !v)} data-timer-action>
            {t('timer.interrupt')}
          </button>
        ) : (
          <button
            type="button"
            className={btn}
            onClick={() => action.mutate({ path: 'stop' })}
            data-timer-action
          >
            {timer.kind === 'stopwatch' ? t('timer.stop') : t('timer.skipBreak')}
          </button>
        )}
      </span>
      {interrupting && (
        <form
          className="flex w-full flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate({ path: 'interrupt', body: reason }, { onSuccess: () => setInterrupting(false) });
          }}
        >
          <select
            className={`${input} w-40`}
            aria-label={t('timer.reason')}
            value={reason.reason}
            onChange={(e) => setReason({ ...reason, reason: e.target.value as InterruptInput['reason'] })}
          >
            {INTERRUPTION_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`timer.reasons.${r}`)}
              </option>
            ))}
          </select>
          <input
            className={`${input} flex-1`}
            aria-label={t('timer.reasonComment')}
            placeholder={t('timer.reasonComment')}
            maxLength={200}
            value={reason.comment}
            onChange={(e) => setReason({ ...reason, comment: e.target.value })}
          />
          <button className={btnPrimary}>{t('common.confirm')}</button>
          <button type="button" className={btnGhost} onClick={() => setInterrupting(false)}>
            {t('common.cancel')}
          </button>
        </form>
      )}
      {action.error && <p className="w-full text-xs text-danger">{errorText(action.error)}</p>}
    </div>
  );
}
