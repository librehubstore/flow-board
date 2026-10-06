import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_POMODORO,
  type InterruptInput,
  type ManualTimeInput,
  type PomodoroSettings,
  type UpdateTimeEntryInput,
} from '@flowboard/shared';
import { BoardAccessService } from '../board-access/board-access.service';
import { fail } from '../common/errors';
import { Db } from '../database/db.service';
import { Realtime } from '../realtime/realtime.service';
import { BOARD_PURGED, type BoardPurgedEvent } from '../tasks/task.entity';
import { TasksService } from '../tasks/tasks.service';
import type { PublicUser } from '../users/user.entity';
import type { TimeEntry, Timer } from './time-entry.entity';

const MIN = 60_000;

/**
 * Gestion du temps (spec § 4.6) : Pomodoro, chronomètre multi-tâches, saisie manuelle.
 * Les transitions du Pomodoro (fin de travail → pause → fin) sont évaluées à la lecture : aucune tâche planifiée.
 */
@Injectable()
export class TimeService {
  constructor(
    private db: Db,
    private access: BoardAccessService,
    private tasks: TasksService,
    private realtime: Realtime,
  ) {}

  // ---------- Minuteur ----------

  /** État courant, après application des transitions échues. */
  async state(user: PublicUser) {
    let timer = await this.db.timers.findOne({ _id: user._id });
    if (timer) timer = await this.advance(user, timer, new Date());
    return this.view(timer);
  }

  async start(user: PublicUser, kind: Timer['kind'], taskId: string) {
    const task = await this.trackableTask(user, taskId);
    if (await this.state(user).then((s) => s.timer)) fail(409, 'TIMER_RUNNING');
    const settings = pomodoroOf(user);
    if (kind === 'pomodoro' && !settings.enabled) fail(400, 'POMODORO_DISABLED');
    const now = new Date();
    const entry: TimeEntry = {
      _id: randomUUID(),
      userId: user._id,
      type: kind,
      startAt: now,
      endAt: null,
      running: true,
      parts: [{ taskId, boardId: task.boardId, startAt: now, endAt: null }],
      comment: '',
      timeLabels: [],
      success: null,
      targetWorkMinutes: kind === 'pomodoro' ? settings.workMinutes : null,
      interruptionReason: null,
      createdAt: now,
    };
    try {
      await this.db.timeEntries.insertOne(entry);
    } catch (e) {
      if ((e as { code?: number }).code === 11000) fail(409, 'TIMER_RUNNING'); // double clic / deux appareils
      throw e;
    }
    const cycle = (await this.db.timers.findOne({ _id: user._id }))?.cycle ?? 0;
    const timer: Timer = {
      _id: user._id,
      kind,
      phase: 'work',
      entryId: entry._id,
      taskId,
      boardId: task.boardId,
      startedAt: now,
      endsAt: kind === 'pomodoro' ? new Date(now.getTime() + settings.workMinutes * MIN) : null,
      cycle,
    };
    await this.db.timers.replaceOne({ _id: user._id }, timer, { upsert: true });
    return this.publish(user, timer);
  }

  /** Chronomètre : changer de tâche clôt la part courante et en ouvre une nouvelle, sans arrêter le temps. */
  async switchTask(user: PublicUser, taskId: string) {
    const timer = await this.db.timers.findOne({ _id: user._id });
    if (!timer || timer.kind !== 'stopwatch') fail(400, 'NO_STOPWATCH');
    if (timer.taskId === taskId) return this.view(timer);
    const task = await this.trackableTask(user, taskId);
    const now = new Date();
    await this.db.timeEntries.updateOne(
      { _id: timer.entryId! },
      { $set: { 'parts.$[open].endAt': now } },
      { arrayFilters: [{ 'open.endAt': null }] },
    );
    await this.db.timeEntries.updateOne(
      { _id: timer.entryId! },
      { $push: { parts: { taskId, boardId: task.boardId, startAt: now, endAt: null } } },
    );
    const next = { ...timer, taskId, boardId: task.boardId };
    await this.db.timers.replaceOne({ _id: user._id }, next);
    await this.recomputeSpent([timer.taskId]);
    return this.publish(user, next);
  }

