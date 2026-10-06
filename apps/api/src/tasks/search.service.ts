import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { normalize } from '@flowboard/shared';
import { Db } from '../database/db.service';
import type { PublicUser } from '../users/user.entity';
import { TasksService } from './tasks.service';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Recherche globale (spec § 4.5) : tous les mots doivent apparaître (sous-chaîne, sans accents ni casse)
 * dans le texte dénormalisé des tâches des boards accessibles.
 * ponytail: regex non ancrée = parcours des tâches des boards visibles ; mesuré < 500 ms sur 50 000 tâches
 * (test search.spec). Passer à un index texte Mongo si le volume explose.
 */
@Injectable()
export class SearchService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private db: Db,
    private tasks: TasksService,
  ) {}

  /** Rattrapage des tâches créées avant l'existence du champ de recherche. */
  async onApplicationBootstrap() {
    const missing = await this.db.tasks
      .find({ searchText: { $exists: false } })
      .project<{ _id: string }>({ _id: 1 })
      .toArray();
    for (const t of missing) await this.tasks.refreshSearch(t._id);
    if (missing.length) this.logger.log(`Texte de recherche calculé pour ${missing.length} tâche(s)`);
  }

  async search(user: PublicUser, query: string, includeArchived: boolean) {
    const words = normalize(query).split(/\s+/).filter(Boolean).slice(0, 10);
    if (!words.length) return [];
    const boards = await this.db.boards
      .find(
        user.globalRole === 'admin' ? { deletedAt: null } : { 'members.userId': user._id, deletedAt: null },
      )
      .project<{ _id: string; name: string; columns: { _id: string; name: string }[] }>({
        name: 1,
        columns: 1,
      })
      .toArray();
    const tasks = await this.db.tasks
      .find({
        boardId: { $in: boards.map((b) => b._id) },
        ...(includeArchived ? {} : { archivedAt: null }),
        $and: words.map((w) => ({ searchText: { $regex: escapeRegex(w) } })),
      })
      .project<{
        _id: string;
        boardId: string;
        columnId: string;
        name: string;
        color: string;
        archivedAt: Date | null;
      }>({
        name: 1,
        boardId: 1,
        columnId: 1,
        color: 1,
        archivedAt: 1,
      })
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray();
    return tasks.map((t) => {
      const board = boards.find((b) => b._id === t.boardId)!;
      return {
        ...t,
        boardName: board.name,
        columnName: board.columns.find((c) => c._id === t.columnId)?.name ?? '',
      };
    });
  }
}
