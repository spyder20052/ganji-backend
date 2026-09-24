# Alafia · API

API de la plateforme **Alafia** (santé de chaque Béninois, challenge e-Santé du MTDI) : NestJS 11, Prisma 6, PostgreSQL 16. Documentation OpenAPI interactive sur **`/docs`** (JSON : `/docs/openapi.json`).

| | |
|---|---|
| API déployée | [Lien] |
| Documentation Swagger | [Lien]/docs |
| Frontend | dépôt `alafia-frontend` |
| Sécurité | [`SECURITY.md`](SECURITY.md) |

> **Données fictives** pour toutes les personnes ; données publiques réelles (12 départements, 77 communes, établissements de santé, médicaments essentiels, calendrier vaccinal PEV) dans `src/data/`.

## Démarrer en une commande

```bash
docker compose up        # PostgreSQL + API + seed, sur http://localhost:4000
```

Sans Docker :

```bash
cp .env.example .env     # renseigner DATABASE_URL
npm install
npm run db:setup         # schéma + trigger d'audit + jeu de démo
npm run dev
```

## Scripts

| Commande | Effet |
|----------|-------|
| `npm test` / `npm run test:cov` | Tests Vitest (consentement, chiffrement, compatibilité sanguine, SMS sans donnée médicale) |
| `npm run lint` / `npm run typecheck` | Qualité |
| `npm run db:seed` | Réinitialise la démo (déterministe) |

## Principes

- **Aucune donnée de santé lue sans consentement ou motif d'urgence tracé** : `src/common/access.service.ts` est le point de décision unique ; chaque lecture par un tiers et chaque refus sont écrits dans un journal en ajout seul (trigger PostgreSQL).
- **Une seule logique métier pour tous les canaux** : web, SMS, USSD et voix appellent les mêmes services.
- **Aucune donnée médicale dans un SMS** : garde-fou dans `OutboxService`.

## Déploiement Vercel

1. Importer le dépôt dans Vercel (framework : Other). Le build lance `npm run vercel-build` (Prisma, schéma, seed si base vide, compilation) et `api/index.js` sert l'application Nest en fonction serverless.
2. Ajouter une base **Neon Postgres** depuis le Marketplace Vercel (fournit `DATABASE_URL` et `DATABASE_URL_UNPOOLED`).
3. Variables : `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, `HMAC_KEY` (32 octets base64), `CRON_SECRET`, `DEMO_MODE=true`, `PUBLIC_APP_URL`.
