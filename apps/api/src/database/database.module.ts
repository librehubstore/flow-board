import { Global, Module } from '@nestjs/common';
import { Db } from './db.service';

/** Module global : une seule connexion MongoDB partagée par tous les modules. */
@Global()
@Module({ providers: [Db], exports: [Db] })
export class DatabaseModule {}
