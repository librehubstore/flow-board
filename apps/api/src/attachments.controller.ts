import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { diskStorage } from 'multer';
import { config } from './config';
import { Attachment, Board, Db, PublicUser } from './db';
import { fail } from './errors';
import { CurrentBoard, CurrentUser, Perm } from './http';
import { Realtime } from './realtime.service';
import { SettingsService } from './settings.service';
import { TasksService } from './tasks.service';

mkdirSync(config.UPLOAD_DIR, { recursive: true });
/** Seuls ces types s'affichent dans le navigateur ; tout le reste est servi en téléchargement (pas de HTML/SVG exécuté). */
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
const HARD_LIMIT = 1024 * 1024 * 1024;

/** Pièces jointes locales (spec § 4.3) : stockage disque, taille max paramétrable. */
@Controller('boards/:boardId')
export class AttachmentsController {
  constructor(
    private db: Db,
    private tasks: TasksService,
    private settings: SettingsService,
    private realtime: Realtime,
  ) {}

  @Perm('board.view')
  @Get('tasks/:taskId/attachments')
  async list(@CurrentBoard() board: Board, @Param('taskId') taskId: string) {
    await this.tasks.get(board, taskId);
    return this.db.attachments.find({ taskId }).sort({ createdAt: 1 }).toArray();
  }

  @Perm('task.edit')
  @Post('tasks/:taskId/attachments')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: diskStorage({ destination: config.UPLOAD_DIR, filename: (_req, _file, cb) => cb(null, randomUUID()) }),
      limits: { fileSize: HARD_LIMIT },
    }),
  )
  async upload(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('taskId') taskId: string,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    const discard = () => Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
    const task = await this.tasks.get(board, taskId).catch(async (e) => {
      await discard();
      throw e;
    });
    if (!files.length) fail(400, 'NO_FILE');
    const maxBytes = (await this.settings.get()).maxAttachmentMb * 1024 * 1024;
    if (files.some((f) => f.size > maxBytes)) {
      await discard();
      fail(413, 'FILE_TOO_LARGE');
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
    for (const d of docs)
      await this.tasks.log(board._id, taskId, user._id, 'attachmentAdded', { attachment: { old: null, new: d.fileName } });
    await this.counted(task._id, board._id, docs.length);
    return docs;
  }

  @Perm('board.view')
  @Get('attachments/:id')
  async download(@CurrentBoard() board: Board, @Param('id') id: string, @Res() res: Response) {
    const a = await this.db.attachments.findOne({ _id: id, boardId: board._id });
    if (!a) fail(404, 'NOT_FOUND');
    const inline = INLINE_TYPES.has(a.mimeType);
    res.setHeader('Content-Type', inline ? a.mimeType : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(join(config.UPLOAD_DIR, a.storageKey));
  }

  @Perm('task.edit')
  @Delete('attachments/:id')
  @HttpCode(204)
  async remove(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser, @Param('id') id: string) {
    const a = await this.db.attachments.findOne({ _id: id, boardId: board._id });
    if (!a) fail(404, 'NOT_FOUND');
    await this.db.attachments.deleteOne({ _id: id });
    await unlink(join(config.UPLOAD_DIR, a.storageKey)).catch(() => undefined);
    await this.tasks.log(board._id, a.taskId, user._id, 'attachmentDeleted', { attachment: { old: a.fileName, new: null } });
    await this.counted(a.taskId, board._id, -1);
  }

  private async counted(taskId: string, boardId: string, delta: number) {
    const t = await this.db.tasks.findOneAndUpdate({ _id: taskId }, { $inc: { attachmentsCount: delta } }, { returnDocument: 'after' });
    if (t) this.realtime.toBoard(boardId, 'task', t);
  }
}
