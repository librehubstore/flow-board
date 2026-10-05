import { Injectable } from '@nestjs/common';
import type { UpdateSettingsInput } from '@flowboard/shared';
import { Db, Settings } from './db';

const DEFAULTS: Settings = {
  _id: 'instance',
  instanceName: 'Flowboard',
  defaultLocale: 'fr',
  defaultTimezone: 'Europe/Paris',
  maxAttachmentMb: 25,
};

@Injectable()
export class SettingsService {
  constructor(private db: Db) {}

  async get(): Promise<Settings> {
    return { ...DEFAULTS, ...(await this.db.settings.findOne({ _id: 'instance' })) };
  }

  async update(input: UpdateSettingsInput) {
    await this.db.settings.updateOne({ _id: 'instance' }, { $set: input }, { upsert: true });
    return this.get();
  }
}
