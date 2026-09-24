# Sécurité de Ganji

> Principe central : **aucune donnée de santé n'est lue sans le consentement du patient ou un motif d'urgence tracé.**
> Référentiel visé : OWASP ASVS niveau 2. Cadre légal : Code du numérique du Bénin (loi n° 2017-20, livre V), APDP.
> **Démonstration : aucune vraie donnée patient.** Toutes les personnes sont fictives ; c'est une exigence légale.

## 1. Modèle de menaces et mesures implémentées

| Menace | Mesure | Où dans le code |
|--------|--------|-----------------|
| Soignant curieux ou malveillant | Décision d'accès unique : rôle **et** relation de soin (titulaire, parent, aidant délégué, équipe de soins, consentement actif, bris de glace). Tout refus renvoie 403 et écrit `AuditEvent(allowed=false)` visible par le patient. | `src/common/access.service.ts` |
| Bris de glace abusif | Motif obligatoire (≥ 20 caractères), accès limité à 12 h, patient, aidants et contrôleur notifiés, entrée rouge dans le journal. | `src/emergency/` |
| Accès à l'objet d'un autre patient (IDOR) | UUID v4 ; `ParseUUIDPipe` ; appartenance vérifiée dans chaque service (jamais confiance au client). | tous les services |
| Vol de compte (SIM swap, hameçonnage) | OTP 6 chiffres haché (HMAC), 5 essais, expiration 5 min, 3 codes / 10 min ; alerte SMS à chaque nouvelle connexion ; session soignant 30 min ; pas d'énumération des numéros. | `src/auth/` |
| Fuite de base de données | AES-256-GCM par champ (traitements, diagnostics, comptes rendus) ; NPI stocké en HMAC-SHA256 + 4 derniers chiffres ; clés en variables d'environnement (coffre en production). | `src/common/crypto.service.ts` |
| Journal falsifié | Table `AuditEvent` en ajout seul : trigger PostgreSQL refusant `UPDATE`, `DELETE` et `TRUNCATE`. | `prisma/sql/audit-append-only.sql` |
| Fausse ordonnance, revente | QR = `id.signature` HMAC sur une forme canonique ; délivrance atomique (`updateMany … status = ACTIVE`) : la 2e pharmacie reçoit 409. | `src/medications/` |
| Donnée médicale dans un SMS | L'`OutboxService` refuse tout corps contenant un terme médical ; les SMS ne portent qu'un code, un lieu, une heure. Mode discret : pas de prénom. | `src/common/outbox.service.ts` |
| Injection, XSS | Prisma (requêtes paramétrées) ; `ValidationPipe({ whitelist, forbidNonWhitelisted })` ; CSP stricte côté API et frontend ; échappement des popups de carte. | `src/app.factory.ts`, `next.config.ts` |
| CSRF | Cookie de session `HttpOnly`, `Secure`, `SameSite=Lax` ; API servie en même origine via rewrite ; aucune route d'écriture en GET ; pas de CORS ouvert. | `src/auth/auth.controller.ts` |
| Abus, déni de service | `@nestjs/throttler` global (120 req/min) et renforcé sur OTP (5/min), inscription (3/min), carte d'urgence (20/min). | contrôleurs |
| Fichiers piégés | Types limités, taille ≤ 300 Ko, vérification des octets magiques (JPEG, PNG, WebP, PDF). Production : stockage objet + liens signés courts. | `src/patients/patients.service.ts` |
| Faux soignant | `Practitioner.verifiedAt` posé par un administrateur après contrôle au registre de l'Ordre (simulé). | modèle `Practitioner` |
| Téléphone perdu | Carnet hors ligne chiffré par PIN (PBKDF2 310 000 itérations + AES-GCM, WebCrypto), effacé après 5 PIN faux ; carte d'urgence sans diagnostic. | frontend `src/lib/secure-store.ts` |
| Données très sensibles (VIH, santé mentale, SSR) | Compartiment `sensitive` : jamais dans la carte d'urgence ni dans un partage par défaut ; exige un consentement explicite portant ce périmètre ; jamais accessible via l'équipe de soins ou un aidant. | `access.service.ts` |
| IA qui divulgue | Aucun appel à un modèle externe dans la démo ; en cible : pseudonymisation avant appel, journalisation. | — |
| Webhook SMS falsifié | Signature HMAC exigée hors mode démo. | `src/channels/channels.controller.ts` |

## 2. Pratiques de développement

- Secrets jamais dans le dépôt : `.env.example` uniquement ; scan **gitleaks** en CI.
- `npm audit` et **CodeQL** à chaque push ; Dependabot hebdomadaire.
- En-têtes de sécurité : Helmet (HSTS 2 ans, CSP, `frame-ancestors 'none'`, `no-referrer`).
- Moindre privilège (cible) : rôles PostgreSQL séparés lecture / écriture ; aucun accès admin depuis Internet.
- Sauvegardes chiffrées quotidiennes, restauration testée (cible production).

## 3. Signaler une faille

Écrire à **securite@ganji.bj** (adresse de démonstration) avec les étapes de reproduction. Nous accusons réception sous 72 h et publions un correctif coordonné. Merci de ne pas exploiter la faille au-delà de la preuve de concept et de ne jamais accéder à des données d'autrui.
