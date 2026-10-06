import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Db } from '../src/database/db.service';
import { setup } from '../src/main';

export const ADMIN_PASSWORD = 'adminadmin34';

export async function makeApp(listen = false) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = setup(moduleRef.createNestApplication<NestExpressApplication>());
  if (listen) await app.listen(0);
  else await app.init();
  const db = app.get(Db);
  const address = app.getHttpServer().address();
  return {
    app,
    db,
    http: app.getHttpServer(),
    url: address && typeof address === 'object' ? `http://127.0.0.1:${address.port}` : '',
    close: async () => {
      await db.client.db().dropDatabase();
      await app.close();
    },
  };
}

/** Client HTTP avec cookies persistants et en-tête CSRF sur les mutations. */
export class Client {
  agent: ReturnType<typeof request.agent>;
  /** En-tête Cookie de la session (pour Socket.IO). */
  cookie = '';
  constructor(http: unknown) {
    this.agent = request.agent(http as never);
  }
  get(url: string) {
    return this.agent.get(`/api${url}`);
  }
  post(url: string, body?: object) {
    return this.agent.post(`/api${url}`).set('x-flowboard-csrf', '1').send(body);
  }
  patch(url: string, body?: object) {
    return this.agent.patch(`/api${url}`).set('x-flowboard-csrf', '1').send(body);
  }
  put(url: string, body?: object) {
    return this.agent.put(`/api${url}`).set('x-flowboard-csrf', '1').send(body);
  }
  del(url: string, body?: object) {
    return this.agent.delete(`/api${url}`).set('x-flowboard-csrf', '1').send(body);
  }
}

/** Connexion ; si un changement de mot de passe est exigé, `newPassword` est posé. */
export async function login(http: unknown, username: string, password: string, newPassword?: string) {
  const c = new Client(http);
  const r = await c.post('/auth/login', { username, password });
  if (r.status !== 200) throw new Error(`login ${username}: ${r.status} ${JSON.stringify(r.body)}`);
  c.cookie = String(r.headers['set-cookie']?.[0] ?? '').split(';')[0];
  if (r.body.mustChangePassword && newPassword) {
    const p = await c.post('/auth/password', { currentPassword: password, newPassword });
    if (p.status !== 204) throw new Error(`password ${username}: ${p.status}`);
  }
  return c;
}

export const loginAdmin = (http: unknown) => login(http, 'admin', 'adminadmin12', ADMIN_PASSWORD);

/** Crée un utilisateur par l'admin puis renvoie un client connecté (mot de passe déjà changé). */
export async function makeUser(http: unknown, admin: Client, username: string) {
  const r = await admin.post('/admin/users', {
    username,
    fullName: username.toUpperCase(),
    password: 'initial-pass',
  });
  if (r.status !== 201) throw new Error(`create ${username}: ${r.status} ${JSON.stringify(r.body)}`);
  return { id: r.body._id as string, client: await login(http, username, 'initial-pass', 'personal-pass') };
}
