# Sécurité de Ganji

> Principe central : **aucune donnée de santé n'est lue sans le consentement du patient ou un motif d'urgence tracé.**
> Référentiel visé : OWASP ASVS niveau 2. Cadre légal : Code du numérique du Bénin (loi n° 2017-20, livre V), APDP.
> **Démonstration : aucune vraie donnée patient.** Toutes les personnes sont fictives ; c'est une exigence légale.

Ce document vaut pour les deux dépôts (`ganji-backend`, `ganji-frontend`) ; il est identique dans les deux. Les chemins `src/…` sans préfixe désignent l'API.

## 1. Modèle de menaces et mesures implémentées

| Menace | Mesure | Où dans le code |
|--------|--------|-----------------|
| Soignant curieux ou malveillant | Décision d'accès unique : rôle **et** relation de soin (titulaire, parent, aidant délégué, équipe de soins, consentement actif, bris de glace). Tout refus renvoie 403 et écrit `AuditEvent(allowed=false)` visible par le patient. Le journal d'accès d'un patient n'est lisible que par lui et ses proches, jamais par un soignant. | `src/common/access.service.ts`, `src/patients/patients.service.ts` |
| Durée d'accès choisie par le soignant | La durée d'un partage (1 à 168 h) est enregistrée avec le consentement au moment où le patient le crée ; le QR la porte à titre indicatif, l'API ne la lit jamais depuis le client. | `Consent.durationHours`, `PatientsService.share/redeem` |
| Force brute du code de partage à 6 chiffres | 10 essais par minute, et au-delà de 10 codes faux en 15 minutes le soignant attend : le compteur est le journal d'audit lui-même (ajout seul, partagé entre toutes les instances). | `src/patients/patients.controller.ts`, `patients.service.ts` |
| Bris de glace abusif | Réservé aux soignants dont l'inscription à l'Ordre est vérifiée ; motif obligatoire (≥ 20 caractères) ; accès limité à 12 h ; patient, aidants et contrôleur notifiés ; entrée rouge dans le journal ; un accès déjà ouvert est rendu tel quel (pas de doublon ni de spam) ; au plus 3 dossiers inconnus par heure et par soignant. | `src/emergency/emergency.service.ts` |
| Télé-expertise qui ouvre le carnet à tout le pays | Les spécialistes de la discipline sont prévenus, mais seul celui qui **ouvre** la demande reçoit un accès en lecture (72 h, consentement d'équipe tracé). | `src/care/care.service.ts` |
| Accès à l'objet d'un autre patient (IDOR) | UUID v4 ; `ParseUUIDPipe` ; appartenance vérifiée dans chaque service (jamais confiance au client) ; tests d'intégration dédiés. | tous les services, `test/api.integration.spec.ts` |
| Vol de compte (SIM swap, hameçonnage) | OTP 6 chiffres haché (HMAC), 5 essais, expiration 5 min, 3 codes / 10 min comptés en base ; alerte SMS à chaque nouvelle connexion ; session soignant 30 min, patient 7 jours ; hors démo, un numéro inconnu et un code faux reçoivent la même réponse (pas d'énumération). | `src/auth/` |
| Simulateur de téléphone (démo) qui exposerait les codes | Le simulateur ne montre les SMS, et ne répond, que pour les téléphones de démonstration (personas, donneurs simulés) ou, avec une clé remise une seule fois à l'inscription et gardée dans le navigateur, pour le carnet créé depuis ce navigateur. Un numéro inconnu, une clé absente ou fausse reçoivent la même réponse. | `src/channels/channels.service.ts` (`assertSimulatorPhone`), frontend `src/lib/simulator.ts` |
| Code de remise d'une commande | Donné au patient (ou à son parent) et à l'auteur de la commande seulement, par SMS comme dans l'application ; un aidant « commandes » suit la commande sans le voir. Compteur d'essais atomique côté officine (5), puis nouveau code. | `src/orders/orders.service.ts` |
| Fuite de base de données | AES-256-GCM par champ (traitements, diagnostics, comptes rendus, messages d'écoute) ; NPI stocké en HMAC-SHA256 + 4 derniers chiffres ; clés en variables d'environnement (coffre en production). Une valeur altérée se déchiffre en `null`, jamais en erreur 500. | `src/common/crypto.service.ts` |
| Journal falsifié | Table `AuditEvent` en ajout seul : trigger PostgreSQL refusant `UPDATE`, `DELETE` et `TRUNCATE`. | `prisma/sql/audit-append-only.sql` |
| Fausse ordonnance, revente | QR = `id.signature` HMAC sur une forme canonique ; délivrance atomique (`updateMany … status = ACTIVE`) : la 2e pharmacie reçoit 409. | `src/medications/` |
| Donnée médicale dans un SMS | L'`OutboxService` refuse tout corps contenant un terme médical (liste élargie : VIH, sida, cancer, tuberculose, hépatite, épilepsie…) ; une alerte officielle est vérifiée **avant** d'être écrite ; les SMS ne portent qu'un code, un lieu, une heure ; un signe de danger de grossesse devient « a besoin d'aide ». Mode discret : pas de prénom. Un relais n'est prévenu que pour sa commune (le repli sur les premiers relais inscrits n'existe qu'en démonstration). | `src/common/outbox.service.ts`, `src/alerts/`, `src/maternal/`, `src/emergency/responders.service.ts` |
| Compartiment très sensible (VIH, santé mentale, SSR) | Jamais dans la carte d'urgence ni dans un partage par défaut ; exige un consentement explicite portant ce périmètre ; jamais accessible via l'équipe de soins ou un aidant. La réponse dit toujours « des données sensibles peuvent être masquées », qu'il y en ait ou non : rien ne révèle leur existence. | `access.service.ts`, `patients.service.ts` |
| Injection, XSS | Prisma (requêtes paramétrées) ; `ValidationPipe({ whitelist, forbidNonWhitelisted })` et DTO sur chaque entrée (corps, requête) ; API : CSP `default-src 'none'` (Swagger sur `/docs` seulement) ; frontend : CSP avec **nonce par requête** et `'strict-dynamic'`, aucun domaine tiers hormis les tuiles OpenStreetMap ; popups de carte échappées. | `src/app.factory.ts`, frontend `src/middleware.ts` |
| CSRF | Cookie de session `HttpOnly`, `Secure`, `SameSite=Lax` ; API servie en même origine via rewrite ; aucune route d'écriture en GET ; pas de CORS ouvert. | `src/auth/auth.controller.ts` |
| Abus, déni de service | `@nestjs/throttler` global (120 req/min) et renforcé sur OTP, inscription, code de partage, bris de glace, carte d'urgence, voix de synthèse. **Limite connue** : ce compteur est en mémoire, donc par instance serverless ; les protections qui comptent sont en base (essais OTP, codes de partage via le journal, bris de glace via les consentements, codes de remise). | contrôleurs, services |
| Fichiers piégés | Types limités, taille ≤ 300 Ko, vérification des octets magiques (JPEG, PNG, WebP, PDF) ; `Content-Disposition` assaini ; CSP propre à la réponse. Production : stockage objet + liens signés courts. | `src/patients/` |
| Faux soignant | `Practitioner.verifiedAt` posé par un administrateur après contrôle au registre de l'Ordre (simulé) ; exigé pour le bris de glace et l'accès par télé-expertise. | modèle `Practitioner` |
| Téléphone perdu ou partagé | Carnet hors ligne chiffré par PIN (PBKDF2 310 000 itérations + AES-GCM, WebCrypto), effacé après 5 PIN faux. **Honnêtement** : PBKDF2 ralentit, il n'empêche pas une attaque hors ligne sur un PIN court par un attaquant outillé ; le PIN protège contre l'emprunt du téléphone, pas contre l'expertise. La carte d'urgence est gardée **en clair par choix** (lisible écran verrouillé, sans réseau ni PIN) et ne contient ni diagnostic ni pathologie. À la déconnexion, tout part : copie chiffrée, carte, saisies en attente, pages gardées. Un document médical n'est jamais mis en file hors ligne. | frontend `src/lib/secure-store.ts`, `src/components/LogoutButton.tsx`, `src/lib/offline-queue.ts`, `public/sw.js` |
| Sessions | JWT signé (HS256), revendications figées (rôle, établissement). **Limite connue** : pas de révocation côté serveur avant expiration ; les sessions courtes des professionnels (30 min) la bornent. Cible : version de session en base vérifiée par la garde. | `src/common/guards.ts` |
| IA qui divulgue | Aucun appel à un modèle externe dans la démo ; la voix de synthèse (MMS) tourne dans l'API, cache plafonné à 5 000 textes. En cible : pseudonymisation avant appel, journalisation. | `src/tts/` |
| Webhook SMS falsifié | Signature HMAC exigée hors mode démo ; secret de la tâche planifiée comparé en temps constant. | `src/channels/channels.controller.ts` |
| Mesure d'audience intrusive | Comptage anonyme sans cookie ni adresse IP ; chemins sans identifiant (`/pro/patients/:id`) ; agrégats 13 mois, parcours 90 jours ; lecture en local seulement. | frontend `src/lib/audience.ts`, `src/app/audience/route.ts` |

## 2. Pratiques de développement

- Secrets jamais dans le dépôt : `.env.example` uniquement ; scan **gitleaks** en CI.
- `npm audit` et **CodeQL** à chaque push ; Dependabot hebdomadaire.
- En-têtes de sécurité : Helmet côté API (HSTS 2 ans, CSP, `frame-ancestors 'none'`, `no-referrer`), en-têtes équivalents côté frontend avec CSP par nonce.
- Tests d'autorisation rejoués sur une vraie base : IDOR, consentement absent, rôle insuffisant, ordonnance falsifiée ou déjà servie, bris de glace sans motif, lecture sans session.
- Moindre privilège (cible) : rôles PostgreSQL séparés lecture / écriture ; aucun accès admin depuis Internet.
- Sauvegardes chiffrées quotidiennes, restauration testée (cible production).

## 3. Signaler une faille

Écrire à **securite@ganji.bj** (adresse de démonstration) avec les étapes de reproduction. Nous accusons réception sous 72 h et publions un correctif coordonné. Merci de ne pas exploiter la faille au-delà de la preuve de concept et de ne jamais accéder à des données d'autrui.