  /** Arrête le chronomètre, ou saute la pause du Pomodoro. Un Pomodoro en cours s'interrompt avec un motif. */
  async stop(user: PublicUser) {
    const timer = await this.db.timers.findOne({ _id: user._id });
    if (!timer) return this.view(null);
    if (timer.kind === 'pomodoro' && timer.phase === 'work') fail(400, 'USE_INTERRUPT');
    if (timer.kind === 'stopwatch') await this.closeEntry(timer.entryId!, new Date(), {});
    await this.db.timers.deleteOne({ _id: user._id });
    return this.publish(user, null);
  }

  /** Pomodoro interrompu : enregistré « échoué » avec son motif (spec § 4.6). */
  async interrupt(user: PublicUser, input: InterruptInput) {
    const timer = await this.db.timers.findOne({ _id: user._id });
    if (!timer || timer.kind !== 'pomodoro' || timer.phase !== 'work') fail(400, 'NO_POMODORO');
    await this.closeEntry(timer.entryId!, new Date(), {
      success: false,
      interruptionReason: input.reason,
      comment: input.comment,
    });
    // Le cycle repart de zéro après une interruption.
    await this.db.timers.deleteOne({ _id: user._id });
    return this.publish(user, null);
  }

  /** Transitions échues : fin de travail → pause (courte ou longue) → fin du minuteur. */
  private async advance(user: PublicUser, timer: Timer, now: Date): Promise<Timer | null> {
    if (timer.kind !== 'pomodoro' || !timer.endsAt || now < timer.endsAt) return timer;
    const settings = pomodoroOf(user);
    if (timer.phase === 'work') {
      await this.closeEntry(timer.entryId!, timer.endsAt, { success: true });
      const cycle = timer.cycle + 1;
      const long = cycle % settings.longBreakEvery === 0;
      const minutes = long ? settings.longBreakMinutes : settings.shortBreakMinutes;
      const next: Timer = {
        ...timer,
        phase: long ? 'longBreak' : 'shortBreak',
        entryId: null,
        startedAt: timer.endsAt,
        endsAt: new Date(timer.endsAt.getTime() + minutes * MIN),
        cycle: long ? 0 : cycle,
      };
      // Conditionnel : deux lectures simultanées ne clôturent qu'une fois.
      const r = await this.db.timers.replaceOne(
        { _id: user._id, phase: 'work', entryId: timer.entryId },
        next,
      );
      if (!r.modifiedCount) return this.db.timers.findOne({ _id: user._id });
      this.realtime.toUser(user._id, 'timer', await this.view(next));
      return this.advance(user, next, now);
    }
    // Pause terminée : le minuteur s'arrête, le cycle est conservé pour la prochaine pause longue.
    await this.db.timers.updateOne(
      { _id: user._id, phase: timer.phase },
      { $set: { phase: 'shortBreak', endsAt: null, entryId: null } },
    );
    return null;
  }

  // ---------- Entrées de temps ----------

  async addManual(user: PublicUser, input: ManualTimeInput) {
    const task = await this.trackableTask(user, input.taskId);
    const endAt = input.endAt ?? new Date(input.startAt.getTime() + input.durationSeconds! * 1000);
    if (endAt <= input.startAt) fail(400, 'INVALID_PERIOD');
    const entry: TimeEntry = {
      _id: randomUUID(),
      userId: user._id,
      type: 'manual',
      startAt: input.startAt,
      endAt,
      running: false,
      parts: [{ taskId: task._id, boardId: task.boardId, startAt: input.startAt, endAt }],
      comment: input.comment,
      timeLabels: input.timeLabels,
      success: null,
      targetWorkMinutes: null,
      interruptionReason: null,
      createdAt: new Date(),
    };
    await this.db.timeEntries.insertOne(entry);
    await this.recomputeSpent([task._id]);
    return entry;
  }

  /** Entrées d'une tâche : les siennes, ou toutes avec la permission « voir le temps des autres ». */
  async listForTask(user: PublicUser, boardId: string, taskId: string) {
    const { permissions } = await this.access.access(boardId, user, 'board.view');
    return this.db.timeEntries
      .find({
        'parts.taskId': taskId,
        ...(permissions.includes('time.viewOthers') || user.globalRole === 'admin'
          ? {}
          : { userId: user._id }),
      })
      .sort({ startAt: -1 })
      .limit(200)
      .toArray();
  }

