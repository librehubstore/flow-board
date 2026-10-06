import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { config } from '../config/config';
import { fail } from '../common/errors';
import { Db } from '../database/db.service';
import { hidePassword, type PublicUser } from '../users/user.entity';
import type { Session } from './session.entity';

export const SESSION_COOKIE = 'fb_session';
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
// Haché factice : un identifiant inconnu coûte le même temps qu'un mauvais mot de passe.
const dummyHash = hash('flowboard-dummy-password');

/** Identifiants et sessions (spec § 4.1) : hachage Argon2id, sessions révocables en base, limitation des tentatives. */
@Injectable()
export class AuthService {
  constructor(private db: Db) {}

  hashPassword(password: string) {
    return hash(password);
  }

  async login(username: string, password: string, ip: string, userAgent: string) {
    const key = `${username}|${ip}`;
    const attempt = await this.db.loginAttempts.findOne({ _id: key });
    if (attempt && attempt.count >= MAX_FAILURES) fail(429, 'TOO_MANY_ATTEMPTS');

    const user = await this.db.users.findOne(username.includes('@') ? { email: username } : { username });
    // Compte inconnu ou sans mot de passe (créé par Google) : même coût et même réponse qu'un mauvais mot de passe.
    const ok = user?.passwordHash
      ? await verify(user.passwordHash, password)
      : (await verify(await dummyHash, password), false);
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

  /** Limiteur générique (inscription, renvoi d'email) : au plus `max` appels par fenêtre, par clé. */
  async throttle(key: string, max: number, windowMs: number) {
    const r = await this.db.loginAttempts.findOneAndUpdate(
      { _id: key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + windowMs) } },
      { upsert: true, returnDocument: 'after' },
    );
    if (r && r.count > max) fail(429, 'TOO_MANY_ATTEMPTS');
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
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: 'lax',
      expires,
      path: '/',
    });
  }

  async logout(sessionId: string) {
    await this.db.sessions.deleteOne({ _id: sessionId });
  }

  /** Exige le mot de passe actuel ; invalide toutes les autres sessions. */
  async changePassword(userId: string, sessionId: string, current: string, next: string) {
    const user = await this.db.users.findOne({ _id: userId });
    if (!user?.passwordHash || !(await verify(user.passwordHash, current))) fail(400, 'WRONG_PASSWORD');
    if (current === next) fail(400, 'SAME_PASSWORD');
    await this.db.users.updateOne(
      { _id: userId },
      { $set: { passwordHash: await hash(next), mustChangePassword: false } },
    );
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
