# Ganji · API

API de la plateforme **Ganji** (santé de chaque Béninois, challenge e-Santé du MTDI) : NestJS 11, Prisma 6, PostgreSQL 16. Documentation OpenAPI interactive sur **`/docs`** (JSON : `/docs/openapi.json`).

| | |
|---|---|
| API déployée | **https://ganji-api.vercel.app** (`/health`) |
| Documentation Swagger | https://ganji-api.vercel.app/docs |
| Frontend | https://ganji-sante.vercel.app · dépôt [`ganji-frontend`](https://github.com/spyder20052/ganji-frontend) |
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
| `npm test` / `npm run test:cov` | Tests Vitest : règles métier pures (don de sang, ordonnances, commandes, cercle de soins, posologies, i18n, chiffrement) et, **si `DATABASE_URL` est défini**, 4 suites d'intégration sur la vraie base (IDOR, consentement, parcours héros, ordonnance à usage unique, commandes, télé-expertise…). Sans base, ces 35 tests sont ignorés : `docker compose up -d db && npm run db:setup` pour les lancer. |
| `npm run lint` / `npm run typecheck` | Qualité |
| `npm run db:seed` | Réinitialise la démo (déterministe) |
| `npm run i18n:verify` | Textes SMS, voix et notifications : chaque clé traduite en fon, yoruba, bariba, dendi, mêmes variables |

## Principes

- **Aucune donnée de santé lue sans consentement ou motif d'urgence tracé** : `src/common/access.service.ts` est le point de décision unique ; chaque lecture par un tiers et chaque refus sont écrits dans un journal en ajout seul (trigger PostgreSQL).
- **Une seule logique métier pour tous les canaux** : web, SMS, USSD et voix appellent les mêmes services.
- **Aucune donnée médicale dans un SMS** : garde-fou dans `OutboxService`, vérifié sur tout le catalogue par un test.
- **Logique métier pure à côté des services** (`*.logic.ts`, `eligibility.ts`, `escalation.ts`, `dosage.ts`) : testée sans base, réutilisée par le jeu de données de démo.
- **Démo sans porte dérobée** : le simulateur de téléphone ne montre les SMS d'un vrai carnet qu'au navigateur qui l'a créé (clé remise à l'inscription) ; voir `SECURITY.md`.

## Déploiement Vercel

1. Projet Vercel `ganji-api`, branche de production `develop`. Le build lance `npm run vercel-build` (client Prisma, schéma et trigger d'audit, seed si la base est vide) ; `api/index.ts` importe `src/serverless.ts` et Vercel embarque le code qu'il trace. `.vercelignore` n'envoie jamais de `.env` local.
2. Ajouter une base **Neon Postgres** depuis le Marketplace Vercel (fournit `DATABASE_URL` et `DATABASE_URL_UNPOOLED`).
3. Variables : `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, `HMAC_KEY` (32 octets base64), `CRON_SECRET`, `DEMO_MODE=true`, `PUBLIC_APP_URL`.
