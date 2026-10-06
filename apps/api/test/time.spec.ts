import { Client, loginAdmin, makeApp, makeUser } from './helpers';

describe('Lot 8 — gestion du temps (§ 4.6)', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let owner: { id: string; client: Client };
  let editor: { id: string; client: Client };
  let reader: { id: string; client: Client };
  let board: { _id: string };
  let a: { _id: string };
  let b: { _id: string };

  beforeAll(async () => {
    ctx = await makeApp();
    const admin = await loginAdmin(ctx.http);
    owner = await makeUser(ctx.http, admin, 'owner');
    editor = await makeUser(ctx.http, admin, 'editor');
    reader = await makeUser(ctx.http, admin, 'reader');
    board = (await owner.client.post('/boards', { name: 'Temps' })).body;
    await owner.client.post(`/boards/${board._id}/members`, { userId: editor.id, role: 'editor' });
    await owner.client.post(`/boards/${board._id}/members`, { userId: reader.id, role: 'reader' });
    a = (await editor.client.post(`/boards/${board._id}/tasks`, { name: 'A' })).body;
    b = (await editor.client.post(`/boards/${board._id}/tasks`, { name: 'B' })).body;
  });
  afterAll(() => ctx.close());

  const MIN = 60_000;
  /** Recule les dates du minuteur et de sa part ouverte (simule le temps écoulé). */
  async function rewind(userId: string, ms: number) {
    const timer = (await ctx.db.timers.findOne({ _id: userId }))!;
    await ctx.db.timers.updateOne(
      { _id: userId },
      {
        $set: {
          startedAt: new Date(timer.startedAt.getTime() - ms),
          ...(timer.endsAt ? { endsAt: new Date(timer.endsAt.getTime() - ms) } : {}),
        },
      },
    );
    if (timer.entryId) {
      const entry = (await ctx.db.timeEntries.findOne({ _id: timer.entryId }))!;
      const parts = entry.parts.map((p) =>
        p.endAt ? p : { ...p, startAt: new Date(p.startAt.getTime() - ms) },
      );
      await ctx.db.timeEntries.updateOne(
        { _id: entry._id },
        { $set: { parts, startAt: new Date(entry.startAt.getTime() - ms) } },
      );
    }
  }
  const spent = async (id: string) => (await ctx.db.tasks.findOne({ _id: id }))!.spentSeconds ?? 0;

  it('Pomodoro : l’état est côté serveur, le compte à rebours survit au rechargement', async () => {
    const r = await editor.client.post('/timer/start', { kind: 'pomodoro', taskId: a._id });
    expect(r.body.timer).toMatchObject({ kind: 'pomodoro', phase: 'work', taskName: 'A' });
    const endsAt = r.body.timer.endsAt;
    expect(Date.parse(endsAt) - Date.parse(r.body.timer.startedAt)).toBe(25 * MIN);
    // « Rechargement » : un nouvel appel renvoie la même échéance.
    expect((await editor.client.get('/timer')).body.timer.endsAt).toBe(endsAt);
    expect((await editor.client.post('/timer/start', { kind: 'stopwatch', taskId: b._id })).body.code).toBe(
      'TIMER_RUNNING',
    );
  });

  it('fin de session → pause courte, puis fin ; le travail est compté', async () => {
    await rewind(editor.id, 26 * MIN);
    const s = (await editor.client.get('/timer')).body.timer;
    expect(s).toMatchObject({ phase: 'shortBreak', cycle: 1 });
    expect(await spent(a._id)).toBe(25 * 60);
    const entry = (await ctx.db.timeEntries.findOne({ userId: editor.id, type: 'pomodoro' }))!;
    expect(entry).toMatchObject({ success: true, running: false });
    await rewind(editor.id, 6 * MIN);
    expect((await editor.client.get('/timer')).body.timer).toBeNull();
  });

  it('interruption : session « échouée » avec son motif', async () => {
    await editor.client.post('/timer/start', { kind: 'pomodoro', taskId: a._id });
    expect((await editor.client.post('/timer/stop')).body.code).toBe('USE_INTERRUPT');
    await editor.client.post('/timer/interrupt', { reason: 'meeting', comment: 'Point client imprévu' });
    const failed = (await ctx.db.timeEntries.find({ userId: editor.id, success: false }).toArray())[0];
    expect(failed).toMatchObject({
      interruptionReason: 'meeting',
      comment: 'Point client imprévu',
      running: false,
    });
    expect((await editor.client.get('/timer')).body.timer).toBeNull();
  });

  it('chronomètre : 10 min sur A puis 5 min sur B → A reçoit 10 min, B 5 min', async () => {
    const before = await spent(a._id);
    await editor.client.post('/timer/start', { kind: 'stopwatch', taskId: a._id });
    await rewind(editor.id, 10 * MIN);
    expect((await editor.client.post('/timer/switch', { taskId: b._id })).body.timer.taskName).toBe('B');
    await rewind(editor.id, 5 * MIN);
    await editor.client.post('/timer/stop');
    expect(Math.round((await spent(a._id)) - before)).toBeGreaterThanOrEqual(10 * 60 - 1);
    expect((await spent(a._id)) - before).toBeLessThan(10 * 60 + 5);
    expect(await spent(b._id)).toBeGreaterThanOrEqual(5 * 60 - 1);
    expect(await spent(b._id)).toBeLessThan(5 * 60 + 5);
  });

  it('saisie manuelle (début + durée), commentaire ≤ 200, labels ; modifiable par l’auteur seul', async () => {
    const r = await editor.client.post('/time-entries', {
      taskId: b._id,
      startAt: new Date(Date.now() - 3 * 3_600_000),
      durationSeconds: 1800,
      comment: 'Revue de code',
      timeLabels: ['Facturable'],
    });
    expect(r.status).toBe(201);
    expect(
      (
        await editor.client.post('/time-entries', {
          taskId: b._id,
          startAt: new Date(),
          durationSeconds: 600,
          comment: 'x'.repeat(201),
        })
      ).status,
    ).toBe(400);
    expect((await editor.client.get('/time-entries/labels')).body).toEqual(['Facturable']);
    expect((await owner.client.patch(`/time-entries/${r.body._id}`, { comment: 'pirate' })).status).toBe(403);
    expect(
      (await editor.client.patch(`/time-entries/${r.body._id}`, { comment: 'Revue' })).body.comment,
    ).toBe('Revue');
    const before = await spent(b._id);
    expect((await editor.client.del(`/time-entries/${r.body._id}`)).status).toBe(204);
    expect(await spent(b._id)).toBe(before - 1800);
  });

  it('visibilité : chacun voit ses entrées ; le propriétaire du board voit tout ; le lecteur ne saisit pas', async () => {
    await owner.client.post('/time-entries', {
      taskId: a._id,
      startAt: new Date(Date.now() - 3_600_000),
      durationSeconds: 600,
    });
    const mine = (await editor.client.get(`/boards/${board._id}/tasks/${a._id}/time-entries`)).body as {
      userId: string;
    }[];
    expect(mine.every((e) => e.userId === editor.id)).toBe(true);
    const all = (await owner.client.get(`/boards/${board._id}/tasks/${a._id}/time-entries`)).body as {
      userId: string;
    }[];
    expect(new Set(all.map((e) => e.userId))).toEqual(new Set([editor.id, owner.id]));
    expect((await reader.client.post('/timer/start', { kind: 'stopwatch', taskId: a._id })).status).toBe(403);
  });

  it('Pomodoro désactivé : impossible à lancer ; réglages partiels conservés', async () => {
    await editor.client.patch('/me', { pomodoro: { workMinutes: 50 } });
    await editor.client.patch('/me', { pomodoro: { enabled: false } });
    expect((await editor.client.get('/me')).body.pomodoro).toEqual({ workMinutes: 50, enabled: false });
    expect((await editor.client.post('/timer/start', { kind: 'pomodoro', taskId: a._id })).body.code).toBe(
      'POMODORO_DISABLED',
    );
  });
});
