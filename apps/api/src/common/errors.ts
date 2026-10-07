import { HttpException } from '@nestjs/common';

/** Erreur métier : `code` stable, traduit côté client (`errors.<code>`). */
export function fail(status: number, code: string, message = code): never {
  throw new HttpException({ statusCode: status, code, message }, status);
}