  /** Modification par l'auteur uniquement ; les dates ne sont modifiables que sur une entrée d'une seule part. */
  async update(user: PublicUser, id: string, input: UpdateTimeEntryInput) {
    const entry = await this.own(user, id);
    const set: Partial<TimeEntry> = {};
    if (input.comment !== undefined) set.comment = input.comment;
    if (input.timeLabels) set.timeLabels = input.timeLabels;
    if (input.startAt || input.endAt) {
      if (entry.parts.length !== 1) fail(400, 'MULTI_PART_ENTRY');
      const startAt = input.startAt ?? entry.startAt;
      const endAt = input.endAt ?? entry.endAt!;
      if (endAt <= startAt) fail(400, 'INVALID_PERIOD');
      Object.assign(set, { startAt, endAt, parts: [{ ...entry.parts[0], startAt, endAt }] });
    }
    await this.db.timeEntries.updateOne({ _id: id }, { $set: set });
    await this.recomputeSpent(entry.parts.map((p) => p.taskId));
    return { ...entry, ...set };
  }

  async remove(user: PublicUser, id: string) {
    const entry = await this.own(user, id);
    await this.db.timeEntries.deleteOne({ _id: id });
    await this.recomputeSpent(entry.parts.map((p) => p.taskId));
  }

  /** Labels de temps déjà utilisés (autocomplétion). */
  labels(user: PublicUser) {
    return this.db.timeEntries.distinct('timeLabels', { userId: user._id });
  }

  @OnEvent(BOARD_PURGED)
  async onBoardPurged({ boardId }: BoardPurgedEvent) {
    await this.db.timeEntries.deleteMany({ 'parts.boardId': boardId, running: false });
  }

  // ---------- Interne ----------

  private async own(user: PublicUser, id: string) {
    const entry = await this.db.timeEntries.findOne({ _id: id });
    if (!entry) fail(404, 'NOT_FOUND');
    if (entry.userId !== user._id) fail(403, 'FORBIDDEN');
    if (entry.running) fail(400, 'ENTRY_RUNNING');
    return entry;
  }

  /** La tâche existe et l'utilisateur peut saisir du temps sur son board. */
  private async trackableTask(user: PublicUser, taskId: string) {
    const task = await this.db.tasks.findOne({ _id: taskId }, { projection: { boardId: 1, name: 1 } });
    if (!task) fail(404, 'NOT_FOUND');
    await this.access.access(task.boardId, user, 'time.track');
    return task;
  }

  private async closeEntry(entryId: string, at: Date, set: Partial<TimeEntry>) {
    const entry = await this.db.timeEntries.findOneAndUpdate(
      { _id: entryId, running: true },
      { $set: { ...set, endAt: at, running: false, 'parts.$[open].endAt': at } },
      { arrayFilters: [{ 'open.endAt': null }], returnDocument: 'after' },
    );
    if (entry) await this.recomputeSpent(entry.parts.map((p) => p.taskId));
  }

  /** Temps passé d'une tâche = somme de ses parts terminées (spec § 4.6), dénormalisé sur la carte. */
  private async recomputeSpent(taskIds: string[]) {
    for (const taskId of new Set(taskIds)) {
      const [row] = await this.db.timeEntries
        .aggregate<{ seconds: number }>([
          { $match: { 'parts.taskId': taskId } },
          { $unwind: '$parts' },
          { $match: { 'parts.taskId': taskId, 'parts.endAt': { $ne: null } } },
          { $group: { _id: null, ms: { $sum: { $subtract: ['$parts.endAt', '$parts.startAt'] } } } },
          { $project: { seconds: { $round: [{ $divide: ['$ms', 1000] }, 0] } } },
        ])
        .toArray();
      await this.tasks.setSpent(taskId, row?.seconds ?? 0);
    }
  }

  private async publish(user: PublicUser, timer: Timer | null) {
    const view = await this.view(timer);
    this.realtime.toUser(user._id, 'timer', view);
    return view;
  }

  /** Vue client : `serverNow` permet au navigateur de corriger le décalage d'horloge. */
  private async view(timer: Timer | null) {
    if (!timer || (!timer.endsAt && timer.kind === 'pomodoro')) return { timer: null, serverNow: new Date() };
    const task = await this.db.tasks.findOne({ _id: timer.taskId }, { projection: { name: 1 } });
    const entry = timer.entryId ? await this.db.timeEntries.findOne({ _id: timer.entryId }) : null;
    const part = entry?.parts.find((p) => !p.endAt);
    return {
      timer: { ...timer, taskName: task?.name ?? '', partStartedAt: part?.startAt ?? timer.startedAt },
      serverNow: new Date(),
    };
  }
}

export const pomodoroOf = (user: PublicUser): PomodoroSettings => ({ ...DEFAULT_POMODORO, ...user.pomodoro });
