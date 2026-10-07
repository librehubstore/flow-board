/**
 * CSV lisible par Excel en français : séparateur « ; », BOM UTF-8 pour les accents.
 * Les cellules commençant par = + - @ sont préfixées d'une apostrophe (injection de formule).
 */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

/** Durée en heures décimales (2 décimales, virgule française) pour les tableurs. */
export const hours = (seconds: number) => (seconds / 3600).toFixed(2).replace('.', ',');
