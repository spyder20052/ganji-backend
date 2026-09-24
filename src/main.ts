import 'reflect-metadata';
import { createApp } from './app.factory';

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`API Alafia prête sur http://localhost:${port} (documentation : /docs)`);
}
void bootstrap();
