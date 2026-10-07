import { randomUUID } from 'node:crypto';
import { normalize } from '@flowboard/shared';
import { Client, loginAdmin, makeApp, makeUser } from './helpers';

describe('Lot 7 — recherche et filtres (§ 4.5)', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let alice: { id: string; client: Client };
  let bob: { id: string; client: Client };
  let board: { _id: string; columns: { _id: string }[] };

  beforeAll(async () => {
    ctx = await makeApp();
    const admin = await loginAdmin(ctx.http);
    alice = await makeUser(ctx.http, admin, 'alice');
    bob = await makeUser(ctx.http, admin, 'bob');
    board = (await alice.client.post('/boards', { name: 'Ops' })).body;
  });
  afterAll(() => ctx.close());

  const task = (name: string) =>
    alice.client.post(`/boards/${board._id}/tasks`, { name }).then((r) => r.body);
  const search = (c: Client, q: string, archived = false) =>
    c
      .get(`/search?q=${encodeURIComponent(q)}${archived ? '&archived=true' : ''}`)
      .then((r) => r.body as { name: string }[]);

  it('un mot présent uniquement dans un commentaire trouve la tâche', async () => {
    const t = await task('Migrer le DNS');
    await alice.client.post(`/boards/${board._id}/tasks/${t._id}/comments`, {
      text: 'Penser au fournisseur Gandi',
    });
    expect((await search(alice.client, 'gandi')).map((x) => x.name)).toEqual(['Migrer le DNS']);
  });

  it('sous-tâches, labels, accents, casse, mots partiels ; tous les mots requis', async () => {
    const t = await task('Renouveler le certificat');
    const label = (await alice.client.post(`/boards/${board._id}/labels`, { name: 'Sécurité' })).body;
    await alice.client.patch(`/boards/${board._id}/tasks/${t._id}`, {
      labels: [{ id: label._id, pinned: true }],
      subtasks: [{ _id: 's', name: 'Prévenir l’équipe réseau', done: false }],
    });
    expect((await search(alice.client, 'SECURITE')).map((x) => x.name)).toContain('Renouveler le certificat');
    expect((await search(alice.client, 'certif équipe')).map((x) => x.name)).toEqual([
      'Renouveler le certificat',
    ]);
    expect(await search(alice.client, 'certif dns')).toEqual([]);
    expect((await search(alice.client, '(.*')).length).toBe(0); // la saisie n'est pas une regex
  });

  it('tâches archivées : sur option, avec leur nom de board et de colonne', async () => {
    const t = await task('Vieille procédure');
    await alice.client.post(`/boards/${board._id}/tasks/archive`, { taskIds: [t._id] });
    expect(await search(alice.client, 'vieille')).toEqual([]);
    const found = (await search(alice.client, 'vieille', true))[0] as Record<string, unknown>;
    expect(found).toMatchObject({ name: 'Vieille procédure', boardName: 'Ops', columnName: 'À faire' });
    expect(found.archivedAt).not.toBeNull();
  });

  it('seulement les boards accessibles', async () => {
    expect(await search(bob.client, 'gandi')).toEqual([]);
  });

  it('filtre mémorisé par utilisateur et par board ; un filtre vide est effacé', async () => {
    const filter = { responsible: ['me'], labels: [], colors: ['red'], due: [], text: '' };
    expect((await alice.client.put(`/me/board-filters/${board._id}`, filter)).status).toBe(204);
    expect((await alice.client.get('/me')).body.boardFilters[board._id]).toMatchObject(filter);
    await alice.client.put(`/me/board-filters/${board._id}`, {});
    expect((await alice.client.get('/me')).body.boardFilters?.[board._id]).toBeUndefined();
    expect((await alice.client.put('/me/board-filters/a.b', filter)).status).toBe(400);
  });

  it('performance : moins de 500 ms sur 50 000 tâches', async () => {
    const now = new Date();
    const docs = Array.from({ length: 50_000 }, (_, i) => ({
      _id: randomUUID(),
      boardId: board._id,
      columnId: board.columns[0]._id,
      swimlaneId: null,
      position: i,
      name: `Tâche de charge ${i}`,
      description: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.',
      searchText: normalize(`Tâche de charge ${i} Lorem ipsum dolor sit amet consectetur adipiscing elit`),
      archivedAt: null,
      updatedAt: now,
    }));
    await ctx.db.tasks.insertMany(docs as never[]);
    await search(alice.client, 'echauffement'); // première requête : connexions et cache à froid
    const started = Date.now();
    const results = await search(alice.client, 'charge 49999');
    const elapsed = Date.now() - started;
    expect(results.map((x) => x.name)).toEqual(['Tâche de charge 49999']);
    expect(elapsed).toBeLessThan(500);
  });
});
