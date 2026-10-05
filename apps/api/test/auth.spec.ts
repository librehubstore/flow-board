import { Client, login, loginAdmin, makeApp, makeUser } from './helpers';

describe('Lot 1 — comptes et authentification (§ 4.1)', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Client;

  beforeAll(async () => {
    ctx = await makeApp();
    admin = await loginAdmin(ctx.http);
  });
  afterAll(() => ctx.close());

  it('base vide + variables admin → un admin existe et peut se connecter', async () => {
    const me = await admin.get('/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ username: 'admin', globalRole: 'admin', mustChangePassword: false });
    expect(me.body.passwordHash).toBeUndefined();
  });

  it('mauvais mot de passe ou identifiant inconnu → même message générique', async () => {
    const c = new Client(ctx.http);
    const wrong = await c.post('/auth/login', { username: 'admin', password: 'nope-nope-nope' });
    const unknown = await c.post('/auth/login', { username: 'ghost', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.message).toBe('Identifiant ou mot de passe incorrect');
  });

  it('5 échecs consécutifs → connexion bloquée, même avec le bon mot de passe', async () => {
    await makeUser(ctx.http, admin, 'bruteforced');
    const c = new Client(ctx.http);
    for (let i = 0; i < 5; i++) expect((await c.post('/auth/login', { username: 'bruteforced', password: 'bad' })).status).toBe(401);
    const r = await c.post('/auth/login', { username: 'bruteforced', password: 'personal-pass' });
    expect(r.status).toBe(429);
  });

  it('réinitialisation par l’admin → mot de passe temporaire, changement forcé, sessions révoquées', async () => {
    const { id, client: oldSession } = await makeUser(ctx.http, admin, 'forgetful');
    const reset = await admin.post(`/admin/users/${id}/reset-password`);
    expect(reset.body.temporaryPassword).toEqual(expect.any(String));
    expect((await oldSession.get('/boards')).status).toBe(401);

    const c = await login(ctx.http, 'forgetful', reset.body.temporaryPassword);
    expect((await c.get('/boards')).body.code).toBe('MUST_CHANGE_PASSWORD');
    expect((await c.get('/me')).body.mustChangePassword).toBe(true);
    expect((await c.post('/auth/password', { currentPassword: reset.body.temporaryPassword, newPassword: 'brand-new-pass' })).status).toBe(204);
    expect((await c.get('/boards')).status).toBe(200);
  });

  it('changement de mot de passe : exige l’actuel et invalide les autres sessions', async () => {
    await makeUser(ctx.http, admin, 'twodevices');
    const a = await login(ctx.http, 'twodevices', 'personal-pass');
    const b = await login(ctx.http, 'twodevices', 'personal-pass');
    expect((await a.post('/auth/password', { currentPassword: 'wrong-wrong', newPassword: 'another-pass' })).status).toBe(400);
    expect((await a.post('/auth/password', { currentPassword: 'personal-pass', newPassword: 'court' })).status).toBe(400);
    expect((await a.post('/auth/password', { currentPassword: 'personal-pass', newPassword: 'another-pass' })).status).toBe(204);
    expect((await a.get('/me')).status).toBe(200);
    expect((await b.get('/me')).status).toBe(401);
  });

  it('le dernier admin ne peut être ni rétrogradé ni désactivé', async () => {
    const me = await admin.get('/me');
    expect((await admin.patch(`/admin/users/${me.body._id}`, { globalRole: 'user' })).body.code).toBe('LAST_ADMIN');
    expect((await admin.patch(`/admin/users/${me.body._id}`, { status: 'disabled' })).status).toBe(409);
  });

  it('compte désactivé : connexion refusée, sessions révoquées, réactivable', async () => {
    const { id, client } = await makeUser(ctx.http, admin, 'leaver');
    expect((await admin.patch(`/admin/users/${id}`, { status: 'disabled' })).status).toBe(200);
    expect((await client.get('/me')).status).toBe(401);
    expect((await new Client(ctx.http).post('/auth/login', { username: 'leaver', password: 'personal-pass' })).status).toBe(401);
    await admin.patch(`/admin/users/${id}`, { status: 'active' });
    expect((await new Client(ctx.http).post('/auth/login', { username: 'leaver', password: 'personal-pass' })).status).toBe(200);
  });

  it('identifiant unique et insensible à la casse', async () => {
    const r = await admin.post('/admin/users', { username: 'LEAVER', fullName: 'x', password: 'initial-pass' });
    expect(r.body.code).toBe('USERNAME_TAKEN');
  });

  it('aucune route d’inscription ni de mot de passe oublié ; admin requis pour gérer les comptes', async () => {
    const anon = new Client(ctx.http);
    expect((await anon.post('/auth/register', {})).status).toBe(404);
    expect((await anon.post('/auth/forgot-password', {})).status).toBe(404);
    expect((await anon.post('/admin/users', {})).status).toBe(401);
    const { client } = await makeUser(ctx.http, admin, 'regular');
    expect((await client.get('/admin/users')).status).toBe(403);
  });

  it('mutation sans en-tête CSRF → 403', async () => {
    const r = await admin.agent.post('/api/boards').send({ name: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF');
  });

  it('les actions admin sont auditées', async () => {
    const audit = await admin.get('/admin/audit');
    expect(audit.body.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['user.create', 'user.resetPassword']));
  });

  it('paramètres d’instance : lecture publique, modification admin', async () => {
    expect((await new Client(ctx.http).get('/settings')).body.instanceName).toBe('Flowboard');
    expect((await admin.patch('/admin/settings', { instanceName: 'Équipe Ops' })).body.instanceName).toBe('Équipe Ops');
  });
});
