import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateUserInput, UpdateUserInput } from '@flowboard/shared';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AdminOnly, CurrentUser } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import type { PublicUser } from './user.entity';
import { UsersService } from './users.service';

/** Gestion des comptes par l'administrateur (spec § 4.1, § 4.11) ; chaque action est auditée. */
@AdminOnly()
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private users: UsersService,
    private auth: AuthService,
    private audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  async create(@Body(new Zod(CreateUserInput)) body: CreateUserInput, @CurrentUser() actor: PublicUser) {
    const user = await this.users.create(body);
    await this.audit.log(actor._id, 'user.create', user._id, {
      username: user.username,
      globalRole: user.globalRole,
    });
    return user;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new Zod(UpdateUserInput)) body: UpdateUserInput,
    @CurrentUser() actor: PublicUser,
  ) {
    const user = await this.users.update(id, body);
    await this.audit.log(actor._id, 'user.update', id, body);
    return user;
  }

  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string, @CurrentUser() actor: PublicUser) {
    const temporaryPassword = await this.auth.resetPassword(id);
    await this.audit.log(actor._id, 'user.resetPassword', id);
    return { temporaryPassword };
  }
}
