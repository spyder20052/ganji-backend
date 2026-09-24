// Fonction serverless Vercel : toutes les routes vont à l'application NestJS. Vercel compile ce
// fichier et trace ses imports (le code de src/ est embarqué sans étape de build séparée).
import handler from '../src/serverless';

export default handler;
