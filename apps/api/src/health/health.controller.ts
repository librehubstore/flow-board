import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/decorators';
import { Db } from '../database/db.service';

/** Sonde de disponibilité : 503 si MongoDB ne répond pas (utilisée par le HEALTHCHECK Docker). */
@Controller('health')
export class HealthController {
  constructor(private db: Db) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.db.ping();
    } catch {
      throw new ServiceUnavailableException({ status: 'error', mongo: 'down' });
    }
    return { status: 'ok' };
  }
}
