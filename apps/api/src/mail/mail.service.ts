import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config/config';

export interface Mail {
  to: string;
  toName: string;
  subject: string;
  html: string;
  text: string;
}

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Emails transactionnels par l'API Brevo (validation du compte, accueil).
 * Sans BREVO_API_KEY (développement, tests) : rien n'est envoyé, l'email est journalisé et gardé dans `sent`.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  /** Emails « envoyés » sans Brevo : consultables par les tests. */
  readonly sent: Mail[] = [];

  async send(mail: Mail, senderName: string) {
    if (!config.BREVO_API_KEY) {
      this.sent.push(mail);
      this.logger.log(
        `[email non envoyé : BREVO_API_KEY absente] À ${mail.to} — ${mail.subject}\n${mail.text}`,
      );
      return;
    }
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': config.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: config.MAIL_FROM_EMAIL, name: config.MAIL_FROM_NAME ?? senderName },
        to: [{ email: mail.to, name: mail.toName }],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
      }),
    });
    if (!res.ok) {
      // L'appelant décide : une inscription échoue si l'email de validation ne part pas.
      const body = await res.text().catch(() => '');
      this.logger.error(`Brevo ${res.status} pour ${mail.to} : ${body.slice(0, 300)}`);
      throw new Error(`Envoi d'email impossible (Brevo ${res.status})`);
    }
  }
}
