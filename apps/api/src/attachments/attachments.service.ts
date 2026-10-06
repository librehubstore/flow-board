import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Board } from '../boards/board.entity';
import { fail } from '../common/errors';
import { config } from '../config/config';
import { Db } from '../database/db.service';
import { SettingsService } from '../settings/settings.service';
import {
  BOARD_PURGED,
  TASK_DELETED,
  type BoardPurgedEvent,
  type TaskDeletedEvent,
} from '../tasks/task.entity';
import { TaskJournalService } from '../tasks/task-journal.service';
import { TasksService } from '../tasks/tasks.service';
import type { PublicUser } from '../users/user.entity';
import type { Attachment } from './attachment.entity';

/** Seuls ces types s'affichent dans le navigateur ; tout le reste est servi en téléchargement (pas de HTML/SVG exécuté). */
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

const filePath = (storageKey: string) => join(config.UPLOAD_DIR, storageKey);
const removeFile = (storageKey: string) => unlink(filePath(storageKey)).catch(() => undefined);

/** Pièces jointes locales (spec § 4.3) : stockage disque, taille max paramétrable. */
@Injectable()
export class AttachmentsService {
  constructor(
    private db: Db,
    private tasks: TasksService,
    private journal: TaskJournalService,
    private settings: SettingsService,
  ) {}

  async list(board: Board, taskId: string) {
    await this.tasks.get(board, taskId);
    return this.db.attachments.find({ taskId }).sort({ createdAt: 1 }).toArray();
  }

  /** Enregistre des fichiers déjà écrits sur disque par multer ; ils sont supprimés si la requête est refusée. */
  async add(board: Board, user: PublicUser, taskId: string, files: Express.Multer.File[]) {
    const discard = () => Promise.all(files.map((f) => removeFile(f.filename)));
    try {
      await this.tasks.get(board, taskId);
      if (!files.length) fail(400, 'NO_FILE');
      const maxBytes = (await this.settings.get()).maxAttachmentMb * 1024 * 1024;
      if (files.some((f) => f.size > maxBytes)) fail(413, 'FILE_TOO_LARGE');
    } catch (e) {
      await discard();
      throw e;
    }
    const docs: Attachment[] = files.map((f) => ({
      _id: randomUUID(),
      boardId: board._id,
      taskId,
      // multer décode le nom en latin1 : on le ré-interprète en UTF-8 (accents).
      fileName: Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 255),
      mimeType: f.mimetype || 'application/octet-stream',
      size: f.size,
      storageKey: f.filename,
      uploadedById: user._id,
      createdAt: new Date(),
    }));
    await this.db.attachments.insertMany(docs);
    await this.journal.logMany(
      docs.map((d) =>
        this.journal.event(board._id, taskId, user._id, 'attachmentAdded', {
          attachment: { old: null, new: d.fileName },
        }),
      ),
    );
    await this.tasks.adjustCounter(taskId, 'attachmentsCount', docs.length);
    return docs;
  }

  /** Fichier à servir et en-têtes de sécurité associés. */
  async download(board: Board, id: string) {
    const a = await this.find(board, id);
    const inline = INLINE_TYPES.has(a.mimeType);
    return {
      path: filePath(a.storageKey),
      contentType: inline ? a.mimeType : 'application/octet-stream',
      disposition: `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
    };
  }

  async remove(board: Board, user: PublicUser, id: string) {
    const a = await this.find(board, id);
    await this.db.attachments.deleteOne({ _id: id });
    await removeFile(a.storageKey);
    await this.journal.log(board._id, a.taskId, user._id, 'attachmentDeleted', {
      attachment: { old: a.fileName, new: null },
    });
    await this.tasks.adjustCounter(a.taskId, 'attachmentsCount', -1);
  }

  @OnEvent(TASK_DELETED)
  onTaskDeleted({ taskId }: TaskDeletedEvent) {
    return this.purge({ taskId });
  }

  @OnEvent(BOARD_PURGED)
  onBoardPurged({ boardId }: BoardPurgedEvent) {
    return this.purge({ boardId });
  }

  private async find(board: Board, id: string) {
    const a = await this.db.attachments.findOne({ _id: id, boardId: board._id });
    if (!a) fail(404, 'NOT_FOUND');
    return a;
  }

  private async purge(filter: { taskId: string } | { boardId: string }) {
    const files = await this.db.attachments
      .find(filter)
      .project<{ storageKey: string }>({ storageKey: 1 })
      .toArray();
    await Promise.all(files.map((f) => removeFile(f.storageKey)));
    await this.db.attachments.deleteMany(filter);
  }
}
