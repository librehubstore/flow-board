import { Client, loginAdmin, makeApp, makeUser } from './helpers';

interface BoardJson {
  _id: string;
  name: string;
  columns: { _id: string; name: string }[];
  completionColumnId: string;
  labels: { _id: string; name: string }[];
  customFields?: { _id: string; name: string; type: string; options: { _id: string; label: string }[] }[];
}
interface TaskJson {
  _id: string;
  name: string;
  number?: number | null;
  color: string;
  customFields?: Record<string, string | number>;
  labels: { id: string }[];
  columnId: string;
}

describe('Lot 11 — historique, numérotation, champs et couleurs, suivi, copie, modèles, rôles', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Client;
  let owner: { id: string; client: Client };
  let editor: { id: string; client: Client };
  let outsider: { id: string; client: Client };

  beforeAll(async () => {
    ctx = await makeApp();
    admin = await loginAdmin(ctx.http);
    owner = await makeUser(ctx.http, admin, 'owner');
    editor = await makeUser(ctx.http, admin, 'editor');
    outsider = await makeUser(ctx.http, admin, 'outsider');
  });
  afterAll(() => ctx.close());

  async function newBoard(name = 'Ops') {
    const b = (await owner.client.post('/boards', { name })).body as BoardJson;
    await owner.client.post(`/boards/${b._id}/members`, { userId: editor.id, role: 'editor' });
    return b;
  }
  const task = (b: BoardJson, name: string, extra: object = {}) =>
    editor.client.post(`/boards/${b._id}/tasks`, { name, ...extra }).then((r) => r.body as TaskJson);
  const board = async (b: BoardJson) =>
    (await owner.client.get(`/boards/${b._id}`)).body as { board: BoardJson; tasks: TaskJson[] };
  const search = (c: Client, q: string) =>
    c.get(`/search?q=${encodeURIComponent(q)}`).then((r) => r.body as { name: string }[]);

  it('historique : « couleur : jaune → rouge, par moi », journal du board filtrable, tâche supprimée nommée', async () => {
    const b = await newBoard();
    const t = await task(b, 'A');
    await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { color: 'red' });
    const events = (await editor.client.get(`/boards/${b._id}/tasks/${t._id}/events`)).body;
    expect(events[0]).toMatchObject({
      type: 'taskChanged',
      actorId: editor.id,
      changes: { color: { old: 'yellow', new: 'red' } },
    });
    expect(events.at(-1).type).toBe('taskCreated');

    const gone = await task(b, 'Éphémère');
    await editor.client.del(`/boards/${b._id}/tasks/${gone._id}`);
    const journal = (await owner.client.get(`/boards/${b._id}/events?type=taskDeleted`)).body;
    expect(journal.events).toHaveLength(1);
    expect(journal.taskNames[gone._id]).toBe('Éphémère');
    expect((await owner.client.get(`/boards/${b._id}/events?actorId=${owner.id}`)).body.events).toEqual([]);
    expect((await outsider.client.get(`/boards/${b._id}/events`)).status).toBe(404);
  });

  it('numérotation : préfixe, tâches existantes numérotées, numéros jamais réutilisés, recherche par numéro', async () => {
    const b = await newBoard();
    const t1 = await task(b, 'Premier');
    await task(b, 'Deuxième');
    await owner.client.patch(`/boards/${b._id}`, { taskNumbering: { enabled: true, prefix: 'OPS-' } });
    const numbers = (await board(b)).tasks.map((t) => [t.name, t.number]);
    expect(numbers).toEqual(
      expect.arrayContaining([
        ['Premier', 1],
        ['Deuxième', 2],
      ]),
    );
    const t3 = await task(b, 'Troisième');
    expect(t3.number).toBe(3);
    await editor.client.del(`/boards/${b._id}/tasks/${t3._id}`);
    expect((await task(b, 'Quatrième')).number).toBe(4);
    expect((await search(owner.client, 'OPS-1')).map((x) => x.name)).toContain('Premier');
    expect(
      (await editor.client.patch(`/boards/${b._id}`, { taskNumbering: { enabled: false, prefix: '' } }))
        .status,
    ).toBe(403);
    void t1;
  });

  it('champs personnalisés : texte, nombre avec unité, liste ; validation ; suppression d’option et de champ', async () => {
    const b = await newBoard();
    const s = (
      await owner.client.post(`/boards/${b._id}/fields`, { name: 'Client', type: 'text', showOnCard: true })
    ).body;
    const n = (
      await owner.client.post(`/boards/${b._id}/fields`, {
        name: 'Budget',
        type: 'number',
        numberSuffix: '€',
      })
    ).body;
    const d = (
      await owner.client.post(`/boards/${b._id}/fields`, {
        name: 'Priorité',
        type: 'dropdown',
        options: [{ label: 'Haute' }, { label: 'Basse' }],
      })
    ).body;
    const [high, low] = d.options;
    const t = await task(b, 'Contrat');
    const r = await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, {
      customFields: { [s._id]: 'Acme Corp', [n._id]: 1200, [d._id]: high._id },
    });
    expect(r.body.customFields).toEqual({ [s._id]: 'Acme Corp', [n._id]: 1200, [d._id]: high._id });
    expect(
      (await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { customFields: { [n._id]: 'douze' } }))
        .body.code,
    ).toBe('INVALID_FIELD_VALUE');
    expect(
      (await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { customFields: { 'x.y': 'z' } })).body
        .code,
    ).toBe('UNKNOWN_FIELD');
    expect((await search(owner.client, 'acme')).map((x) => x.name)).toEqual(['Contrat']);
    expect((await search(owner.client, 'haute')).map((x) => x.name)).toEqual(['Contrat']);
    const events = (await editor.client.get(`/boards/${b._id}/tasks/${t._id}/events`)).body;
    expect(events[0].changes[`customFields.${n._id}`]).toEqual({ old: null, new: 1200 });

    expect(
      (await owner.client.patch(`/boards/${b._id}/fields/${d._id}`, { name: 'Priorité', type: 'text' })).body
        .code,
    ).toBe('FIELD_TYPE_LOCKED');
    await owner.client.patch(`/boards/${b._id}/fields/${d._id}`, {
      name: 'Priorité',
      type: 'dropdown',
      options: [{ _id: low._id, label: 'Basse' }],
    });
    expect((await board(b)).tasks[0].customFields).toEqual({ [s._id]: 'Acme Corp', [n._id]: 1200 });
    await owner.client.del(`/boards/${b._id}/fields/${s._id}`);
    expect((await board(b)).tasks[0].customFields).toEqual({ [n._id]: 1200 });
  });

  it('couleurs personnalisées : utilisables une fois ajoutées au board ; retirées, les tâches reviennent au jaune', async () => {
    const b = await newBoard();
    const t = await task(b, 'A');
    expect(
      (await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { color: '#123ABC' })).body.code,
    ).toBe('UNKNOWN_COLOR');
    await owner.client.patch(`/boards/${b._id}`, {
      customColors: ['#123abc'],
      colorLabels: { '#123abc': 'Client VIP' },
    });
    expect(
      (await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { color: '#123ABC' })).body.color,
    ).toBe('#123abc');
    expect((await owner.client.patch(`/boards/${b._id}`, { customColors: ['pas une couleur'] })).status).toBe(
      400,
    );
    await owner.client.patch(`/boards/${b._id}`, { customColors: [] });
    expect((await board(b)).tasks[0].color).toBe('yellow');
  });

  it('limite WIP en pomodoros : unité enregistrée sur la colonne', async () => {
    const b = await newBoard();
    const col = b.columns[2]._id;
    const r = await owner.client.patch(`/boards/${b._id}/columns/${col}`, {
      wipLimit: 8,
      wipUnit: 'pomodoros',
    });
    expect(r.body.columns[2]).toMatchObject({ wipLimit: 8, wipUnit: 'pomodoros' });
  });

  it('colonne suivie : notification quand une tâche y entre, pas pour l’auteur', async () => {
    const b = await newBoard();
    const doing = b.columns[2]._id;
    await owner.client.put('/me/watched-columns', { columnId: doing, watched: true });
    await editor.client.put('/me/watched-columns', { columnId: doing, watched: true });
    const t = await task(b, 'Surveillée');
    await editor.client.post(`/boards/${b._id}/tasks/${t._id}/move`, { columnId: doing });
    const ownerNotifs = (await owner.client.get('/notifications')).body.items;
    expect(ownerNotifs[0]).toMatchObject({
      type: 'columnEntered',
      taskId: t._id,
      payload: { column: 'En cours' },
    });
    expect(
      (await editor.client.get('/notifications')).body.items.some(
        (n: { type: string }) => n.type === 'columnEntered',
      ),
    ).toBe(false);
    await owner.client.put('/me/watched-columns', { columnId: doing, watched: false });
    await task(b, 'Directe', { columnId: doing });
    expect(
      (await owner.client.get('/notifications')).body.items.filter(
        (n: { type: string }) => n.type === 'columnEntered',
      ),
    ).toHaveLength(1);
  });

  it('copie de board : structure et tâches avec de nouveaux identifiants, l’original intact', async () => {
    const b = await newBoard('Source');
    const label = (await editor.client.post(`/boards/${b._id}/labels`, { name: 'Urgent' })).body;
    const field = (
      await owner.client.post(`/boards/${b._id}/fields`, {
        name: 'Lot',
        type: 'dropdown',
        options: [{ label: 'L1' }],
      })
    ).body;
    const t = await task(b, 'À copier', { columnId: b.columns[1]._id });
    await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, {
      labels: [{ id: label._id, pinned: true }],
      customFields: { [field._id]: field.options[0]._id },
      subtasks: [{ _id: 's', name: 'étape', done: true }],
    });
    const archived = await task(b, 'Archivée');
    await editor.client.post(`/boards/${b._id}/tasks/archive`, { taskIds: [archived._id] });

    const structure = (await editor.client.post(`/boards/${b._id}/copy`, { name: 'Structure seule' }))
      .body as BoardJson;
    expect(structure.columns.map((c) => c.name)).toEqual(b.columns.map((c) => c.name));
    expect(structure.columns[0]._id).not.toBe(b.columns[0]._id);
    expect((await editor.client.get(`/boards/${structure._id}`)).body.tasks).toEqual([]);

    const full = (await editor.client.post(`/boards/${b._id}/copy`, { name: 'Copie', withTasks: true }))
      .body as BoardJson;
    const copy = (await editor.client.get(`/boards/${full._id}`)).body as {
      board: BoardJson;
      tasks: TaskJson[];
      role: string;
    };
    expect(copy.role).toBe('owner');
    expect(copy.tasks.map((x) => x.name)).toEqual(['À copier']);
    const [c] = copy.tasks;
    expect(c.columnId).toBe(copy.board.columns[1]._id);
    expect(c.labels[0].id).toBe(copy.board.labels[0]._id);
    const copiedField = copy.board.customFields![0];
    expect(c.customFields).toEqual({ [copiedField._id]: copiedField.options[0]._id });
    expect((await board(b)).tasks.map((x) => x.name)).toEqual(['À copier']);
  });

  it('modèles : tout utilisateur crée un board à partir d’un modèle (structure seule)', async () => {
    const b = await newBoard('Modèle sprint');
    await owner.client.patch(`/boards/${b._id}`, { isTemplate: true });
    await task(b, 'Ne pas copier');
    const templates = (await outsider.client.get('/boards/templates')).body as BoardJson[];
    expect(templates.map((x) => x.name)).toContain('Modèle sprint');
    const created = (await outsider.client.post('/boards', { name: 'Mon sprint', templateId: b._id }))
      .body as BoardJson;
    const view = (await outsider.client.get(`/boards/${created._id}`)).body;
    expect(view.board.columns.map((c: { name: string }) => c.name)).toEqual(b.columns.map((c) => c.name));
    expect(view.tasks).toEqual([]);
    expect(view.role).toBe('owner');
    expect((await outsider.client.get(`/boards/${b._id}`)).status).toBe(404); // le modèle lui-même reste privé
  });

  it('rôles personnalisés : définis par l’admin, attribués à un membre, permissions appliquées', async () => {
    expect((await owner.client.post('/admin/roles', { name: 'X', permissions: ['board.view'] })).status).toBe(
      403,
    );
    expect((await admin.post('/admin/roles', { name: 'Sans vue', permissions: ['comment'] })).status).toBe(
      400,
    );
    const role = (
      await admin.post('/admin/roles', { name: 'Commentateur', permissions: ['board.view', 'comment'] })
    ).body;
    expect((await owner.client.get('/roles')).body.map((r: { name: string }) => r.name)).toContain(
      'Commentateur',
    );

    const b = await newBoard();
    const t = await task(b, 'À commenter');
    expect(
      (await owner.client.post(`/boards/${b._id}/members`, { userId: outsider.id, role: 'inconnu' })).body
        .code,
    ).toBe('UNKNOWN_ROLE');
    await owner.client.post(`/boards/${b._id}/members`, { userId: outsider.id, role: role._id });
    expect(
      (await outsider.client.post(`/boards/${b._id}/tasks/${t._id}/comments`, { text: 'ok' })).status,
    ).toBe(201);
    expect((await outsider.client.post(`/boards/${b._id}/tasks`, { name: 'non' })).status).toBe(403);
    expect((await outsider.client.get(`/boards/${b._id}`)).body.permissions).toEqual([
      'board.view',
      'comment',
    ]);

    expect((await admin.del(`/admin/roles/${role._id}`)).body.code).toBe('ROLE_IN_USE');
    await admin.patch(`/admin/roles/${role._id}`, {
      name: 'Commentateur',
      permissions: ['board.view', 'comment', 'task.create'],
    });
    expect((await outsider.client.post(`/boards/${b._id}/tasks`, { name: 'désormais oui' })).status).toBe(
      201,
    );
  });
});
