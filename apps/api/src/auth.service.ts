import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { CreateUserInput } from '@flowboard/shared';
import { config } from './config';
import { Db, PublicUser, Session, User } from './db';
import { fail } from './errors';

export const SESSION_COOKIE = 'fb_session';
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hidePassword = { projection: { passwordHash: 0 } } as const;
// Haché factice : un identifiant inconnu coûte le même temps qu'un mauvais mot de passe.
const dummyHash = hash('flowboard-dummy-password');

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  constructor(private db: Db) {}

  /** Premier lancement (spec § 4.1) : admin créé depuis l'environnement, sinon refus de démarrer. */
  async onApplicationBootstrap() {
    if (await this.db.users.countDocuments({}, { limit: 1 })) return;
    const { ADMIN_USERNAME, ADMIN_PASSWORD } = config;
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD)
      throw new Error(
        'Base vide : définissez ADMIN_USERNAME et ADMIN_PASSWORD (10 caractères minimum) pour créer le premier administrateur.',
      );
    const input = CreateUserInput.safeParse({
      username: ADMIN_USERNAME,
      fullName: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      globalRole: 'admin',
    });
    if (!input.success) throw new Error(`ADMIN_USERNAME / ADMIN_PASSWORD invalides : ${input.error.message}`);
    await this.createUser(input.data);
  }

  async createUser(input: CreateUserInput): Promise<PublicUser> {
    const user: User = {
      _id: randomUUID(),
      username: input.username,
      fullName: input.fullName,
      email: input.email ?? null,
      passwordHash: await hash(input.password),
      globalRole: input.globalRole,
      status: 'active',
      mustChangePassword: true,
      locale: null,
      timezone: null,
      theme: 'system',
      collapsedColumns: [],
      createdAt: new Date(),
      lastLoginAt: null,
    };
    try {
      await this.db.users.insertOne(user);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) fail(409, 'USERNAME_TAKEN');
      throw e;
    }
    const { passwordHash: _, ...pub } = user;
    return pub;
  }

  async login(username: string, password: string, ip: string, userAgent: string) {
    const key = `${username}|${ip}`;
    const attempt = await this.db.loginAttempts.findOne({ _id: key });
    if (attempt && attempt.count >= MAX_FAILURES) fail(429, 'TOO_MANY_ATTEMPTS');

    const user = await this.db.users.findOne({ username });
    const ok = user ? await verify(user.passwordHash, password) : (await verify(await dummyHash, password), false);
    if (!user || !ok || user.status !== 'active') {
      await this.db.loginAttempts.updateOne(
        { _id: key },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + LOCK_MS) } },
        { upsert: true },
      );
      fail(401, 'INVALID_CREDENTIALS', 'Identifiant ou mot de passe incorrect');
    }
    await this.db.loginAttempts.deleteOne({ _id: key });
    await this.db.users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    return this.createSession(user._id, ip, userAgent);
  }

  async createSession(userId: string, ip: string, userAgent: string) {
    const token = randomBytes(32).toString('base64url');
    const session: Session = {
      _id: sha256(token),
      userId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + config.SESSION_DAYS * DAY_MS),
      ip,
      userAgent: userAgent.slice(0, 300),
    };
    await this.db.sessions.insertOne(session);
    return { token, session };
  }

  /** Session valide + expiration glissante (prolongée au plus une fois par heure). */
  async resolveSession(token: string) {
    const session = await this.db.sessions.findOne({ _id: sha256(token), expiresAt: { $gt: new Date() } });
    if (!session) return null;
    const user = await this.db.users.findOne({ _id: session.userId, status: 'active' }, hidePassword);
    if (!user) return null;
    const target = Date.now() + config.SESSION_DAYS * DAY_MS;
    const extended = target - session.expiresAt.getTime() > 3_600_000;
    if (extended) {
      session.expiresAt = new Date(target);
      await this.db.sessions.updateOne({ _id: session._id }, { $set: { expiresAt: session.expiresAt } });
    }
    return { session, user: user as PublicUser, extended };
  }

  setCookie(res: Response, token: string, expires: Date) {
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax', expires, path: '/' });
  }

  async logout(sessionId: string) {
    await this.db.sessions.deleteOne({ _id: sessionId });
  }

  /** Exige le mot de passe actuel ; invalide toutes les autres sessions. */
  async changePassword(userId: string, sessionId: string, current: string, next: string) {
    const user = await this.db.users.findOne({ _id: userId });
    if (!user || !(await verify(user.passwordHash, current))) fail(400, 'WRONG_PASSWORD');
    if (current === next) fail(400, 'SAME_PASSWORD');
    await this.db.users.updateOne({ _id: userId }, { $set: { passwordHash: await hash(next), mustChangePassword: false } });
    await this.db.sessions.deleteMany({ userId, _id: { $ne: sessionId } });
  }

  /** Réinitialisation par l'admin : mot de passe temporaire, changement forcé, sessions révoquées. */
  async resetPassword(userId: string) {
    const temporaryPassword = randomBytes(12).toString('base64url');
    const r = await this.db.users.updateOne(
      { _id: userId },
      { $set: { passwordHash: await hash(temporaryPassword), mustChangePassword: true } },
    );
    if (!r.matchedCount) fail(404, 'NOT_FOUND');
    await this.revokeAll(userId);
    return temporaryPassword;
  }

  revokeAll(userId: string) {
    return this.db.sessions.deleteMany({ userId });
  }
}
