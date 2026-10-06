import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateUserInput,
  type BoardFilter,
  type UpdateProfileInput,
  type UpdateUserInput,
} from '@flowboard/shared';
import { AuthService } from '../auth/auth.service';
import { fail } from '../common/errors';
import { config } from '../config/config';
import { Db } from '../database/db.service';
import { Realtime } from '../realtime/realtime.service';
import { hidePassword, type PublicUser, type User } from './user.entity';

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private db: Db,
    private auth: AuthService,
    private realtime: Realtime,
  ) {}

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
    await this.create(input.data);
    this.logger.log(`Premier administrateur « ${input.data.username} » créé`);
  }

  /** Identifiant libre dérivé d'un email (`jean.dupont`, puis `jean.dupont-2`…). */
  async usernameFor(email: string) {
    let base = email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 40);
    if (base.length < 3) base = `${base}user`.slice(0, 40);
    for (let i = 1; i < 1000; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      if (!(await this.db.users.countDocuments({ username: candidate }, { limit: 1 }))) return candidate;
    }
    return `${base}-${randomUUID().slice(0, 8)}`;
  }

  get(id: string) {
    return this.db.users.findOne({ _id: id }, hidePassword) as Promise<PublicUser | null>;
  }

  list() {
    return this.db.users.find({}, hidePassword).sort({ status: 1, fullName: 1 }).toArray();
  }

  /** Annuaire minimal pour choisir des membres (id, identifiant, nom). */
  directory() {
    return this.db.users
      .find()
      .project({ username: 1, fullName: 1, status: 1 })
      .sort({ fullName: 1 })
      .toArray();
  }

  /** Compte créé par un administrateur : mot de passe initial à changer à la première connexion. */
  async create(input: CreateUserInput): Promise<PublicUser> {
    return this.insert({
      username: input.username,
      fullName: input.fullName,
      email: input.email ?? null,
      passwordHash: await this.auth.hashPassword(input.password),
      globalRole: input.globalRole,
      status: 'active',
      mustChangePassword: true,
    });
  }

  /** Insertion commune (administration, inscription, Google) ; identifiant ou email déjà pris → 409. */
  async insert(
    fields: Pick<
      User,
      'username' | 'fullName' | 'email' | 'passwordHash' | 'globalRole' | 'status' | 'mustChangePassword'
    > &
      Partial<Pick<User, 'emailVerified' | 'googleId'>>,
  ): Promise<PublicUser> {
    const user: User = {
      _id: randomUUID(),
      ...fields,
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
      const err = e as { code?: number; keyPattern?: Record<string, unknown> };
      if (err.code === 11000) fail(409, err.keyPattern?.email ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN');
      throw e;
    }
    const { passwordHash: _, ...pub } = user;
    return pub;
  }

  /** Modification par l'admin ; il doit toujours rester au moins un administrateur actif (spec § 4.1). */
  async update(id: string, input: UpdateUserInput) {
    const target = await this.get(id);
    if (!target) fail(404, 'NOT_FOUND');
    const losesAdmin =
      target.globalRole === 'admin' &&
      target.status === 'active' &&
      (input.globalRole === 'user' || input.status === 'disabled');
    // ponytail: vérification non atomique ; deux rétrogradations simultanées pourraient passer, risque négligeable en usage interne.
    if (
      losesAdmin &&
      !(await this.db.users.countDocuments({ _id: { $ne: id }, globalRole: 'admin', status: 'active' }))
    )
      fail(409, 'LAST_ADMIN');
    await this.db.users.updateOne({ _id: id }, { $set: input });
    if (input.status === 'disabled') {
      await this.auth.revokeAll(id);
      this.realtime.kick(id);
    }
    return this.get(id);
  }

  async updateProfile(id: string, input: UpdateProfileInput) {
    const { pomodoro, ...fields } = input;
    const set: Record<string, unknown> = { ...fields };
    for (const [k, v] of Object.entries(pomodoro ?? {})) set[`pomodoro.${k}`] = v;
    await this.db.users.updateOne({ _id: id }, { $set: set });
    return this.get(id);
  }

  /** Filtre de board mémorisé ; un filtre vide est supprimé. */
  async setBoardFilter(id: string, boardId: string, filter: BoardFilter | null) {
    await this.db.users.updateOne(
      { _id: id },
      filter
        ? { $set: { [`boardFilters.${boardId}`]: filter } }
        : { $unset: { [`boardFilters.${boardId}`]: '' } },
    );
  }

  /** Colonnes suivies : notification quand une tâche y entre (spec § 4.2). */
  async setWatched(id: string, columnId: string, watched: boolean) {
    await this.db.users.updateOne(
      { _id: id },
      watched ? { $addToSet: { watchedColumns: columnId } } : { $pull: { watchedColumns: columnId } },
    );
  }

  /** État replié des colonnes, mémorisé par utilisateur (spec § 4.2). */
  async setCollapsed(id: string, columnId: string, collapsed: boolean) {
    await this.db.users.updateOne(
      { _id: id },
      collapsed ? { $addToSet: { collapsedColumns: columnId } } : { $pull: { collapsedColumns: columnId } },
    );
  }
}
