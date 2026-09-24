# CLAUDE.md · alafia-backend

API NestJS 11 + Prisma 6 + PostgreSQL 16 de la plateforme e-Santé **Alafia** (test technique MTDI Bénin). Le frontend est dans `../alafia-frontend`. Contexte complet et reprise du chantier : `../CLAUDE.md`.

## Commandes

```bash
npm install && npx prisma generate
npm run typecheck && npm run lint && npm test
docker compose up                 # PostgreSQL + API + seed sur :4000 (Swagger : /docs)
npm run db:setup                  # sans Docker : schéma + trigger d'audit + seed (DATABASE_URL dans .env)
npm run dev
```

## Architecture

- `src/common/` : `AccessService` (point unique de décision d'accès à un dossier patient, journalise lectures et refus), `AuditService` (journal en ajout seul), `CryptoService` (AES-256-GCM par champ, HMAC du NPI, signatures), `OutboxService` (SMS / voix / push, refuse toute donnée médicale), `SessionGuard` global (cookie `alafia_session`, décorateurs `@Public()` et `@Roles()`).
- Un dossier par module métier : `auth`, `patients` (M1-M2), `care-map` (M11), `blood` (M4), `medications` (M5), `emergency` (M7), `maternal` (M10), `care` (M3, M6), `alerts` (M13), `dashboard` (M9), `channels` (SMS, USSD, tâches planifiées).
- `src/data/` : référentiels publics réels (départements, communes, établissements, médicaments, vaccins, arbre d'orientation). `prisma/seed.ts` : personas et données fictives, déterministes.
- Vercel : `api/index.js` → `dist/serverless.js` ; build `npm run vercel-build`.

## Règles

- Toute lecture d'un dossier patient passe par `AccessService.assert()` ; jamais de donnée médicale dans un SMS.
- Messages et libellés visibles en français. Validation DTO systématique (`class-validator`).
- Git : `main` est gelée (socle initial). Travailler sur `develop`, un commit conventionnel par module **vérifié** (compile, tests verts, testé à la main). Ne jamais pousser ni fusionner sur `main` sans l'accord explicite de l'utilisateur.
- Aucun secret dans le dépôt (`.env.example` seulement).
