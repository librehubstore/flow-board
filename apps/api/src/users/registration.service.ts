import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { isDomainAllowed, type RegisterInput } from '@flowboard/shared';
import { AuthService } from '../auth/auth.service';
import { fail } from '../common/errors';
import { config } from '../config/config';
import { Db } from '../database/db.service';
import type { Mail } from '../mail/mail.service';
import { MailService } from '../mail/mail.service';
import { verificationMail, welcomeMail } from '../mail/templates';
import type { Settings } from '../settings/settings.entity';
import { SettingsService } from '../settings/settings.service';
import { hidePassword, type PublicUser } from './user.entity';
import { UsersService } from './users.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const HOUR = 3_600_000;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const OAUTH_COOKIE = 'fb_oauth';

/** Revendications de l'ID token Google utilisées ici. */
interface GoogleClaims {
  iss: string;
  aud: string;
  exp: number;
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/**
 * Onboarding en libre-service (paramètre d'instance `onboarding = open`) :
 * inscription email + mot de passe avec validation par email, ou compte Google ; email d'accueil (Brevo).
 * En mode `admin`, aucune inscription : seule la connexion Google d'un compte existant reste possible.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private db: Db,
    private users: UsersService,
    private auth: AuthService,
    private settings: SettingsService,
    private mail: MailService,
  ) {}

  // ---------- Email + mot de passe ----------

  /**
   * Crée un compte en attente et envoie le lien de validation. Réponse identique que l'email soit nouveau ou non
   * (pas d'énumération des comptes) ; un compte déjà en attente reçoit un nouveau lien.
   */
  async assertOpen() {
    const s = await this.settings.get();
    if (s.onboarding !== 'open' || !s.registration.password) fail(404, 'NOT_FOUND');
    return s;
  }

  async register(input: RegisterInput, ip: string) {
    const s = await this.assertOpen();
    await this.auth.throttle(`register|${ip}`, 10, HOUR);
    if (!isDomainAllowed(input.email, s.allowedDomains)) fail(400, 'DOMAIN_NOT_ALLOWED');

    const existing = await this.db.users.findOne({ email: input.email }, hidePassword);
    if (existing) {
      if (existing.status === 'pending') await this.sendVerification(existing as PublicUser, s);
      return;
    }
    const user = await this.users.insert({
      username: await this.users.usernameFor(input.email),
      fullName: input.fullName,
      email: input.email,
      passwordHash: await this.auth.hashPassword(input.password),
      globalRole: 'user',
      status: 'pending',
      mustChangePassword: false,
      emailVerified: false,
    });
    await this.sendVerification(user, s);
  }

  async resend(email: string, ip: string) {
    await this.auth.throttle(`resend|${ip}`, 5, HOUR);
    const user = await this.db.users.findOne({ email, status: 'pending' }, hidePassword);
    if (user) await this.sendVerification(user as PublicUser, await this.settings.get());
  }

  /** Lien de validation : active le compte, envoie l'email d'accueil et ouvre une session. */
  async verify(token: string, ip: string, userAgent: string) {
    const doc = await this.db.emailTokens.findOneAndDelete({
      _id: sha256(token),
      purpose: 'verify',
      expiresAt: { $gt: new Date() },
    });
    if (!doc) fail(400, 'INVALID_TOKEN');
    const user = await this.db.users.findOneAndUpdate(
      { _id: doc.userId, status: 'pending' },
      { $set: { status: 'active', emailVerified: true } },
      { returnDocument: 'after', projection: { passwordHash: 0 } },
    );
    if (!user) fail(400, 'INVALID_TOKEN');
    await this.sendWelcome(user as PublicUser);
    return this.auth.createSession(user._id, ip, userAgent);
  }

  private async sendVerification(user: PublicUser, s: Settings) {
    const token = randomBytes(32).toString('base64url');
    await this.db.emailTokens.deleteMany({ userId: user._id, purpose: 'verify' });
    await this.db.emailTokens.insertOne({
      _id: sha256(token),
      userId: user._id,
      purpose: 'verify',
      expiresAt: new Date(Date.now() + 24 * HOUR),
    });
    const url = `${config.APP_URL}/verify-email?token=${token}`;
    await this.deliver(
      verificationMail({ email: user.email!, name: user.fullName }, s.instanceName, s.defaultLocale, url),
      s,
    );
  }

  private async sendWelcome(user: PublicUser) {
    const s = await this.settings.get();
    const locale = user.locale ?? s.defaultLocale;
    await this.deliver(
      welcomeMail({ email: user.email!, name: user.fullName }, s.instanceName, locale, `${config.APP_URL}/`),
      s,
    );
  }

