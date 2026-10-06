import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UpdateSettingsInput } from '@flowboard/shared';
import { AuditService } from '../audit/audit.service';
import { AdminOnly, CurrentUser, Public } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import { config } from '../config/config';
import type { PublicUser } from '../users/user.entity';
import { SettingsService } from './settings.service';

/** Paramètres d'instance (spec § 4.11) : lecture publique (écran de connexion), modification admin. */
@Controller()
export class SettingsController {
  constructor(
    private settings: SettingsService,
    private audit: AuditService,
  ) {}

  @Public()
  @Get('settings')
  async get() {
    // `googleAvailable` : le client OAuth est configuré côté serveur (l'écran de connexion affiche alors le bouton).
    return {
      ...(await this.settings.get()),
      googleAvailable: !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
    };
  }

  @AdminOnly()
  @Patch('admin/settings')
  async update(
    @Body(new Zod(UpdateSettingsInput)) body: UpdateSettingsInput,
    @CurrentUser() actor: PublicUser,
  ) {
    await this.audit.log(actor._id, 'settings.update', null, body);
    return this.settings.update(body);
  }
}
