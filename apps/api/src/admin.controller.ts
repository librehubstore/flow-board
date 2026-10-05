import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateUserInput, TransferInput, UpdateSettingsInput, UpdateUserInput } from '@flowboard/shared';
import { AuditService } from './audit.service';
import { AuthService, hidePassword } from './auth.service';
import { BoardsService } from './boards.service';
import { Db, PublicUser } from './db';
import { fail } from './errors';
import { AdminOnly, CurrentUser, Zod } from './http';
import { SettingsService } from './settings.service';
import { Realtime } from './realtime.service';

/** Administration de l'instance (spec § 4.1, § 4.11). */
@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(
    private db: Db,
    private auth: AuthService,
    private audit: AuditService,
    private boards: BoardsService,
    private settings: SettingsService,
    private realtime: Realtime,
  ) {}

  @Get('users')
  users() {
    return this.db.users.find({}, hidePassword).sort({ status: 1, fullName: 1 }).toArray();
  }

  @Post('users')
  async createUser(@Body(new Zod(CreateUserInput)) body: CreateUserInput, @CurrentUser() actor: PublicUser) {
    const user = await this.auth.createUser(body);
    await this.audit.log(actor._id, 'user.create', user._id, { username: user.username, globalRole: user.globalRole });
    return user;
  }

  @Patch('users/:id')
  async updateUser(@Param('id') id: string, @Body(new Zod(UpdateUserInput)) body: UpdateUserInput, @CurrentUser() actor: PublicUser) {
    const target = await this.db.users.findOne({ _id: id }, hidePassword);
    if (!target) fail(404, 'NOT_FOUND');
    const losesAdmin =
      target.globalRole === 'admin' &&
      target.status === 'active' &&
      (body.globalRole === 'user' || body.status === 'disabled');
    // ponytail: vérification non atomique ; deux rétrogradations simultanées pourraient passer, risque négligeable en usage interne.
    if (losesAdmin && !(await this.db.users.countDocuments({ _id: { $ne: id }, globalRole: 'admin', status: 'active' })))
      fail(409, 'LAST_ADMIN');
    await this.db.users.updateOne({ _id: id }, { $set: body });
    if (body.status === 'disabled') {
      await this.auth.revokeAll(id);
      this.realtime.kick(id);
    }
    await this.audit.log(actor._id, 'user.update', id, body);
    return this.db.users.findOne({ _id: id }, hidePassword);
  }

  @Post('users/:id/reset-password')
  async resetPassword(@Param('id') id: string, @CurrentUser() actor: PublicUser) {
    const temporaryPassword = await this.auth.resetPassword(id);
    await this.audit.log(actor._id, 'user.resetPassword', id);
    return { temporaryPassword };
  }

  @Get('boards')
  allBoards() {
    return this.boards.listAll();
  }

  @Post('boards/:id/restore')
  restore(@Param('id') id: string, @CurrentUser() actor: PublicUser) {
    return this.boards.restore(actor, id);
  }

  @Post('boards/:id/transfer')
  transfer(@Param('id') id: string, @Body(new Zod(TransferInput)) body: TransferInput, @CurrentUser() actor: PublicUser) {
    return this.boards.transfer(actor, id, body.userId);
  }

  @Patch('settings')
  async updateSettings(@Body(new Zod(UpdateSettingsInput)) body: UpdateSettingsInput, @CurrentUser() actor: PublicUser) {
    await this.audit.log(actor._id, 'settings.update', null, body);
    return this.settings.update(body);
  }

  @Get('audit')
  auditLog() {
    return this.audit.list();
  }
}