  /** Un échec d'envoi est journalisé sans bloquer : l'utilisateur peut redemander le lien. */
  private async deliver(mail: Mail, s: Settings) {
    try {
      await this.mail.send(mail, s.instanceName);
    } catch (e) {
      this.logger.error(`Email « ${mail.subject} » non envoyé à ${mail.to} : ${(e as Error).message}`);
    }
  }

  // ---------- Google (OAuth 2.0 / OpenID Connect, code + PKCE) ----------

  /** Google est proposé s'il est configuré côté serveur et activé dans les paramètres d'instance. */
  googleEnabled(s: Settings) {
    return !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && s.registration.google);
  }

  private get redirectUri() {
    return `${config.APP_URL}/api/auth/google/callback`;
  }

  /** URL d'autorisation Google ; `state` et le vérificateur PKCE sont gardés dans un cookie court. */
  async googleStart() {
    if (!this.googleEnabled(await this.settings.get())) fail(404, 'NOT_FOUND');
    const state = randomBytes(16).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const url = `${GOOGLE_AUTH_URL}?${new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID!,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })}`;
    return { url, cookie: `${state}.${verifier}` };
  }

  /**
   * Retour de Google : vérifie `state`, échange le code, puis connecte (compte lié par Google ou par email vérifié)
   * ou inscrit (mode `open`). Renvoie une session, ou un code d'erreur affiché sur l'écran de connexion.
   */
  async googleCallback(
    q: { code?: string; state?: string; error?: string },
    cookie: string | undefined,
    ip: string,
    userAgent: string,
  ): Promise<{ token: string; session: { expiresAt: Date } } | { error: string }> {
    const s = await this.settings.get();
    if (!this.googleEnabled(s)) return { error: 'GOOGLE_UNAVAILABLE' };
    const [state, verifier] = (cookie ?? '').split('.');
    if (q.error) return { error: 'GOOGLE_CANCELLED' };
    if (!q.code || !state || q.state !== state) return { error: 'GOOGLE_STATE' };

    const claims = await this.exchange(q.code, verifier);
    if (!claims?.email || !claims.email_verified) return { error: 'GOOGLE_FAILED' };
    const email = claims.email.toLowerCase();

    const linked = { returnDocument: 'after' as const, projection: { passwordHash: 0 } };
    let user = (await this.db.users.findOne({ googleId: claims.sub }, hidePassword)) as PublicUser | null;
    if (!user) {
      // Compte existant avec le même email (vérifié par Google) : liaison, et activation s'il était en attente.
      user = (await this.db.users.findOneAndUpdate(
        { email },
        { $set: { googleId: claims.sub, emailVerified: true } },
        linked,
      )) as PublicUser | null;
      if (user?.status === 'pending')
        user = (await this.db.users.findOneAndUpdate(
          { _id: user._id },
          { $set: { status: 'active' } },
          linked,
        )) as PublicUser | null;
    }
    if (!user) {
      if (s.onboarding !== 'open') return { error: 'REGISTRATION_CLOSED' };
      if (!isDomainAllowed(email, s.allowedDomains)) return { error: 'DOMAIN_NOT_ALLOWED' };
      user = await this.users.insert({
        username: await this.users.usernameFor(email),
        fullName: claims.name?.trim() || email.split('@')[0],
        email,
        passwordHash: null,
        globalRole: 'user',
        status: 'active',
        mustChangePassword: false,
        emailVerified: true,
        googleId: claims.sub,
      });
      await this.sendWelcome(user);
    }
    if (user.status !== 'active') return { error: 'ACCOUNT_DISABLED' };
    await this.db.users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    return this.auth.createSession(user._id, ip, userAgent);
  }

  /**
   * Échange du code contre l'ID token. Reçu directement de Google par TLS avec notre secret, son émetteur est
   * authentifié par le canal (OIDC Core § 3.1.3.7) : on contrôle émetteur, audience et expiration sans JWKS.
   */
  private async exchange(code: string, verifier: string | undefined): Promise<GoogleClaims | null> {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.GOOGLE_CLIENT_ID!,
        client_secret: config.GOOGLE_CLIENT_SECRET!,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
        ...(verifier ? { code_verifier: verifier } : {}),
      }),
    });
    if (!res.ok) {
      this.logger.warn(`Échange du code Google refusé (${res.status})`);
      return null;
    }
    const { id_token } = (await res.json()) as { id_token?: string };
    const payload = id_token?.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GoogleClaims;
    const issuerOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    if (!issuerOk || claims.aud !== config.GOOGLE_CLIENT_ID || claims.exp * 1000 < Date.now()) return null;
    return claims;
  }
}
