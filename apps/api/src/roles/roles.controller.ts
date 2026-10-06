import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CustomRoleInput } from '@flowboard/shared';
import { AdminOnly, CurrentUser } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import type { PublicUser } from '../users/user.entity';
import { RolesService } from './roles.service';

@Controller()
export class RolesController {
  constructor(private roles: RolesService) {}

  /** Liste lisible par tous : choix du rôle d'un membre dans les réglages d'un board. */
  @Get('roles')
  list() {
    return this.roles.list();
  }

  @AdminOnly()
  @Post('admin/roles')
  create(@CurrentUser() actor: PublicUser, @Body(new Zod(CustomRoleInput)) body: CustomRoleInput) {
    return this.roles.create(actor, body);
  }

  @AdminOnly()
  @Patch('admin/roles/:id')
  update(
    @CurrentUser() actor: PublicUser,
    @Param('id') id: string,
    @Body(new Zod(CustomRoleInput)) body: CustomRoleInput,
  ) {
    return this.roles.update(actor, id, body);
  }

  @AdminOnly()
  @Delete('admin/roles/:id')
  @HttpCode(204)
  remove(@CurrentUser() actor: PublicUser, @Param('id') id: string) {
    return this.roles.remove(actor, id);
  }
}
