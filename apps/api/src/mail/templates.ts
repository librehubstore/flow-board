import type { Mail } from './mail.service';

/** Échappement HTML des valeurs saisies par l'utilisateur (nom) ou l'admin (nom de l'instance). */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Gabarit commun, compatible avec les clients mail (tableaux, styles en ligne, pas de CSS externe). */
function layout(instance: string, title: string, body: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="background:#2457d6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1d23">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;border:1px solid #d9dde3">
<tr><td style="padding:28px 32px">
<p style="margin:0 0 20px;font-weight:700;font-size:18px">${esc(instance)}</p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(title)}</h1>
${body}${button}
</td></tr></table></td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 12px;line-height:1.5">${html}</p>`;

const TEXTS = {
  fr: {
    verifySubject: (i: string) => `Confirmez votre adresse email — ${i}`,
    verifyTitle: 'Confirmez votre adresse email',
    verifyBody: (name: string, i: string) =>
      `Bonjour ${name},\n\nVous venez de créer un compte sur ${i}. Confirmez votre adresse email pour l'activer (lien valable 24 heures) :`,
    verifyCta: 'Activer mon compte',
    verifyIgnore:
      "Si vous n'êtes pas à l'origine de cette inscription, ignorez cet email : le compte ne sera pas activé.",
    welcomeSubject: (i: string) => `Bienvenue sur ${i}`,
    welcomeTitle: (i: string) => `Bienvenue sur ${i} !`,
    welcomeBody: (name: string, i: string) =>
      `Bonjour ${name},\n\nVotre compte ${i} est actif. Créez votre premier board, ajoutez vos tâches et invitez votre équipe.`,
    welcomeCta: 'Ouvrir mon espace',
  },
  en: {
    verifySubject: (i: string) => `Confirm your email address — ${i}`,
    verifyTitle: 'Confirm your email address',
    verifyBody: (name: string, i: string) =>
      `Hello ${name},\n\nYou just created an account on ${i}. Confirm your email address to activate it (link valid for 24 hours):`,
    verifyCta: 'Activate my account',
    verifyIgnore: "If you did not sign up, ignore this email: the account won't be activated.",
    welcomeSubject: (i: string) => `Welcome to ${i}`,
    welcomeTitle: (i: string) => `Welcome to ${i}!`,
    welcomeBody: (name: string, i: string) =>
      `Hello ${name},\n\nYour ${i} account is active. Create your first board, add your tasks and invite your team.`,
    welcomeCta: 'Open my workspace',
  },
};

const html = (text: string) =>
  text
    .split('\n\n')
    .map((para) => p(esc(para)))
    .join('');

export function verificationMail(
  to: { email: string; name: string },
  instance: string,
  locale: 'fr' | 'en',
  url: string,
): Mail {
  const t = TEXTS[locale];
  return {
    to: to.email,
    toName: to.name,
    subject: t.verifySubject(instance),
    html: layout(instance, t.verifyTitle, html(t.verifyBody(to.name, instance)), { label: t.verifyCta, url }),
    text: `${t.verifyBody(to.name, instance)}\n${url}\n\n${t.verifyIgnore}`,
  };
}

export function welcomeMail(
  to: { email: string; name: string },
  instance: string,
  locale: 'fr' | 'en',
  url: string,
): Mail {
  const t = TEXTS[locale];
  return {
    to: to.email,
    toName: to.name,
    subject: t.welcomeSubject(instance),
    html: layout(instance, t.welcomeTitle(instance), html(t.welcomeBody(to.name, instance)), {
      label: t.welcomeCta,
      url,
    }),
    text: `${t.welcomeBody(to.name, instance)}\n${url}`,
  };
}
