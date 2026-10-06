import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

// Fichiers d'environnement de apps/api : `.env.local` (non versionné) prime sur `.env` (valeurs par défaut versionnées).
// Une variable déjà présente dans l'environnement du processus n'est jamais écrasée.
const API_ROOT = join(__dirname, '..', '..');
for (const file of ['.env.local', '.env']) {
  const path = join(API_ROOT, file);
  if (existsSync(path)) process.loadEnvFile(path);
}

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
/** Variable facultative : une chaîne vide (cas de docker-compose `${VAR:-}`) vaut « non définie ». */
const optional = z
  .string()
  .optional()
  .transform((v) => v || undefined);

/** Configuration validée au démarrage : une variable invalide arrête le processus avec un message explicite. */
export const config = z
  .object({
    MONGO_URL: z.string().default('mongodb://localhost:27017/flowboard'),
    PORT: z.coerce.number().int().default(3000),
    ADMIN_USERNAME: optional,
    ADMIN_PASSWORD: optional,
    COOKIE_SECURE: bool.default(true),
    SESSION_DAYS: z.coerce.number().int().min(1).default(14),
    TRUST_PROXY: optional,
    WEB_DIST: z.string().default(join(API_ROOT, '..', 'web', 'dist')),
    UPLOAD_DIR: z
      .string()
      .default('uploads')
      .transform((p) => resolve(p)),
    /** URL publique de l'application (liens des emails, retour OAuth Google). Sans « / » final. */
    APP_URL: z
      .url()
      .default('http://localhost:5173')
      .transform((u) => u.replace(/\/+$/, '')),
    /** Client OAuth Google (console Google Cloud) : la connexion Google n'est proposée que s'il est défini. */
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    /** Envoi des emails par l'API transactionnelle Brevo ; sans clé, les emails sont seulement journalisés. */
    BREVO_API_KEY: optional,
    MAIL_FROM_EMAIL: z.email().default('no-reply@librehub.store'),
    MAIL_FROM_NAME: optional,
  })
  .parse(process.env);
