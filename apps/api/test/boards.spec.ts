import { Client, loginAdmin, makeApp, makeUser } from './helpers';

describe('Lots 2-3 — boards, permissions, tâches (§ 4.2, 4.3, 4.9, 4.10, 4.11)', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Client;
  let owner: { id: string; client: Client };
  let editor: { id: string; client: Client };
  let reader: { id: string; client: Client };
  let outsider: { id: string; client: Client };

  beforeAll(async () => {
    ctx = await makeApp();
    admin = await loginAdmin(ctx.http);
    owner = await makeUser(ctx.http, admin, 'owner');
    editor = await makeUser(ctx.http, admin, 'editor');
    reader = await makeUser(ctx.http, admin, 'reader');
    outsider = await makeUser(ctx.http, admin, 'outsider');
  });
  afterAll(() => ctx.close());

  async function newBoard(name = 'Ops') {
    const b = (await owner.client.post('/boards', { name })).body;
    await owner.client.post(`/boards/${b._id}/members`, { userId: editor.id, role: 'editor' });
    await owner.client.post(`/boards/${b._id}/members`, { userId: reader.id, role: 'reader' });
    return b as { _id: string; columns: { _id: string; name: string }[]; completionColumnId: string };
  }
  const task = (boardId: string, name: string, extra: object = {}) =>
    editor.client.post(`/boards/${boardId}/tasks`, { name, ...extra }).then((r) => r.body);
  const tasksOf = async (boardId: string) => (await owner.client.get(`/boards/${boardId}`)).body.tasks;

  it('nouveau board : 4 colonnes par défaut, 0 swimlane, complétion = dernière', async () => {
    const b = await newBoard();
    expect(b.columns.map((c) => c.name)).toEqual(['À faire', 'Aujourd’hui', 'En cours', 'Terminé']);
    expect(b.completionColumnId).toBe(b.columns[3]._id);
    const full = (await owner.client.get(`/boards/${b._id}`)).body;
    expect(full.board.swimlanes).toEqual([]);
    expect(full.role).toBe('owner');
  });

  it('permissions serveur : lecteur → 403 sur déplacement, non-membre → 404, admin voit sans modifier', async () => {
    const b = await newBoard();
    const t = await task(b._id, 'A');
    expect(
      (await reader.client.post(`/boards/${b._id}/tasks/${t._id}/move`, { columnId: b.columns[1]._id }))
        .status,
    ).toBe(403);
    expect((await reader.client.get(`/boards/${b._id}`)).status).toBe(200);
    expect((await editor.client.patch(`/boards/${b._id}`, { name: 'x' })).status).toBe(403);
    expect((await outsider.client.get(`/boards/${b._id}`)).status).toBe(404);
    expect((await admin.get(`/boards/${b._id}`)).status).toBe(200);
    expect((await admin.post(`/boards/${b._id}/tasks`, { name: 'x' })).status).toBe(403);
  });

  it('limite WIP dépassée : le dépôt réussit quand même', async () => {
    const b = await newBoard();
    const doing = b.columns[2]._id;
    await owner.client.patch(`/boards/${b._id}/columns/${doing}`, { wipLimit: 3 });
    for (const n of ['1', '2', '3', '4']) await task(b._id, n, { columnId: doing });
    expect((await tasksOf(b._id)).filter((t: { columnId: string }) => t.columnId === doing)).toHaveLength(4);
    expect((await owner.client.patch(`/boards/${b._id}/columns/${doing}`, { wipLimit: 0 })).status).toBe(400);
  });

  it('colonne de complétion : entrer fixe completedAt, sortir l’efface ; date éditable dans le passé seulement', async () => {
    const b = await newBoard();
    const t = await task(b._id, 'A');
    const done = (
      await editor.client.post(`/boards/${b._id}/tasks/${t._id}/move`, { columnId: b.completionColumnId })
    ).body;
    expect(Date.now() - new Date(done.completedAt).getTime()).toBeLessThan(5000);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(
      (await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { completedAt: yesterday })).body
        .completedAt,
    ).toBe(yesterday);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      (await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { completedAt: future })).body.code,
    ).toBe('COMPLETION_IN_FUTURE');

    const back = (
      await editor.client.post(`/boards/${b._id}/tasks/${t._id}/move`, { columnId: b.columns[0]._id })
    ).body;
    expect(back.completedAt).toBeNull();
    expect(
      (await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { completedAt: yesterday })).body.code,
    ).toBe('NOT_COMPLETED');
  });

  it('création en haut ou en bas, réordonnancement par index', async () => {
    const b = await newBoard();
    await task(b._id, 'B');
    await task(b._id, 'C');
    await task(b._id, 'A', { top: true });
    const order = async () =>
      (await tasksOf(b._id))
        .sort((x: { position: number }, y: { position: number }) => x.position - y.position)
        .map((t: { name: string }) => t.name);
    expect(await order()).toEqual(['A', 'B', 'C']);
    const c = (await tasksOf(b._id)).find((t: { name: string }) => t.name === 'C');
    await editor.client.post(`/boards/${b._id}/tasks/${c._id}/move`, {
      columnId: b.columns[0]._id,
      index: 1,
    });
    expect(await order()).toEqual(['A', 'C', 'B']);
  });

  it('beaucoup d’insertions au même endroit : l’ordre reste correct (renumérotation)', async () => {
    const b = await newBoard();
    const first = await task(b._id, 'first');
    await task(b._id, 'last');
    for (let i = 0; i < 60; i++) {
      const t = await task(b._id, `n${i}`);
      await editor.client.post(`/boards/${b._id}/tasks/${t._id}/move`, {
        columnId: b.columns[0]._id,
        index: 1,
      });
    }
    const sorted = (await tasksOf(b._id)).sort(
      (x: { position: number }, y: { position: number }) => x.position - y.position,
    );
    expect(sorted[0]._id).toBe(first._id);
    expect(sorted[1].name).toBe('n59');
    expect(sorted[sorted.length - 1].name).toBe('last');
  });

  it('détail : responsable membre uniquement, labels créés à la volée et dédoublonnés, sous-tâches', async () => {
    const b = await newBoard();
    const t = await task(b._id, 'A');
    expect(
      (await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { responsibleUserId: outsider.id })).body
        .code,
    ).toBe('NOT_A_MEMBER');
    const l1 = (await editor.client.post(`/boards/${b._id}/labels`, { name: 'Urgent' })).body;
    const l2 = (await editor.client.post(`/boards/${b._id}/labels`, { name: 'urgent' })).body;
    expect(l2._id).toBe(l1._id);
    const subtasks = ['a', 'b', 'c'].map((n, i) => ({ _id: n, name: n, done: i === 0 }));
    const r = await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, {
      responsibleUserId: editor.id,
      collaboratorIds: [owner.id, owner.id],
      labels: [{ id: l1._id, pinned: true }],
      subtasks,
      pointsEstimate: 2.5,
      secondsEstimate: 5400,
    });
    expect(r.status).toBe(200);
    expect(r.body.collaboratorIds).toEqual([owner.id]);
    expect(r.body.subtasks.filter((s: { done: boolean }) => s.done)).toHaveLength(1);
  });

  it('historique : « couleur : jaune → rouge, par moi »', async () => {
    const b = await newBoard();
    const t = await task(b._id, 'A');
    await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { color: 'red' });
    const events = await ctx.db.events.find({ taskId: t._id }).sort({ at: 1 }).toArray();
    expect(events.map((e) => e.type)).toEqual(['taskCreated', 'taskChanged']);
    expect(events[1]).toMatchObject({
      actorId: editor.id,
      changes: { color: { old: 'yellow', new: 'red' } },
    });
  });

  it('archivage : disparaît du board, restauré dans sa colonne ou la première si supprimée', async () => {
    const b = await newBoard();
    const t1 = await task(b._id, 'A', { columnId: b.columns[1]._id });
    const t2 = await task(b._id, 'B', { columnId: b.columns[2]._id });
    expect(
      (await editor.client.post(`/boards/${b._id}/tasks/archive`, { taskIds: [t1._id, t2._id] })).body
        .archived,
    ).toBe(2);
    expect(await tasksOf(b._id)).toHaveLength(0);
    expect((await editor.client.get(`/boards/${b._id}/tasks?archived=true`)).body).toHaveLength(2);

    expect((await editor.client.post(`/boards/${b._id}/tasks/${t1._id}/restore`)).body.columnId).toBe(
      b.columns[1]._id,
    );
    await owner.client.del(`/boards/${b._id}/columns/${b.columns[2]._id}`, {});
    expect((await editor.client.post(`/boards/${b._id}/tasks/${t2._id}/restore`)).body.columnId).toBe(
      b.columns[0]._id,
    );
  });

  it('archiver les tâches terminées avant une date', async () => {
    const b = await newBoard();
    const old = await task(b._id, 'old', { columnId: b.completionColumnId });
    await task(b._id, 'recent', { columnId: b.completionColumnId });
    await editor.client.patch(`/boards/${b._id}/tasks/${old._id}`, {
      completedAt: new Date(Date.now() - 10 * 86_400_000),
    });
    const r = await editor.client.post(`/boards/${b._id}/tasks/archive-completed`, {
      before: new Date(Date.now() - 86_400_000),
    });
    expect(r.body.archived).toBe(1);
    expect((await tasksOf(b._id)).map((t: { name: string }) => t.name)).toEqual(['recent']);
  });

  it('duplication : copie juste sous l’originale, sous-tâches décochées, sans commentaires ; lecteur refusé', async () => {
    const b = await newBoard();
    const a = await task(b._id, 'A');
    await task(b._id, 'B');
    const label = (await editor.client.post(`/boards/${b._id}/labels`, { name: 'Urgent' })).body;
    await editor.client.patch(`/boards/${b._id}/tasks/${a._id}`, {
      color: 'red',
      labels: [{ id: label._id, pinned: true }],
      subtasks: [{ _id: 's', name: 'étape', done: true }],
    });
    await editor.client.post(`/boards/${b._id}/tasks/${a._id}/comments`, { text: 'ne pas copier' });
    const copy = (
      await editor.client.post(`/boards/${b._id}/tasks/${a._id}/duplicate`, { name: 'A (copie)' })
    ).body;
    expect(copy).toMatchObject({
      name: 'A (copie)',
      color: 'red',
      commentsCount: 0,
      labels: [{ id: label._id, pinned: true }],
    });
    expect(copy.subtasks).toEqual([expect.objectContaining({ name: 'étape', done: false })]);
    expect(copy._id).not.toBe(a._id);
    const order = (await tasksOf(b._id))
      .sort((x: { position: number }, y: { position: number }) => x.position - y.position)
      .map((t: { name: string }) => t.name);
    expect(order).toEqual(['A', 'A (copie)', 'B']);
    expect((await reader.client.post(`/boards/${b._id}/tasks/${a._id}/duplicate`, {})).status).toBe(403);
    expect((await editor.client.post(`/boards/${b._id}/tasks/${a._id}/duplicate`, {})).body.name).toBe(
      'A (copie)',
    );
  });

  it('suppression de tâche réservée à la permission, journalisée', async () => {
    const b = await newBoard();
    const t = await task(b._id, 'A');
    expect((await reader.client.del(`/boards/${b._id}/tasks/${t._id}`)).status).toBe(403);
    expect((await editor.client.del(`/boards/${b._id}/tasks/${t._id}`)).status).toBe(204);
    expect(await ctx.db.events.countDocuments({ taskId: t._id, type: 'taskDeleted' })).toBe(1);
  });

  it('colonnes : suppression non vide → destination requise ; la dernière colonne ne se supprime pas', async () => {
    const b = await newBoard();
    const [todo, today] = b.columns;
    await task(b._id, 'A', { columnId: today._id });
    expect((await owner.client.del(`/boards/${b._id}/columns/${today._id}`, {})).body.code).toBe(
      'DESTINATION_REQUIRED',
    );
    const r = await owner.client.del(`/boards/${b._id}/columns/${today._id}`, {
      destinationId: b.completionColumnId,
    });
    expect(r.body.columns).toHaveLength(3);
    const moved = (await tasksOf(b._id))[0];
    expect(moved.columnId).toBe(b.completionColumnId);
    expect(moved.completedAt).not.toBeNull();

    const added = (await owner.client.post(`/boards/${b._id}/columns`, { name: 'Revue' })).body;
    const ids = (await owner.client.get(`/boards/${b._id}`)).body.board.columns.map(
      (c: { _id: string }) => c._id,
    );
    expect(ids.indexOf(added._id)).toBe(ids.length - 2); // insérée avant la colonne de complétion
    expect(
      (await owner.client.put(`/boards/${b._id}/columns/order`, { ids: [...ids].reverse() })).status,
    ).toBe(200);
    expect((await owner.client.put(`/boards/${b._id}/columns/order`, { ids: ids.slice(1) })).body.code).toBe(
      'INVALID_ORDER',
    );

    for (const id of ids.slice(1))
      await owner.client.del(`/boards/${b._id}/columns/${id}`, { destinationId: todo._id });
    expect((await owner.client.del(`/boards/${b._id}/columns/${todo._id}`, {})).body.code).toBe(
      'LAST_COLUMN',
    );
  });

  it('swimlanes : la première rattache les tâches, suppression avec destination, retour à 0', async () => {
    const b = await newBoard();
    await task(b._id, 'A');
    const l1 = (await owner.client.post(`/boards/${b._id}/swimlanes`, { name: 'Produit' })).body;
    expect((await tasksOf(b._id))[0].swimlaneId).toBe(l1._id);
    const l2 = (await owner.client.post(`/boards/${b._id}/swimlanes`, { name: 'Support' })).body;
    expect((await task(b._id, 'B')).swimlaneId).toBe(l1._id);
    expect((await owner.client.del(`/boards/${b._id}/swimlanes/${l1._id}`, {})).body.code).toBe(
      'DESTINATION_REQUIRED',
    );
    await owner.client.del(`/boards/${b._id}/swimlanes/${l1._id}`, { destinationId: l2._id });
    expect((await tasksOf(b._id)).every((t: { swimlaneId: string }) => t.swimlaneId === l2._id)).toBe(true);
    await owner.client.del(`/boards/${b._id}/swimlanes/${l2._id}`, {});
    expect((await tasksOf(b._id)).every((t: { swimlaneId: string | null }) => t.swimlaneId === null)).toBe(
      true,
    );
  });

  it('membres : il reste toujours un propriétaire', async () => {
    const b = await newBoard();
    expect(
      (await owner.client.patch(`/boards/${b._id}/members/${owner.id}`, { role: 'editor' })).body.code,
    ).toBe('LAST_OWNER');
    expect((await owner.client.del(`/boards/${b._id}/members/${owner.id}`)).status).toBe(409);
    expect(
      (await editor.client.post(`/boards/${b._id}/members`, { userId: outsider.id, role: 'editor' })).status,
    ).toBe(403);
  });

  it('suppression de board : confirmation par le nom, corbeille, restauration admin', async () => {
    const b = await newBoard('À jeter');
    expect((await owner.client.del(`/boards/${b._id}`, { confirmName: 'mauvais' })).body.code).toBe(
      'CONFIRM_NAME_MISMATCH',
    );
    expect((await owner.client.del(`/boards/${b._id}`, { confirmName: 'À jeter' })).status).toBe(204);
    expect((await owner.client.get(`/boards/${b._id}`)).status).toBe(404);
    const trashed = (await admin.get('/admin/boards')).body.find((x: { _id: string }) => x._id === b._id);
    expect(trashed.deletedAt).not.toBeNull();
    await admin.post(`/admin/boards/${b._id}/restore`);
    expect((await owner.client.get(`/boards/${b._id}`)).status).toBe(200);
  });

  it('propriétaire désactivé : l’admin transfère le board, le nouveau propriétaire a tous les droits', async () => {
    const b = await newBoard();
    await admin.patch(`/admin/users/${owner.id}`, { status: 'disabled' });
    await admin.post(`/admin/boards/${b._id}/transfer`, { userId: editor.id });
    expect((await editor.client.patch(`/boards/${b._id}`, { name: 'Repris' })).body.name).toBe('Repris');
    const members = (await editor.client.get(`/boards/${b._id}`)).body.members;
    expect(members.find((m: { userId: string }) => m.userId === owner.id).role).toBe('editor');
  });
});
