import { Injectable, Logger } from '@nestjs/common';

type TickHandler = () => Promise<Record<string, number>>;

/**
 * Tâches de la tâche planifiée (/jobs/tick) : chaque module inscrit la sienne au démarrage
 * (rappels de rendez-vous, relances du cercle de soins…). Une tâche en échec n'arrête pas les autres.
 */
@Injectable()
export class TickRegistry {
  private readonly logger = new Logger(TickRegistry.name);
  private readonly handlers = new Map<string, TickHandler>();

  register(name: string, handler: TickHandler) {
    this.handlers.set(name, handler);
  }

  async runAll(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [name, h] of this.handlers) {
      try {
        out[name] = await h();
      } catch (e) {
        this.logger.error(`Tâche ${name} en échec : ${(e as Error).message}`);
        out[name] = { error: (e as Error).message };
      }
    }
    return out;
  }
}
