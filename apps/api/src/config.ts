import { join, resolve } from 'node:path';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Configuration validée au démarrage : une variable invalide arrête le processus avec un message explicite. */
export const config = z
  .object({
    MONGO_URL: z.string().default('mongodb://localhost:27017/flowboard'),
    PORT: z.coerce.number().int().default(3000),
    ADMIN_USERNAME: z.string().optional(),
    ADMIN_PASSWORD: z.string().optional(),
    COOKIE_SECURE: bool.default(true),
    SESSION_DAYS: z.coerce.number().int().min(1).default(14),
    TRUST_PROXY: z.string().optional(),
    WEB_DIST: z.string().default(join(__dirname, '../../web/dist')),
    UPLOAD_DIR: z.string().default('uploads').transform((p) => resolve(p)),
  })
  .parse(process.env);
