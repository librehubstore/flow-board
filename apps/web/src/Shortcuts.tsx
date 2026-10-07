import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './lib';

const click = (selector: string) => document.querySelector<HTMLElement>(selector)?.click();

/** Focus sur la première carte de la colonne voisine de celle qui a le focus. */
function moveColumn(step: -1 | 1) {
  const groups = [...document.querySelectorAll<HTMLElement>('[role="group"][aria-label]')].filter((g) =>
    g.querySelector('[data-handle]'),
  );
  const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[role="group"]');
  const index = current ? groups.indexOf(current) : -1;
  const target = groups[index === -1 ? 0 : Math.min(groups.length - 1, Math.max(0, index + step))];
  target?.querySelector<HTMLElement>('[data-handle]')?.focus();
}

/**
 * Raccourcis globaux (spec § 4.12), ignorés pendant une saisie.
 * `/` ou Ctrl+K : recherche · `n` : nouvelle tâche · `f` : filtre · `t` : minuteur · `[` `]` : colonnes · `?` : aide.
 */
export function useShortcuts(openSearch: () => void) {
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        return openSearch();
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      const actions: Record<string, () => void> = {
        '/': openSearch,
        '?': () => setHelp(true),
        n: () => click('[data-new-task]'),
        f: () => document.querySelector<HTMLElement>('[data-filter-input]')?.focus(),
        t: () => click('[data-timer-action]'),
        '[': () => moveColumn(-1),
        ']': () => moveColumn(1),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [openSearch]);
  return { help, closeHelp: () => setHelp(false) };
}

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    ['?', t('shortcuts.help')],
    ['/ · Ctrl+K', t('shortcuts.search')],
    ['n', t('shortcuts.newTask')],
    ['f', t('shortcuts.filter')],
    ['t', t('shortcuts.timer')],
    ['[ · ]', t('shortcuts.columns')],
    [t('shortcuts.keys.space'), t('shortcuts.dnd')],
    [t('shortcuts.keys.enter'), t('shortcuts.open')],
    [t('shortcuts.keys.escape'), t('shortcuts.close')],
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('shortcuts.title')}>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([keys, label]) => (
            <tr key={keys} className="border-t border-line first:border-0">
              <td className="py-1.5 pr-4">
                <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
                  {keys}
                </kbd>
              </td>
              <td className="py-1.5">{label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
