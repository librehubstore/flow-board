import { RecurrenceService } from '../src/tasks/recurrence.service';
import { Client, loginAdmin, makeApp, makeUser } from './helpers';

describe('Lot 6 — tâches récurrentes (§ 4.4)', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let user: Client;
  let board: { _id: string; columns: { _id: string }[]; completionColumnId: string };

  beforeAll(async () => {
    ctx = await makeApp();
    user = (await makeUser(ctx.http, await loginAdmin(ctx.http), 'planner')).client;
    board = (await user.post('/boards', { name: 'Routines' })).body;
  });
  afterAll(() => ctx.close());

  interface TaskJson {
    _id: string;
    name: string;
    columnId: string;
    dueAt: string;
    startAt: string;
    completedAt: string | null;
    subtasks: unknown[];
    recurrence: { index: number; anchor: string; nextAt: string };
  }
  const tasks = async () => (await user.get(`/boards/${board._id}`)).body.tasks as TaskJson[];
  const complete = (id: string) =>
    user.post(`/boards/${board._id}/tasks/${id}/move`, { columnId: board.completionColumnId });
  const day = 86_400_000;
  const dateOnly = (d: Date) => `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;

  it('hebdomadaire due lundi, terminée plus tard → due le lundi suivant, masquée jusque-là', async () => {
    // Dernier lundi passé (ou aujourd'hui si lundi).
    const now = new Date();
    const lastMonday = new Date(Date.parse(dateOnly(now)) - ((now.getUTCDay() + 6) % 7) * day);
    const t = (await user.post(`/boards/${board._id}/tasks`, { name: 'Revue hebdo' })).body;
    await user.patch(`/boards/${board._id}/tasks/${t._id}`, {
      dueAt: lastMonday,
      subtasks: [{ _id: 's1', name: 'checklist', done: true }],
      recurrence: { freq: 'weekly' },
    });
    await complete(t._id);

    const next = (await tasks()).find((x) => x.name === 'Revue hebdo' && x._id !== t._id)!;
    const expected = new Date(lastMonday.getTime() + 7 * day).toISOString();
    expect(next.dueAt).toBe(expected);
    expect(next.startAt).toBe(expected); // > maintenant : affichée dans « À venir », pas dans la colonne
    expect(Date.parse(next.startAt)).toBeGreaterThan(Date.now());
    expect(next.columnId).toBe(board.columns[0]._id);
    expect(next.subtasks).toEqual([expect.objectContaining({ name: 'checklist', done: false })]);
    expect(next.recurrence).toMatchObject({ index: 2, spawned: false });

    // Sortir puis remettre en « Terminé » ne crée pas de doublon.
    await user.post(`/boards/${board._id}/tasks/${t._id}/move`, { columnId: board.columns[0]._id });
    await complete(t._id);
    expect((await tasks()).filter((x) => x.name === 'Revue hebdo')).toHaveLength(2);
  });

  it('récurrence « 3 occurrences » : aucune 4e n’est créée', async () => {
    const t = (await user.post(`/boards/${board._id}/tasks`, { name: 'Trois fois' })).body;
    await user.patch(`/boards/${board._id}/tasks/${t._id}`, {
      recurrence: { freq: 'daily', endType: 'count', endCount: 3 },
    });
    for (let i = 0; i < 3; i++) {
      const open = (await tasks()).find((x) => x.name === 'Trois fois' && !x.completedAt)!;
      expect(open.recurrence.index).toBe(i + 1);
      await complete(open._id);
    }
    const all = (await tasks()).filter((x) => x.name === 'Trois fois');
    expect(all).toHaveLength(3);
    expect(all.every((x) => x.completedAt)).toBe(true);
  });

  it('à date fixe : créée à la date prévue même si la précédente n’est pas finie, une seule fois', async () => {
    const t = (await user.post(`/boards/${board._id}/tasks`, { name: 'Sauvegarde' })).body;
    // Échéance d'avant-hier : l'occurrence d'hier est due.
    const twoDaysAgo = dateOnly(new Date(Date.now() - 2 * day));
    await user.patch(`/boards/${board._id}/tasks/${t._id}`, { dueAt: twoDaysAgo });
    await user.patch(`/boards/${board._id}/tasks/${t._id}`, {
      recurrence: { freq: 'daily', mode: 'fixedDate' },
    });
    const service = ctx.app.get(RecurrenceService);
    await service.spawnDue();
    await service.spawnDue();
    const series = (await tasks()).filter((x) => x.name === 'Sauvegarde');
    expect(series).toHaveLength(2);
    const created = series.find((x) => x._id !== t._id)!;
    expect(created.completedAt).toBeNull();
    expect(Date.parse(created.startAt)).toBeLessThanOrEqual(Date.now()); // visible tout de suite
    // L'occurrence suivante est programmée dans le futur (pas de rattrapage en rafale).
    expect(Date.parse(created.recurrence.nextAt)).toBeGreaterThan(Date.now());
  });

  it('modifier la règle n’affecte que les occurrences suivantes ; null la supprime', async () => {
    const t = (await user.post(`/boards/${board._id}/tasks`, { name: 'Modifiable' })).body;
    await user.patch(`/boards/${board._id}/tasks/${t._id}`, { recurrence: { freq: 'daily' } });
    const first = (await tasks()).find((x) => x._id === t._id)!;
    const r = await user.patch(`/boards/${board._id}/tasks/${t._id}`, { recurrence: { freq: 'weekly' } });
    expect(r.body.recurrence).toMatchObject({ freq: 'weekly', index: 1, anchor: first.recurrence.anchor });
    expect(
      (await user.patch(`/boards/${board._id}/tasks/${t._id}`, { recurrence: null })).body.recurrence,
    ).toBeNull();
    await complete(t._id);
    expect((await tasks()).filter((x) => x.name === 'Modifiable')).toHaveLength(1);
  });
});
