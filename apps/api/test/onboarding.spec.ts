import { MailService } from '../src/mail/mail.service';
import { Client, loginAdmin, makeApp, makeUser } from './helpers';

/** ID token tel que renvoyé par l'endpoint de jeton Google (non signé ici : l'échange est simulé). */
const idToken = (claims: object) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');

describe('Onboarding : administration (défaut) ou libre-service (email + mot de passe, Google) avec emails Brevo', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Client;
  let mail: MailService;
  const realFetch = global.fetch;

  beforeAll(async () => {
    ctx = await makeApp();
    admin = await loginAdmin(ctx.http);
    mail = ctx.app.get(MailService);
  });
  afterAll(async () => {
    global.fetch = realFetch;
    await ctx.close();
  });

  const anon = () => new Client(ctx.http);
  const lastMail = (to: string) => [...mail.sent].reverse().find((m) => m.to === to);
  const tokenFrom = (text: string) => /token=([\w-]+)/.exec(text)![1];
  const open = (extra: object = {}) =>
    admin.patch('/admin/settings', {
      onboarding: 'open',
      registration: { password: true, google: true },
      allowedDomains: [],
      ...extra,
    });

  it('mode admin (défaut) : aucune inscription, aucune route active, Google réservé aux comptes existants', async () => {
    const settings = (await anon().get('/settings')).body;
    expect(settings).toMatchObject({ onboarding: 'admin', googleAvailable: true });
    expect((await anon().post('/auth/register', {})).status).toBe(404);
    expect(
      (await anon().post('/auth/register', { email: 'a@b.fr', fullName: 'A', password: 'long-password-1' }))
        .status,
    ).toBe(404);
  });

  it('inscription : compte en attente, email de validation, pas de connexion avant validation', async () => {
    await open();
    const r = await anon().post('/auth/register', {
      email: 'Marie@Exemple.fr',
      fullName: 'Marie Curie',
      password: 'radium-1898',
    });
    expect(r.status).toBe(202);
    const user = (await ctx.db.users.findOne({ email: 'marie@exemple.fr' }))!;
    expect(user).toMatchObject({
      status: 'pending',
      emailVerified: false,
      username: 'marie',
      mustChangePassword: false,
    });
    const m = lastMail('marie@exemple.fr')!;
    expect(m.subject).toBe('Confirmez votre adresse email — Flowboard');
    expect(m.text).toContain('http://flowboard.test/verify-email?token=');
    expect(m.html).toContain('Activer mon compte');
    expect(
      (await anon().post('/auth/login', { username: 'marie@exemple.fr', password: 'radium-1898' })).status,
    ).toBe(401);
  });

  it('validation : compte actif, session ouverte, email d’accueil ; lien à usage unique ; connexion par email', async () => {
    const token = tokenFrom(lastMail('marie@exemple.fr')!.text);
    const c = anon();
    const r = await c.post('/auth/verify-email', { token });
    expect(r.body).toMatchObject({ email: 'marie@exemple.fr', status: 'active', emailVerified: true });
    expect((await c.get('/boards')).status).toBe(200);
    expect(lastMail('marie@exemple.fr')!.subject).toBe('Bienvenue sur Flowboard');
    expect((await anon().post('/auth/verify-email', { token })).body.code).toBe('INVALID_TOKEN');
    expect(
      (await anon().post('/auth/login', { username: 'marie@exemple.fr', password: 'radium-1898' })).status,
    ).toBe(200);
    expect((await anon().post('/auth/login', { username: 'marie', password: 'radium-1898' })).status).toBe(
      200,
    );
  });

  it('pas d’énumération : email déjà inscrit → même réponse, aucun email ni compte créé', async () => {
    const before = mail.sent.length;
    const r = await anon().post('/auth/register', {
      email: 'marie@exemple.fr',
      fullName: 'Intrus',
      password: 'autre-mot-de-passe',
    });
    expect(r.status).toBe(202);
    expect(mail.sent.length).toBe(before);
    expect(await ctx.db.users.countDocuments({ email: 'marie@exemple.fr' })).toBe(1);
  });

  it('renvoi du lien (l’ancien est invalidé), identifiant dédoublonné, domaines autorisés, nom de l’instance dans les emails', async () => {
    await admin.patch('/admin/settings', { instanceName: 'Freehub' });
    await anon().post('/auth/register', {
      email: 'marie@autre.fr',
      fullName: 'Marie B',
      password: 'mot-de-passe-2',
    });
    expect((await ctx.db.users.findOne({ email: 'marie@autre.fr' }))!.username).toBe('marie-2');
    const first = tokenFrom(lastMail('marie@autre.fr')!.text);
    expect((await anon().post('/auth/resend-verification', { email: 'marie@autre.fr' })).status).toBe(202);
    const second = lastMail('marie@autre.fr')!;
    expect(second.subject).toBe('Confirmez votre adresse email — Freehub');
    expect((await anon().post('/auth/verify-email', { token: first })).body.code).toBe('INVALID_TOKEN');
    expect((await anon().post('/auth/verify-email', { token: tokenFrom(second.text) })).status).toBe(200);
    expect(lastMail('marie@autre.fr')!.subject).toBe('Bienvenue sur Freehub');

    await open({ allowedDomains: ['librehub.store'] });
    expect(
      (
        await anon().post('/auth/register', {
          email: 'x@gmail.com',
          fullName: 'X',
          password: 'long-password-1',
        })
      ).body.code,
    ).toBe('DOMAIN_NOT_ALLOWED');
    await open();
  });

  describe('Google', () => {
    /** Démarre l'autorisation : URL Google (PKCE) et cookie `state.verifier`. */
    async function start(c: Client) {
      const r = await c.get('/auth/google');
      expect(r.status).toBe(302);
      const url = new URL(r.headers.location);
      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('redirect_uri')).toBe('http://flowboard.test/api/auth/google/callback');
      return url.searchParams.get('state')!;
    }
    /** Simule l'endpoint de jeton de Google. */
    function googleReturns(claims: object) {
      global.fetch = jest.fn(
        async () => new Response(JSON.stringify({ id_token: idToken(claims) }), { status: 200 }),
      ) as never;
    }
    const claims = (email: string, sub: string, extra: object = {}) => ({
      iss: 'https://accounts.google.com',
      aud: 'test-client.apps.googleusercontent.com',
      exp: Math.floor(Date.now() / 1000) + 300,
      sub,
      email,
      email_verified: true,
      name: 'Ada Lovelace',
      ...extra,
    });

    it('nouvel utilisateur (mode open) : compte actif sans mot de passe, session, email d’accueil', async () => {
      const c = anon();
      const state = await start(c);
      googleReturns(claims('ada@librehub.store', 'g-ada'));
      const r = await c.get(`/auth/google/callback?code=abc&state=${state}`);
      expect(r.headers.location).toBe('http://flowboard.test/');
      expect((await c.get('/me')).body).toMatchObject({
        email: 'ada@librehub.store',
        fullName: 'Ada Lovelace',
        status: 'active',
      });
      expect((await ctx.db.users.findOne({ googleId: 'g-ada' }))!.passwordHash).toBeNull();
      expect(lastMail('ada@librehub.store')!.subject).toMatch(/^Bienvenue sur/);
      // Pas de connexion par mot de passe pour un compte Google.
      expect(
        (await anon().post('/auth/login', { username: 'ada@librehub.store', password: 'nimporte-quoi' }))
          .status,
      ).toBe(401);
    });

    it('state invalide, annulation ou jeton d’une autre application : refus', async () => {
      const c = anon();
      await start(c);
      googleReturns(claims('eve@librehub.store', 'g-eve'));
      expect((await c.get('/auth/google/callback?code=abc&state=faux')).headers.location).toBe(
        'http://flowboard.test/?auth_error=GOOGLE_STATE',
      );
      const c2 = anon();
      const state = await start(c2);
      googleReturns(claims('eve@librehub.store', 'g-eve', { aud: 'autre-client' }));
      expect((await c2.get(`/auth/google/callback?code=abc&state=${state}`)).headers.location).toContain(
        'GOOGLE_FAILED',
      );
      expect((await anon().get('/auth/google/callback?error=access_denied')).headers.location).toContain(
        'auth_error=',
      );
      expect(await ctx.db.users.countDocuments({ email: 'eve@librehub.store' })).toBe(0);
    });

    it('mode admin : un compte créé par l’admin (même email) se connecte avec Google ; un inconnu est refusé', async () => {
      await admin.patch('/admin/settings', { onboarding: 'admin' });
      const { id } = await makeUser(ctx.http, admin, 'bob');
      await admin.patch(`/admin/users/${id}`, { email: 'bob@librehub.store' });
      const c = anon();
      let state = await start(c);
      googleReturns(claims('bob@librehub.store', 'g-bob'));
      expect((await c.get(`/auth/google/callback?code=abc&state=${state}`)).headers.location).toBe(
        'http://flowboard.test/',
      );
      expect((await c.get('/me')).body.username).toBe('bob');

      const c2 = anon();
      state = await start(c2);
      googleReturns(claims('inconnu@librehub.store', 'g-x'));
      expect((await c2.get(`/auth/google/callback?code=abc&state=${state}`)).headers.location).toContain(
        'REGISTRATION_CLOSED',
      );
    });

    it('Google désactivé dans les paramètres : plus de route', async () => {
      await admin.patch('/admin/settings', { registration: { password: true, google: false } });
      expect((await anon().get('/auth/google')).status).toBe(404);
    });
  });
});
