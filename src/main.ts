import 'reflect-metadata';
import { loadDotEnv } from './common/env';
loadDotEnv();
import { createApp } from './app.factory';

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`API Ganji prête sur http://localhost:${port} (documentation : /docs)`);
}
void bootstrap();
