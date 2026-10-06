import { io, Socket } from 'socket.io-client';
import { DueRemindersService } from '../src/tasks/due-reminders.service';
import { Client, loginAdmin, makeApp, makeUser } from './helpers';

describe('Lots 4-5 — temps réel, commentaires, mentions, notifications, pièces jointes', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Client;
  let owner: { id: string; client: Client };
  let editor: { id: string; client: Client };
  let reader: { id: string; client: Client };
  let outsider: { id: string; client: Client };
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ctx = await makeApp(true);
    admin = await loginAdmin(ctx.http);
    owner = await makeUser(ctx.http, admin, 'owner');
    editor = await makeUser(ctx.http, admin, 'editor');
    reader = await makeUser(ctx.http, admin, 'reader');
    outsider = await makeUser(ctx.http, admin, 'outsider');
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await ctx.close();
  });

  async function newBoard() {
    const b = (await owner.client.post('/boards', { name: 'Collab' })).body;
    await owner.client.post(`/boards/${b._id}/members`, { userId: editor.id, role: 'editor' });
    await owner.client.post(`/boards/${b._id}/members`, { userId: reader.id, role: 'reader' });
    return b as { _id: string; columns: { _id: string }[]; completionColumnId: string };
  }
  const task = (boardId: string, name: string) =>
    editor.client.post(`/boards/${boardId}/tasks`, { name }).then((r) => r.body);

  function connect(c: Client) {
    const s = io(ctx.url, {
      path: '/api/socket.io',
      extraHeaders: { cookie: c.cookie },
      transports: ['websocket'],
    });
    sockets.push(s);
    return s;
  }
  const join = (s: Socket, boardId: string) => s.emitWithAck('join', boardId) as Promise<{ ok: boolean }>;
  const next = <T>(s: Socket, event: string, ms = 2000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`pas d'événement ${event} en ${ms} ms`)), ms);
      s.once(event, (p: T) => {
        clearTimeout(timer);
        resolve(p);
      });
    });
  const silent = (s: Socket, event: string, ms = 500) =>
    new Promise<boolean>((resolve) => {
      const handler = () => resolve(false);
      s.once(event, handler);
      setTimeout(() => {
        s.off(event, handler);
        resolve(true);
      }, ms);
    });

  describe('temps réel (§ 4.2)', () => {
    it('un déplacement est reçu par un autre membre en moins de 2 s', async () => {
      const b = await newBoard();
      const t = await task(b._id, 'A');
      const watcher = connect(owner.client);
      expect(await join(watcher, b._id)).toEqual({ ok: true });
      const received = next<{ _id: string; columnId: string; updatedById: string }>(watcher, 'task');
      const started = Date.now();
      await editor.client.post(`/boards/${b._id}/tasks/${t._id}/move`, { columnId: b.columns[2]._id });
      const evt = await received;
      expect(Date.now() - started).toBeLessThan(2000);
      expect(evt).toMatchObject({ _id: t._id, columnId: b.columns[2]._id, updatedById: editor.id });
    });

    it('changement de structure et archivage diffusés', async () => {
      const b = await newBoard();
      const t = await task(b._id, 'A');
      const s = connect(reader.client);
      await join(s, b._id);
      const changed = next(s, 'board.changed');
      await owner.client.post(`/boards/${b._id}/columns`, { name: 'Revue' });
      await changed;
      const removed = next<string[]>(s, 'tasks.removed');
      await editor.client.post(`/boards/${b._id}/tasks/archive`, { taskIds: [t._id] });
      expect(await removed).toEqual([t._id]);
    });

    it('non-membre refusé, socket sans session déconnectée', async () => {
      const b = await newBoard();
      expect(await join(connect(outsider.client), b._id)).toEqual({ ok: false });
      const anon = io(ctx.url, { path: '/api/socket.io', transports: ['websocket'] });
      sockets.push(anon);
      await next(anon, 'disconnect');
    });

    it('un membre retiré du board ne reçoit plus rien', async () => {
      const b = await newBoard();
      const s = connect(reader.client);
      await join(s, b._id);
      await owner.client.del(`/boards/${b._id}/members/${reader.id}`);
      const quiet = silent(s, 'task');
      await task(b._id, 'secret');
      expect(await quiet).toBe(true);
    });
  });

  describe('commentaires, mentions et notifications (§ 4.3, § 9)', () => {
    const notifs = async (c: Client) =>
      (await c.get('/notifications')).body as { items: { type: string; taskId: string }[]; unread: number };

    it('mention @identifiant → notification ; le responsable est notifié du commentaire', async () => {
      const b = await newBoard();
      const t = await task(b._id, 'A');
      await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { responsibleUserId: reader.id });
      const before = (await notifs(owner.client)).items.length;
      const c = await editor.client.post(`/boards/${b._id}/tasks/${t._id}/comments`, {
        text: 'Avis @owner ? (@outsider pas membre)',
      });
      expect(c.status).toBe(201);
      const ownerNotifs = await notifs(owner.client);
      expect(ownerNotifs.items.length).toBe(before + 1);
      expect(ownerNotifs.items[0]).toMatchObject({ type: 'mentioned', taskId: t._id });
      expect((await notifs(outsider.client)).items).toHaveLength(0);
      expect((await notifs(reader.client)).items.map((n) => n.type)).toEqual(['commented', 'assigned']);
      const full = (await owner.client.get(`/boards/${b._id}`)).body.tasks.find(
        (x: { _id: string }) => x._id === t._id,
      );
      expect(full.commentsCount).toBe(1);
    });

    it('le lecteur ne commente pas ; seul l’auteur modifie ou supprime', async () => {
      const b = await newBoard();
      const t = await task(b._id, 'A');
      expect(
        (await reader.client.post(`/boards/${b._id}/tasks/${t._id}/comments`, { text: 'x' })).status,
      ).toBe(403);
      const c = (await editor.client.post(`/boards/${b._id}/tasks/${t._id}/comments`, { text: 'v1' })).body;
      expect(
        (await owner.client.patch(`/boards/${b._id}/tasks/${t._id}/comments/${c._id}`, { text: 'pirate' }))
          .status,
      ).toBe(403);
      const edited = (
        await editor.client.patch(`/boards/${b._id}/tasks/${t._id}/comments/${c._id}`, { text: 'v2' })
      ).body;
      expect(edited.updatedAt).not.toBeNull();
      expect((await editor.client.del(`/boards/${b._id}/tasks/${t._id}/comments/${c._id}`)).status).toBe(204);
      expect((await reader.client.get(`/boards/${b._id}/tasks/${t._id}/comments`)).body).toHaveLength(0);
      const types = (await ctx.db.events.find({ taskId: t._id }).toArray()).map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['commentCreated', 'commentChanged', 'commentDeleted']));
    });

    it('assignation de sous-tâche notifiée ; s’assigner soi-même ne notifie pas ; préférences respectées', async () => {
      const b = await newBoard();
      const t = await task(b._id, 'A');
      await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { responsibleUserId: editor.id });
      expect((await notifs(editor.client)).items).toHaveLength(0);

      await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, {
        subtasks: [{ _id: 's1', name: 'relire', done: false, assigneeId: owner.id }],
      });
      expect((await notifs(owner.client)).items[0].type).toBe('subtaskAssigned');

      await owner.client.patch('/me', { notificationPrefs: { assigned: false } });
      const count = (await notifs(owner.client)).items.length;
      await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { responsibleUserId: owner.id });
      expect((await notifs(owner.client)).items.length).toBe(count);
    });

    it('notification poussée en temps réel, puis marquée comme lue', async () => {
      const b = await newBoard();
      const t = await task(b._id, 'A');
      const s = connect(reader.client);
      await join(s, b._id);
      const pushed = next<{ type: string }>(s, 'notification');
      await editor.client.patch(`/boards/${b._id}/tasks/${t._id}`, { responsibleUserId: reader.id });
      expect((await pushed).type).toBe('assigned');
      expect((await notifs(reader.client)).unread).toBeGreaterThan(0);
      await reader.client.post('/notifications/read', {});
      expect((await notifs(reader.client)).unread).toBe(0);
    });

    it('échéance J-1 puis dépassée : notifiée une seule fois chacune', async () => {
      const b = await newBoard();
      const soon = await task(b._id, 'bientôt');
      const late = await task(b._id, 'en retard');
      const hour = 3_600_000;
      for (const [t, dueAt] of [
        [soon, new Date(Date.now() + 12 * hour)],
        [late, new Date(Date.now() - 2 * hour)],
      ] as const)
        await owner.client.patch(`/boards/${b._id}/tasks/${t._id}`, {
          responsibleUserId: editor.id,
          dueAt,
          dueHasTime: true,
        });
      const service = ctx.app.get(DueRemindersService);
      await service.check();
      await service.check();
      const items = (await notifs(editor.client)).items.filter(
        (n) => n.type.startsWith('due') || n.type === 'overdue',
      );
      expect(items.map((n) => `${n.type}:${n.taskId === soon._id ? 'soon' : 'late'}`).sort()).toEqual([
        'dueSoon:soon',
        'overdue:late',
      ]);
    });
  });

  describe('pièces jointes (§ 4.3)', () => {
    it('upload multiple, téléchargement, compteur, suppression', async () => {
      const b = await newBoard();
      const t = await task(b._id, 'A');
      const up = await editor.client.agent
        .post(`/api/boards/${b._id}/tasks/${t._id}/attachments`)
        .set('x-flowboard-csrf', '1')
        .attach('files', Buffer.from('bonjour'), { filename: 'note été.txt', contentType: 'text/plain' })
        .attach('files', Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
          filename: 'img.png',
          contentType: 'image/png',
        });
      expect(up.status).toBe(201);
      expect(up.body.map((a: { fileName: string }) => a.fileName)).toEqual(['note été.txt', 'img.png']);

      const txt = await reader.client.get(`/boards/${b._id}/attachments/${up.body[0]._id}`).buffer(true);
      expect(txt.headers['content-type']).toBe('application/octet-stream');
      expect(txt.headers['content-disposition']).toMatch(/^attachment/);
      expect(txt.body.toString()).toBe('bonjour');
      const png = await reader.client.get(`/boards/${b._id}/attachments/${up.body[1]._id}`);
      expect(png.headers['content-disposition']).toMatch(/^inline/);

      expect((await reader.client.del(`/boards/${b._id}/attachments/${up.body[0]._id}`)).status).toBe(403);
      expect((await editor.client.del(`/boards/${b._id}/attachments/${up.body[0]._id}`)).status).toBe(204);
      const full = (await owner.client.get(`/boards/${b._id}`)).body.tasks[0];
      expect(full.attachmentsCount).toBe(1);
      expect((await outsider.client.get(`/boards/${b._id}/attachments/${up.body[1]._id}`)).status).toBe(404);
    });

    it('taille maximale paramétrable → 413', async () => {
      const b = await newBoard();
      const t = await task(b._id, 'A');
      await admin.patch('/admin/settings', { maxAttachmentMb: 1 });
      const r = await editor.client.agent
        .post(`/api/boards/${b._id}/tasks/${t._id}/attachments`)
        .set('x-flowboard-csrf', '1')
        .attach('files', Buffer.alloc(1024 * 1024 + 1), 'big.bin');
      expect(r.status).toBe(413);
      expect(await ctx.db.attachments.countDocuments({ taskId: t._id })).toBe(0);
      await admin.patch('/admin/settings', { maxAttachmentMb: 25 });
    });
  });
});
