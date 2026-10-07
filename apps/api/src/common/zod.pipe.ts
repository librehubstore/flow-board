import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validation des entrées par les schémas zod partagés avec le client (`@flowboard/shared`). */
export class Zod<T> implements PipeTransform {
  constructor(private schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success)
      throw new BadRequestException({ code: 'VALIDATION', message: 'Validation', issues: r.error.issues });
    return r.data;
  }
}
