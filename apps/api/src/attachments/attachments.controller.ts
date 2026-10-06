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
import { diskStorage } from 'multer';
import type { Board } from '../boards/board.entity';
import { CurrentBoard, CurrentUser, Perm } from '../common/decorators';
import { config } from '../config/config';
import type { PublicUser } from '../users/user.entity';
import { AttachmentsService } from './attachments.service';

mkdirSync(config.UPLOAD_DIR, { recursive: true });
/** Plafond technique de multer ; la limite réelle (paramètre d'instance) est vérifiée par le service. */
const HARD_LIMIT = 1024 * 1024 * 1024;

@Controller('boards/:boardId')
export class AttachmentsController {
  constructor(private attachments: AttachmentsService) {}

  @Perm('board.view')
  @Get('tasks/:taskId/attachments')
  list(@CurrentBoard() board: Board, @Param('taskId') taskId: string) {
    return this.attachments.list(board, taskId);
  }

  @Perm('task.edit')
  @Post('tasks/:taskId/attachments')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: diskStorage({
        destination: config.UPLOAD_DIR,
        filename: (_req, _file, cb) => cb(null, randomUUID()),
      }),
      limits: { fileSize: HARD_LIMIT },
    }),
  )
  upload(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('taskId') taskId: string,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.attachments.add(board, user, taskId, files);
  }

  @Perm('board.view')
  @Get('attachments/:id')
  async download(@CurrentBoard() board: Board, @Param('id') id: string, @Res() res: Response) {
    const file = await this.attachments.download(board, id);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', file.disposition);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(file.path);
  }

  @Perm('task.edit')
  @Delete('attachments/:id')
  @HttpCode(204)
  remove(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.attachments.remove(board, user, id);
  }
}
