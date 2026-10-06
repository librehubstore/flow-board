import { Logger } from '@nestjs/common';

/**
 * Tâche périodique en arrière-plan : une erreur est journalisée au lieu de faire tomber le processus
 * (rejet de promesse non géré). `unref` : n'empêche pas l'arrêt du processus.
 */
export function every(ms: number, name: string, job: () => Promise<unknown>) {
  const logger = new Logger(name);
  return setInterval(
    () => job().catch((e: unknown) => logger.error(e instanceof Error ? e.stack : String(e))),
    ms,
  ).unref();
}
