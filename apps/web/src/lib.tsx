import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Color } from '@flowboard/shared';
import { api, ApiError, type DirectoryUser, type Settings, type User } from './api';
import fr from './locales/fr';
import en from './locales/en';

void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: navigator.language.startsWith('fr') ? 'fr' : 'en',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});
export { i18n };

// ---------- Données communes ----------
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me'), retry: false });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings'), staleTime: 60_000 });
export const useDirectory = () =>
  useQuery({ queryKey: ['users'], queryFn: () => api<DirectoryUser[]>('/users'), staleTime: 60_000 });

/** Fuseau d'affichage : profil, sinon instance, sinon navigateur. */
export function useTimeZone(): string {
  const me = useMe().data;
  const settings = useSettings().data;
  return me?.timezone || settings?.defaultTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) =>
    e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message || t('errors.generic') }) : t('errors.generic');
}

// ---------- Dates et fuseaux (sans bibliothèque) ----------
function parts(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => p.find((x) => x.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Instant UTC → { date: AAAA-MM-JJ, time: HH:MM } dans le fuseau. */
export const toZoned = (iso: string, timeZone: string) => parts(new Date(iso), timeZone);

/** Date + heure murales dans un fuseau → instant UTC (ISO). */
export function fromZoned(date: string, time: string, timeZone: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  const shown = parts(guess, timeZone);
  const offset = new Date(`${shown.date}T${shown.time}:00Z`).getTime() - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

export function formatDate(iso: string, locale: string, timeZone: string, withTime = false) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso));
}

/** Échéance : sans heure, la date est stockée à minuit UTC et affichée telle quelle. */
export function formatDue(dueAt: string, hasTime: boolean, locale: string, timeZone: string) {
  return formatDate(dueAt, locale, hasTime ? timeZone : 'UTC', hasTime);
}

export function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}` : `${m} min`;
}

// ---------- Couleurs de tâche ----------
export const COLOR_HEX: Record<Color, string> = {
  yellow: '#e8c32e',
  white: '#c9ced6',
  red: '#d9434b',
  green: '#3a9d5d',
  blue: '#3b76d9',
  purple: '#8455c8',
  orange: '#e57d2c',
  cyan: '#2aa5b8',
  brown: '#8b5e3c',
  magenta: '#c43f9a',
};

// ---------- Composants de base ----------
export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export const btn =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed';
export const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed';
export const btnGhost =
  'inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-fg';
export const btnDanger =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger hover:text-white disabled:opacity-50';
export const input =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none';
export const card = 'rounded-lg border border-line bg-surface';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const text = useErrorText();
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {text(error)}
    </p>
  );
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hash} 45% 45%)` }}
    >
      {initials}
    </span>
  );
}

/** Fenêtre modale sur l'élément natif <dialog> : focus piégé, Échap et arrière-plan inerte fournis par le navigateur. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={cx(
        'm-auto max-h-[92vh] w-[calc(100%-1.5rem)] overflow-auto rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl',
        wide ? 'max-w-4xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" className={btnGhost} onClick={onClose} aria-label={t('common.close')}>
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
