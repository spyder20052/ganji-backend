import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.factory';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let cached: Promise<Handler> | null = null;

/** Point d'entrée Vercel : l'application Nest est initialisée une fois par instance puis réutilisée. */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!cached) {
    cached = createApp().then(async (app) => {
      await app.init();
      return app.getHttpAdapter().getInstance() as Handler;
    });
  }
  const express = await cached;
  express(req, res);
}
