import { Client, loginAdmin, makeApp, makeUser } from './helpers';

describe('Lot 9 — rapport de temps et exports (§ 4.7, § 8)', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let owner: { id: string; client: Client };
  let editor: { id: string; client: Client };
  let board: { _id: string };
  let a: { _id: string };
  let b: { _id: string };
  const day = '2026-09-14'; // lundi

  const at = (hhmm: string) => new Date(`${day}T${hhmm}:00Z`);
  const log = (c: Client, taskId: string, start: string, minutes: number, timeLabels: string[] = []) =>
    c.post('/time-entries', { taskId, startAt: at(start), durationSeconds: minutes * 60, timeLabels });
  const report = (c: Client, params: Record<string, string>) =>
    c.get(
      `/reports/time?${new URLSearchParams({ from: `${day}T00:00:00Z`, to: `${day}T23:59:59Z`, ...params })}`,
    );

  beforeAll(async () => {
    ctx = await makeApp();
    const admin = await loginAdmin(ctx.http);
    owner = await makeUser(ctx.http, admin, 'owner');
    editor = await makeUser(ctx.http, admin, 'editor');
    board = (await owner.client.post('/boards', { name: 'Compta' })).body;
    await owner.client.post(`/boards/${board._id}/members`, { userId: editor.id, role: 'editor' });
    a = (await owner.client.post(`/boards/${board._id}/tasks`, { name: '=Facture' })).body;
    b = (await owner.client.post(`/boards/${board._id}/tasks`, { name: 'Relance' })).body;
    await log(editor.client, a._id, '09:00', 60, ['Facturable']);
    await log(editor.client, b._id, '10:00', 30);
    await log(owner.client, a._id, '14:00', 90, ['Facturable']);
  });
  afterAll(() => ctx.close());

  it('regroupement par utilisateur : les totaux correspondent à la somme des entrées', async () => {
    const r = (await report(owner.client, { groupBy: 'user' })).body;
    expect(r.total).toBe((60 + 30 + 90) * 60);
    expect(
      Object.fromEntries(r.rows.map((x: { label: string; seconds: number }) => [x.label, x.seconds])),
    ).toEqual({
      OWNER: 90 * 60,
      EDITOR: 90 * 60,
    });
  });

  it('un éditeur ne voit que son temps ; le propriétaire voit celui de tous', async () => {
    expect((await report(editor.client, { groupBy: 'user' })).body.total).toBe(90 * 60);
  });

  it('période : une entrée à cheval n’est comptée que pour la partie incluse', async () => {
    const r = await editor.client.get(
      `/reports/time?${new URLSearchParams({ from: `${day}T09:30:00Z`, to: `${day}T10:15:00Z`, groupBy: 'task' })}`,
    );
    expect(r.body.rows).toEqual([
      expect.objectContaining({ label: '=Facture', seconds: 30 * 60 }),
      expect.objectContaining({ label: 'Relance', seconds: 15 * 60 }),
    ]);
  });

  it('regroupements par label, board, jour et semaine ; filtres utilisateurs et labels', async () => {
    const labels = (await report(owner.client, { groupBy: 'label' })).body.rows;
    expect(labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'Facturable', seconds: 150 * 60 }),
        expect.objectContaining({ key: '', label: '—', seconds: 30 * 60 }),
      ]),
    );
    expect((await report(owner.client, { groupBy: 'board' })).body.rows).toEqual([
      expect.objectContaining({ label: 'Compta', seconds: 180 * 60 }),
    ]);
    expect((await report(owner.client, { groupBy: 'day', timeZone: 'Europe/Paris' })).body.rows[0].key).toBe(
      day,
    );
    expect((await report(owner.client, { groupBy: 'week' })).body.rows[0].key).toBe('2026-S38');
    expect((await report(owner.client, { users: editor.id, labels: 'Facturable' })).body.total).toBe(60 * 60);
  });

  it('export CSV : BOM, « ; », ligne de total, formules neutralisées', async () => {
    const r = await report(owner.client, { groupBy: 'task', format: 'csv' });
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    const lines = r.text.split('\r\n');
    expect(lines[0]).toBe('﻿Regroupement;Heures;Secondes');
    expect(lines).toContain("'=Facture;2,50;9000");
    expect(lines).toContain('Total;3,00;10800');
    expect((await report(owner.client, { from: 'pas une date' })).status).toBe(400);
  });

  it('export CSV des tâches d’un board, archivées comprises', async () => {
    await owner.client.post(`/boards/${board._id}/tasks/archive`, { taskIds: [b._id] });
    const r = await editor.client.get(`/boards/${board._id}/export.csv`);
    expect(r.headers['content-disposition']).toMatch(/attachment/);
    expect(r.text).toContain('Relance');
    expect(r.text.split('\r\n')[0]).toContain('Archivée le');
  });
});
