import { Injectable } from '@nestjs/common';
import type { Document } from 'mongodb';
import type { TimeReportQuery, TimeReportRow } from '@flowboard/shared';
import { BoardAccessService } from '../board-access/board-access.service';
import { Db } from '../database/db.service';
import type { PublicUser } from '../users/user.entity';
import { hours, toCsv } from './csv';

/** Rapports (spec § 4.7). Lecture seule sur les collections des autres modules. */
@Injectable()
export class ReportsService {
  constructor(
    private db: Db,
    private access: BoardAccessService,
  ) {}

  /**
   * Boards visibles et périmètre : sur les boards où l'on peut « voir le temps des autres », tout le temps ;
   * ailleurs, seulement le sien. L'admin voit tout.
   */
  private async scope(user: PublicUser) {
    const boards = await this.db.boards
      .find(
        user.globalRole === 'admin' ? { deletedAt: null } : { 'members.userId': user._id, deletedAt: null },
      )
      .project<{
        _id: string;
        name: string;
        members: { userId: string; role: string }[];
      }>({
        name: 1,
        members: 1,
      })
      .toArray();
    // Rôles prédéfinis ou personnalisés : les permissions sont résolues par le contrôle d'accès.
    const all: string[] = [];
    const own: string[] = [];
    for (const b of boards) {
      const perms = await this.access.permissionsFor(b.members.find((m) => m.userId === user._id)?.role);
      if (user.globalRole === 'admin' || perms.includes('time.viewOthers')) all.push(b._id);
      else if (perms.includes('reports.view')) own.push(b._id);
    }
    return { boards, all, own };
  }

  /** Rapport « temps passé » : parts d'entrées de temps découpées sur la période, regroupées et totalisées. */
  async time(user: PublicUser, q: TimeReportQuery) {
    const { boards, all, own } = await this.scope(user);
    const boardFilter = (ids: string[]) =>
      q.boards.length ? ids.filter((id) => q.boards.includes(id)) : ids;
    const pipeline: Document[] = [
      {
        $match: {
          running: false,
          startAt: { $lt: q.to },
          endAt: { $gt: q.from },
          ...(q.users.length ? { userId: { $in: q.users } } : {}),
          ...(q.labels.length ? { timeLabels: { $in: q.labels } } : {}),
        },
      },
      { $unwind: '$parts' },
      {
        $match: {
          'parts.startAt': { $lt: q.to },
          'parts.endAt': { $gt: q.from },
          $or: [
            { 'parts.boardId': { $in: boardFilter(all) } },
            { 'parts.boardId': { $in: boardFilter(own) }, userId: user._id },
          ],
        },
      },
      {
        // Une entrée à cheval sur la période n'est comptée que pour la partie incluse.
        $project: {
          userId: 1,
          taskId: '$parts.taskId',
          boardId: '$parts.boardId',
          labels: { $cond: [{ $gt: [{ $size: '$timeLabels' }, 0] }, '$timeLabels', ['']] },
          start: { $max: ['$parts.startAt', q.from] },
          seconds: {
            $divide: [
              { $subtract: [{ $min: ['$parts.endAt', q.to] }, { $max: ['$parts.startAt', q.from] }] },
              1000,
            ],
          },
        },
      },
    ];
    const key: Record<TimeReportQuery['groupBy'], Document | string> = {
      user: '$userId',
      task: '$taskId',
      board: '$boardId',
      label: '$labels',
      day: { $dateToString: { format: '%Y-%m-%d', date: '$start', timezone: q.timeZone } },
      week: { $dateToString: { format: '%G-S%V', date: '$start', timezone: q.timeZone } },
    };
    if (q.groupBy === 'label') pipeline.push({ $unwind: '$labels' });
    pipeline.push(
      { $group: { _id: key[q.groupBy], seconds: { $sum: '$seconds' } } },
      { $sort: { seconds: -1 } },
    );
    const groups = await this.db.timeEntries.aggregate<{ _id: string; seconds: number }>(pipeline).toArray();
    const rows: TimeReportRow[] = await this.label(q.groupBy, groups, boards);
    const total = rows.reduce((s, r) => s + r.seconds, 0);
    return { rows, total };
  }

  async timeCsv(user: PublicUser, q: TimeReportQuery) {
    const { rows, total } = await this.time(user, q);
    return toCsv(
      ['Regroupement', 'Heures', 'Secondes'],
      [...rows.map((r) => [r.label, hours(r.seconds), r.seconds]), ['Total', hours(total), total]],
    );
  }

  /** Libellés lisibles des clés de regroupement. */
  private async label(
    groupBy: TimeReportQuery['groupBy'],
    groups: { _id: string; seconds: number }[],
    boards: { _id: string; name: string }[],
  ) {
    const ids = groups.map((g) => g._id);
    const names = new Map<string, string>();
    if (groupBy === 'user')
      for (const u of await this.db.users
        .find({ _id: { $in: ids } })
        .project<{ _id: string; fullName: string }>({ fullName: 1 })
        .toArray())
        names.set(u._id, u.fullName);
    if (groupBy === 'task')
      for (const t of await this.db.tasks
        .find({ _id: { $in: ids } })
        .project<{ _id: string; name: string }>({ name: 1 })
        .toArray())
        names.set(t._id, t.name);
    if (groupBy === 'board') for (const b of boards) names.set(b._id, b.name);
    return groups.map((g) => ({
      key: g._id,
      label: names.get(g._id) ?? (g._id || '—'),
      seconds: Math.round(g.seconds),
    }));
  }

  /** Export CSV des tâches d'un board, archivées comprises (spec § 8). */
  async boardCsv(boardId: string) {
    const board = (await this.db.boards.findOne({ _id: boardId }))!;
    const tasks = await this.db.tasks
      .find({ boardId })
      .sort({ archivedAt: 1, columnId: 1, position: 1 })
      .toArray();
    const users = new Map(
      (await this.db.users.find().project<{ _id: string; fullName: string }>({ fullName: 1 }).toArray()).map(
        (u) => [u._id, u.fullName],
      ),
    );
    const name = <T extends { _id: string; name: string }>(list: T[], id: string | null) =>
      list.find((x) => x._id === id)?.name ?? '';
    const date = (d: Date | null | undefined) => (d ? d.toISOString() : '');
    return toCsv(
      [
        'Nom',
        'Description',
        'Colonne',
        'Swimlane',
        'Couleur',
        'Responsable',
        'Collaborateurs',
        'Labels',
        'Échéance',
        'Terminée le',
        'Archivée le',
        'Points',
        'Estimation (h)',
        'Temps passé (h)',
        'Sous-tâches',
        'Créée le',
      ],
      tasks.map((t) => [
        t.name,
        t.description,
        name(board.columns, t.columnId),
        name(board.swimlanes, t.swimlaneId),
        board.colorLabels[t.color] || t.color,
        users.get(t.responsibleUserId ?? '') ?? '',
        t.collaboratorIds.map((id) => users.get(id) ?? '').join(', '),
        t.labels.map((l) => name(board.labels, l.id)).join(', '),
        date(t.dueAt),
        date(t.completedAt),
        date(t.archivedAt),
        t.pointsEstimate,
        t.secondsEstimate ? hours(t.secondsEstimate) : '',
        hours(t.spentSeconds ?? 0),
        `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`,
        date(t.createdAt),
      ]),
    );
  }
}
