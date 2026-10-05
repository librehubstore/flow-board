# Flowboard — Plan d'implémentation par lots

> Document de suivi vivant. Sources : [`kanbanflow-prompt.md`](./kanbanflow-prompt.md) (spécification fonctionnelle ; le nom de code « Couloir » qu'elle utilise est remplacé par **Flowboard**) et [`stack-technique.md`](./stack-technique.md) (contraintes techniques).
> Chaque tâche porte un identifiant stable (`L3.4`) réutilisé dans les commits et dans `DECISIONS.md`.

## Légende de suivi

| Statut | Signification |
|---|---|
| `[ ]` | À faire |
| `[~]` | En cours |
| `[x]` | Terminé : code et tests verts |
| `[-]` | Abandonné ou reporté (motif noté dans `DECISIONS.md`) |

Règles de suivi :
- Un lot n'est **terminé** que lorsque tous ses critères d'acceptation (renvoi `§` à la spec) sont couverts par des tests automatisés qui passent.
- Toute hypothèse prise face à une ambiguïté est notée dans `DECISIONS.md` (exigence § 0 de la spec).
- Le tableau de bord ci-dessous est mis à jour à chaque fin de tâche.

## Tableau de bord

| Lot | Phase | Intitulé | Statut |
|---|---|---|---|
| 0 | MVP | Socle technique, Docker, CI locale | `[x]` |
| 1 | MVP | Comptes, authentification, administration des comptes | `[x]` |
| 2 | MVP | Boards, colonnes, swimlanes, membres, permissions | `[x]` |
| 3 | MVP | Tâches (cœur), glisser-déposer, journal d'événements | `[x]` |
| 4 | MVP | Collaboration temps réel | `[x]` |
| 5 | MVP | Commentaires, mentions, pièces jointes, notifications in-app | `[x]` |
| 6 | MVP | Tâches récurrentes | `[ ]` |
| 7 | MVP | Recherche et filtres | `[ ]` |
| 8 | MVP | Gestion du temps (Pomodoro, chronomètre, saisie manuelle) | `[ ]` |
| 9 | MVP | Rapport de temps, exports CSV, vue impression | `[ ]` |
| 10 | MVP | Finitions MVP : raccourcis, accessibilité, performance, exploitation | `[ ]` |
| 11 | V1 | Enrichissements des boards et historique | `[ ]` |
| 12 | V1 | Tâches avancées | `[ ]` |
| 13 | V1 | Rapports de flux, tableau de bord, rapports planifiés, Excel/PDF | `[ ]` |
| 14 | V1 | Calendrier et flux iCal | `[ ]` |
| 15 | V1 | Import, API REST publique, webhooks | `[ ]` |
| 16 | V1 | PWA mobile et hors-ligne | `[ ]` |
| 17 | V1 | Administration avancée (export/restauration, RGPD) | `[ ]` |
| 18 | V2 | Monte Carlo et Timeline/Gantt | `[ ]` |
| 19 | V2 | Email : SMTP, notifications, création de tâche par email | `[ ]` |
| 20 | V2 | Connecteurs : PJ cloud, Zapier/Make, Notion, push PWA | `[ ]` |

---

## 1. Choix de stack et justification (validé)

### Option retenue : **frontend Vite + React, backend NestJS, TypeScript partout**

Raisons, rapportées aux besoins de la spec :

| Besoin de la spec | Next.js (App Router) | Vite + React / NestJS |
|---|---|---|
| Temps réel WebSocket < 2 s (§ 4.2) | Pas de serveur WS natif : il faut un serveur custom, ce qui désactive une partie du modèle Next | `@nestjs/websockets` + Socket.IO, rooms par board, auth par session : natif |
| Tâches planifiées (récurrence, échéances J-1, rapports planifiés, relances webhooks) | Pas de processus long fiable dans le modèle serverless/RSC | `@nestjs/schedule` dans le même process, aucun service externe |
| Permissions vérifiées côté serveur sur chaque requête (§ 4.10) | Middleware + vérifications dispersées entre server actions et route handlers | Guards + décorateurs `@RequirePermission()` centralisés, testables |
| API REST publique documentée OpenAPI (§ 8, V1) | À construire à la main à côté des server actions | `@nestjs/swagger` génère l'OpenAPI depuis les DTO ; l'UI consomme la même API |
| PWA hors-ligne (§ 4.12, V1) | Intégration SW plus délicate avec le rendu serveur | SPA + `vite-plugin-pwa` (Workbox) : cas d'école |
| SEO / rendu serveur | Point fort de Next… | …inutile ici : outil interne derrière authentification, aucune page publique |
| Déploiement en un seul conteneur | Oui | Oui : Nest sert le build statique de Vite, **une seule image**, un seul port |

En résumé, l'application est une SPA métier authentifiée avec un backend « vivant » (WebSocket, cron, API publique, webhooks). C'est le terrain de NestJS. Next.js apporterait surtout le SSR et le SEO, qui n'ont aucune valeur pour un outil interne.

> Écarts constatés à l'implémentation (Nest 11, driver `mongodb` natif, `<dialog>` natif, `setInterval`, positions flottantes…) : voir `DECISIONS.md` (D4 à D11).

### Bibliothèques retenues

| Domaine | Choix | Raison |
|---|---|---|
| Monorepo | npm workspaces : `apps/api`, `apps/web`, `packages/shared` | Aucun outil supplémentaire ; types et schémas partagés |
| Base de données | MongoDB 7 + Mongoose (`@nestjs/mongoose`) | Imposé par la stack ; Mongoose est l'intégration Nest standard |
| Validation | `zod` dans `packages/shared`, utilisé par le front (formulaires) et le back (pipe de validation) | Un seul schéma pour les deux côtés |
| Hachage | `@node-rs/argon2` (Argon2id) | Binaires précompilés, pas de toolchain native dans l'image Docker |
| Sessions | Collection `sessions` + cookie `HttpOnly; Secure; SameSite=Lax`, index TTL | Révocation côté serveur exigée par § 4.1, sans dépendance |
| CSRF | Vérification de l'en-tête `Origin` + en-tête custom obligatoire sur les mutations | Suffisant avec SameSite=Lax et une SPA en même origine |
| Temps réel | Socket.IO (`@nestjs/platform-socket.io`) | Reconnexion et rooms incluses |
| Jobs planifiés | `@nestjs/schedule` + état des jobs en base (idempotents) | Remplace pg-boss de la spec (PostgreSQL non retenu) |
| Récurrence | `rrule` | La spec stocke la règle au format RRULE iCal |
| Ordre des tâches | Indexation fractionnaire (`fractional-indexing`) | Déplacer une carte = écrire **un seul** document |
| Front : données | TanStack Query + client Socket.IO qui met à jour le cache | Cache, invalidation et optimisme sans store global |
| Front : routing | React Router | Standard |
| Front : DnD | `@dnd-kit` | Souris, tactile et clavier accessibles (§ 4.3, § 10) |
| Front : UI | Tailwind CSS + Radix UI (primitives accessibles) | Thèmes clair/sombre par tokens CSS, a11y de base fournie |
| Front : i18n | `react-i18next` (FR, EN) | Textes externalisés dès le premier écran |
| Markdown | `react-markdown` + `rehype-sanitize` | Liens cliquables, pas de XSS |
| Graphiques (V1) | Recharts | Recommandé par la spec |
| Tests | Jest (API, Nest par défaut), Vitest (web), Playwright (E2E, critères d'acceptation) | Base Mongo de test : instance locale `27017`, base dédiée purgée par suite |
| Sécurité HTTP | `helmet` (CSP, HSTS), `@nestjs/throttler` | En-têtes exigés par § 10 |

### Contraintes MongoDB à acter

- **Mongo mono-instance (décision validée), sans replica set** : pas de transactions multi-documents ni de change streams. Le modèle est conçu en conséquence : déplacer une carte = une seule écriture atomique d'un document ; les opérations composées (suppression de colonne avec déplacement des tâches, compteur de numérotation via `findOneAndUpdate` + `$inc`) sont ordonnées pour rester cohérentes en cas d'interruption et rejouables sans effet de bord (idempotentes).
- **Recherche plein texte** : un seul index `text` par collection. Les tâches portent un champ dénormalisé `searchText` (nom, description, sous-tâches, labels, commentaires, numéro), recalculé à chaque modification. Objectif : moins de 500 ms sur 50 000 tâches, vérifié par un test de charge au lot 7.
- **Temps réel multi-instances** : hors périmètre initial (une instance). Évolution possible plus tard via un adaptateur Socket.IO (Redis ou collection Mongo *capped*).

---

## 2. Architecture cible (résumé)

```
apps/
  api/            NestJS : modules auth, users, boards, tasks, realtime, time, reports, notifications, search, admin
  web/            Vite + React SPA (servie en statique par l'API en production)
packages/
  shared/         schémas zod, types, constantes (permissions, palette de couleurs, événements)
docker/
  Dockerfile      multi-stage : build web + api, image runtime node:22-slim
docker-compose.yml  app + mongo 7 (mono-instance) + volumes données et uploads
DECISIONS.md
```

Principes transverses, appliqués dès le lot 0 :
- **Toute mutation de tâche passe par un service unique** qui (1) vérifie la permission, (2) écrit, (3) journalise un `Event` (§ 4.9), (4) diffuse sur la room du board, (5) déclenche les notifications. Les rapports de flux V1 (§ 4.7) exigent un historique rétroactif : **le journal d'événements est donc écrit dès le MVP**, même si l'onglet Historique n'arrive qu'en V1.
- Horodatages en UTC, conversion au fuseau de l'utilisateur à l'affichage.
- Aucune route publique hors `/login`, `/api/health` et les URL secrètes iCal (V1).

---

## 3. Phase MVP

### Lot 0 — Socle technique
- [x] L0.1 Monorepo npm workspaces, TypeScript strict, ESLint + Prettier, scripts `dev` / `build` / `test` à la racine
- [x] L0.2 `apps/api` : bootstrap NestJS, configuration par variables d'environnement validée par zod au démarrage, connexion MongoDB (driver natif, DECISIONS D5), `helmet`, préfixe `/api`, endpoint `/api/health`
- [x] L0.3 `apps/web` : Vite + React + React Router + TanStack Query + Tailwind + Radix, thème clair/sombre/système par tokens CSS, `react-i18next` (FR/EN)
- [x] L0.4 `packages/shared` : constantes de permissions, palette de couleurs, types d'événements
- [x] L0.5 Dockerfile multi-stage (image unique) + `docker-compose.yml` (app + Mongo 7 mono-instance + volumes `mongo-data` et `uploads`) ; l'API sert le build web
- [x] L0.6 Harnais de tests : Jest + base Mongo de test, Vitest, Playwright avec fixture de connexion — Vitest remplacé par `node:test` (DECISIONS D9)
- [x] L0.7 `DECISIONS.md` initialisé (stack Vite + NestJS, nom Flowboard, Mongo mono-instance)

**Livrable** : `docker compose up` affiche une page de connexion vide et `/api/health` répond 200.

### Lot 1 — Comptes et authentification (§ 4.1, § 4.11 partiel)
- [x] L1.1 Modèles `User` et `Session` (index TTL), identifiant unique insensible à la casse `[a-z0-9._-]{3,50}`
- [x] L1.2 Premier lancement : création de l'admin depuis `ADMIN_USERNAME` / `ADMIN_PASSWORD` ; refus de démarrer avec un message explicite si la base est vide et les variables absentes ; commande de seed — commande de seed non retenue (DECISIONS D10)
- [x] L1.3 Connexion / déconnexion, cookie de session, expiration glissante de 14 jours, invalidation serveur
- [x] L1.4 Protection CSRF, limitation à 5 échecs / 15 min par identifiant + IP, message d'erreur générique
- [x] L1.5 Changement de mot de passe (mot de passe actuel requis, autres sessions invalidées) ; écran obligatoire si `mustChangePassword`
- [x] L1.6 Administration des comptes : liste actifs/désactivés, création, édition, réinitialisation (mot de passe temporaire, sessions révoquées), désactivation/réactivation, garde « dernier admin actif »
- [x] L1.7 Profil : nom, email facultatif, avatar (initiales en MVP), fuseau, langue, thème
- [x] L1.8 Paramètres d'instance : nom affiché, langue et fuseau par défaut, taille maximale des PJ
- [x] L1.9 Journal d'audit des actions admin (§ 10)
- [x] L1.10 Tests : les 6 critères d'acceptation du § 4.1, dont l'absence de toute route d'inscription ou de mot de passe oublié

### Lot 2 — Boards, colonnes, swimlanes, membres, permissions (§ 4.2, § 4.10)
- [x] L2.1 Rôles intégrés Propriétaire / Éditeur / Lecteur (permissions unitaires de § 4.10) ; guard serveur `@RequirePermission()` sur toutes les routes de board
- [x] L2.2 CRUD board ; création avec les colonnes To-do / Do today / In progress / Done (libellés traduits) ; liste « Mes boards » avec bouton « Créer un board »
- [x] L2.3 Colonnes : ajout, renommage, description, réordonnancement, suppression avec colonne de destination, au moins une colonne garantie
- [x] L2.4 Colonne de complétion unique (par défaut la dernière)
- [x] L2.5 Limites WIP : entier ≥ 1 ou vide ; dépassement autorisé mais signalé (`n / limite`, en-tête rouge accompagné d'un texte, pas seulement de la couleur)
- [x] L2.6 Swimlanes : CRUD, réordonnancement, suppression avec destination
- [x] L2.7 Palette de 10 couleurs et légende nommable par board
- [x] L2.8 Membres du board et attribution de rôle
- [x] L2.9 État replié des colonnes mémorisé par utilisateur
- [x] L2.10 Suppression de board : confirmation par saisie du nom, corbeille de 30 jours, restauration par l'admin, purge planifiée
- [x] L2.11 Admin : vue de tous les boards avec leur propriétaire, transfert de propriété
- [x] L2.12 Réglages du board regroupés dans **un seul panneau** (irritant § 11)
- [x] L2.13 Tests : critères d'acceptation § 4.2 (hors temps réel), § 4.10 (lecteur → 403), § 4.11 (transfert)

### Lot 3 — Tâches (cœur) et glisser-déposer (§ 4.3, § 4.9 écriture)
- [x] L3.1 Modèle `Task` avec position fractionnaire par (colonne, swimlane)
- [x] L3.2 Service de mutation unique : permission → écriture → `Event` → diffusion → notifications
- [x] L3.3 Création en rafale en haut ou en bas de colonne (Entrée = tâche suivante, le champ reste actif)
- [x] L3.4 Carte : couleur avec libellé, labels épinglés, responsable, badge d'échéance (orange J-1, rouge en retard), progression `x/y`, temps passé face à l'estimation
- [x] L3.5 Panneau de détail : description Markdown assainie, responsable, collaborateurs, couleur, estimations (temps, points)
- [x] L3.6 Labels : autocomplétion, création à la volée, épinglage
- [x] L3.7 Échéance (date et heure facultative, stockée en UTC) avec colonne cible ; calcul « tenue / en retard »
- [x] L3.8 Sous-tâches : CRUD, réordonnancement, responsable et échéance facultatifs, cochables depuis la carte
- [x] L3.9 `completedAt` : posé à l'entrée dans la colonne de complétion, effacé à la sortie ; éditable (passé autorisé, futur refusé)
- [x] L3.10 Colonne de complétion groupée par date (Aujourd'hui, Hier, puis par date), groupes anciens repliés
- [x] L3.11 Archivage unitaire et par sélection, « archiver les terminées avant le JJ/MM », restauration dans la colonne d'origine (ou la première si elle n'existe plus)
- [x] L3.12 Suppression définitive après confirmation, journalisée
- [x] L3.13 DnD `@dnd-kit` entre colonnes et swimlanes : souris, tactile avec défilement automatique aux bords, clavier (espace, flèches, espace), annonces pour lecteur d'écran
- [x] L3.14 Tests : critères d'acceptation § 4.3 (hors relations, qui arrivent en V1) et test E2E du DnD clavier

### Lot 4 — Collaboration temps réel (§ 4.2)
- [x] L4.1 Gateway Socket.IO authentifiée par cookie de session ; room par board, accès vérifié à l'entrée
- [x] L4.2 Diffusion de toutes les mutations du service de tâches et de structure de board
- [x] L4.3 Client : application des événements au cache TanStack Query, resynchronisation à la reconnexion
- [x] L4.4 Conflits : dernier enregistrement gagnant, indicateur « modifié par X à l'instant »
- [x] L4.5 Révocation : un membre retiré ou désactivé est expulsé de la room
- [x] L4.6 Test E2E à deux navigateurs : un déplacement est visible chez l'autre en moins de 2 s

### Lot 5 — Commentaires, mentions, pièces jointes, notifications in-app (§ 4.3, § 9)
- [x] L5.1 Commentaires Markdown : CRUD par l'auteur, mention « modifié »
- [x] L5.2 Mentions `@identifiant` avec autocomplétion
- [x] L5.3 Pièces jointes : upload multiple, glisser-déposer, validation du type et de la taille (paramètre d'instance), aperçu des images, stockage disque (volume Docker)
- [x] L5.4 Modèle `Notification`, cloche avec compteur, marquer comme lu / tout lire, poussée temps réel
- [x] L5.5 Déclencheurs : assignation (tâche, sous-tâche), mention, commentaire sur une tâche suivie, échéance J-1 et dépassée (cron)
- [x] L5.6 Préférences de notification par type
- [x] L5.7 Tests des déclencheurs et des limites d'upload

### Lot 6 — Tâches récurrentes (§ 4.4)
- [ ] L6.1 Modèle `RecurrenceRule` (RRULE) : quotidienne, jours ouvrés, hebdomadaire, mensuelle (jour du mois ou « 2e mardi »), annuelle, tous les N jours/semaines/mois
- [ ] L6.2 Éditeur de récurrence dans le détail de la tâche (sans saisie RRULE brute)
- [ ] L6.3 Mode « à la complétion » : occurrence créée dans la colonne de départ avec `startAt`, masquée et visible dans une zone « À venir » repliée jusqu'à cette date
- [ ] L6.4 Mode « à date fixe » (cron)
- [ ] L6.5 Copie : nom, description, sous-tâches décochées, labels, couleur, responsable, estimations ; échéance décalée
- [ ] L6.6 Fin : jamais, après N occurrences, à une date ; une modification de règle ne s'applique qu'aux occurrences futures
- [ ] L6.7 Tests : critères d'acceptation § 4.4 (hebdomadaire terminée mercredi, limite à 3 occurrences)

### Lot 7 — Recherche et filtres (§ 4.5)
- [ ] L7.1 Barre de filtres : responsable (« moi », « non assignée »), label, couleur, échéance, texte ; ET entre critères, OU au sein d'un critère ; indicateur de filtre actif ; filtre mémorisé par utilisateur et par board
- [ ] L7.2 Champ dénormalisé `searchText` et index texte Mongo, mis à jour par le service de mutation (y compris commentaires et sous-tâches)
- [ ] L7.3 Recherche globale `/` ou `Ctrl+K` sur tous les boards accessibles, option « tâches archivées » (étiquette « Archivée » et bouton Restaurer)
- [ ] L7.4 Test de performance : 50 000 tâches, moins de 500 ms
- [ ] L7.5 Tests : critères d'acceptation § 4.5

### Lot 8 — Gestion du temps (§ 4.6)
- [ ] L8.1 Modèles `TimeEntry` et `TimeEntryPart` ; un minuteur actif par utilisateur, état côté serveur
- [ ] L8.2 Barre de minuteur compacte et non bloquante, qui persiste au rechargement et d'un appareil à l'autre
- [ ] L8.3 Pomodoro : durées paramétrables, pause longue toutes les 4 sessions, son et notification navigateur désactivables
- [ ] L8.4 Interruption : session « échouée » avec motif (liste paramétrable + texte libre)
- [ ] L8.5 Chronomètre multi-tâches : changer de tâche clôt la part courante
- [ ] L8.6 Saisie manuelle : début, fin ou durée, commentaire de 200 caractères maximum, labels de temps (« Facturable »)
- [ ] L8.7 Droits : l'auteur modifie et supprime ; l'admin et le propriétaire voient toutes les entrées
- [ ] L8.8 Pomodoro désactivable : aucun élément Pomodoro dans l'UI quand il est désactivé
- [ ] L8.9 Tests : critères d'acceptation § 4.6

### Lot 9 — Rapport de temps, exports, impression (§ 4.7 MVP, § 8)
- [ ] L9.1 Rapport « temps passé » : filtres (période, utilisateurs, boards, labels de temps), regroupements (utilisateur, tâche, board, label, jour, semaine), totaux, par pipeline d'agrégation Mongo
- [ ] L9.2 Export CSV du rapport de temps et des tâches d'un board (archivées incluses)
- [ ] L9.3 Vue impression du board (CSS `@media print`)
- [ ] L9.4 Tests : critère « totaux par utilisateur = somme des entrées »

### Lot 10 — Finitions MVP (§ 4.12, § 10)
- [ ] L10.1 Raccourcis clavier et aide affichée via `?`
- [ ] L10.2 Audit d'accessibilité (axe-core dans Playwright) dans les deux thèmes ; corrections WCAG 2.1 AA
- [ ] L10.3 Performance : board de 1 000 tâches affiché en moins de 1,5 s (virtualisation des colonnes si nécessaire), DnD fluide
- [ ] L10.4 Exploitation : sauvegarde quotidienne documentée (`mongodump` + volume `uploads`), procédure de restauration **testée**, migrations automatiques au démarrage
- [ ] L10.5 README : déploiement Docker, variables d'environnement, reverse proxy TLS
- [ ] L10.6 Recette E2E des parcours § 5 « Premier lancement », « Flux principal » et « Collaboration »

**Jalon MVP** : tous les critères d'acceptation marqués MVP passent ; image Docker publiable.

---

## 4. Phase V1

### Lot 11 — Enrichissements des boards et historique (§ 4.2, § 4.3, § 4.9, § 4.10)
- [ ] L11.1 Onglet « Historique » de la tâche et journal du board filtrable (lecture des `Event` existants)
- [ ] L11.2 Numérotation des tâches (préfixe + compteur atomique jamais réutilisé)
- [ ] L11.3 Champs personnalisés (texte, nombre avec unité, liste), affichage optionnel sur la carte, filtres
- [ ] L11.4 Couleurs personnalisées (hex)
- [ ] L11.5 WIP exprimé en pomodoros estimés
- [ ] L11.6 Suivi de colonne et notification à l'entrée d'une tâche
- [ ] L11.7 Mode mur : plein écran, lecture seule, temps réel
- [ ] L11.8 Copie de board (structure seule, ou structure + tâches) et modèles de board
- [ ] L11.9 Rôles personnalisés définis par l'admin

### Lot 12 — Tâches avancées (§ 4.3)
- [ ] L12.1 Relations (*lié à*, *dépend de* / *requis par*), possibles entre boards, indicateur « bloquée »
- [ ] L12.2 Modèles de tâches
- [ ] L12.3 Mise à jour en masse (sélection Maj/Ctrl+clic ou cases)
- [ ] L12.4 Tri automatique par colonne (qui désactive le réordonnancement manuel)
- [ ] L12.5 Déplacement vers un autre board avec signalement des champs incompatibles

### Lot 13 — Rapports V1 (§ 4.7)
- [ ] L13.1 Statistiques Pomodoro
- [ ] L13.2 Cumulative flow, cycle time et lead time (nuage de points, percentiles 50/85/95), burndown, throughput, calculés depuis les `Event`
- [ ] L13.3 Performance des échéances, estimé vs passé, nombre de tâches
- [ ] L13.4 Tableau de bord à widgets, par board ou multi-boards
- [ ] L13.5 Rapports enregistrés et planifiés (hebdomadaire le lundi, mensuel)
- [ ] L13.6 Exports Excel (`exceljs`) et PDF (board et rapports)

### Lot 14 — Planification (§ 4.8)
- [ ] L14.1 Vue calendrier mois/semaine, glisser pour changer l'échéance, filtres du board
- [ ] L14.2 Flux iCal secrets par utilisateur ou par board (jeton haché, régénérable)

### Lot 15 — Intégrations (§ 8)
- [ ] L15.1 Import CSV/Excel : assistant de correspondance, aperçu, rapport d'erreurs ligne par ligne
- [ ] L15.2 Jetons API par board ou d'instance (affichés une seule fois, hachés, révocables)
- [ ] L15.3 API REST publique documentée OpenAPI : pagination par curseur, rate limit de 1000 req/h avec en-têtes `X-RateLimit-*` et réponse 429
- [ ] L15.4 Webhooks signés HMAC-SHA256, vérification HEAD à l'enregistrement, 5 tentatives avec backoff, journal des livraisons

### Lot 16 — PWA et hors-ligne (§ 4.12)
- [ ] L16.1 `vite-plugin-pwa` : manifest, installation, cache de l'application
- [ ] L16.2 Vue mobile : une colonne à la fois avec balayage, multi-colonnes en paysage
- [ ] L16.3 File de mutations hors-ligne (IndexedDB), rejouée au retour du réseau ; conflit = dernier gagnant + notification
- [ ] L16.4 Test E2E : déplacement hors-ligne synchronisé au retour en ligne

### Lot 17 — Administration avancée (§ 4.11, § 10)
- [ ] L17.1 Export complet de l'instance (JSON + fichiers) et restauration
- [ ] L17.2 RGPD : export des données d'un utilisateur, anonymisation d'un compte désactivé
- [ ] L17.3 Stockage des PJ compatible S3 (option)

---

## 5. Phase V2

### Lot 18 — Prévision et planification avancée
- [ ] L18.1 Prévision Monte Carlo (« quand N tâches ? », « combien d'ici une date ? », confiance 50/85/95 %)
- [ ] L18.2 Timeline/Gantt : drag et redimensionnement, flèches de dépendance, conflits, vue multi-boards

### Lot 19 — Email
- [ ] L19.1 SMTP facultatif : notifications email, résumé quotidien, envoi des rapports planifiés
- [ ] L19.2 Création de tâche par email (IMAP ou webhook entrant ; expéditeur = email d'un membre)

### Lot 20 — Connecteurs
- [ ] L20.1 Pièces jointes cloud par lien (Drive, OneDrive, Dropbox, Box)
- [ ] L20.2 Zapier/Make (déclencheurs et action « créer une tâche ») et Notion
- [ ] L20.3 Notifications push PWA

---

## 6. Points à valider avant de démarrer

| # | Question | Hypothèse par défaut |
|---|---|---|
| 1 | ~~Nom de l'application~~ | **Validé : Flowboard.** Aucune référence au nom de l'application d'origine dans le code, l'UI, les paquets, l'image Docker ni les en-têtes (`X-Flowboard-Signature`). |
| 2 | ~~Topologie Mongo~~ | **Validé : mono-instance, sans replica set.** |
| 3 | Avatar utilisateur au MVP | Initiales colorées au MVP, upload d'image au lot 17. |
| 4 | Stockage S3 des PJ | Disque local au MVP, S3 en V1 (lot 17). |
| 5 | Pipeline CI distante (GitHub Actions…) | Aucune pour l'instant : scripts de tests locaux uniquement. |

## 7. Journal d'avancement

| Date | Lot / tâche | Note |
|---|---|---|
| 2026-10-04 | — | Plan initial rédigé, en attente de validation |
| 2026-10-04 | — | Validé : stack Vite + React / NestJS, Mongo mono-instance, nom Flowboard |
| 2026-10-04 | L0–L3 | Interrompu (limite d'usage). Fait : monorepo npm, `packages/shared` (permissions, couleurs, schémas zod, `dueStatus`/`completionGroup` + 4 tests verts), API : `config.ts`, `db.ts`, `errors.ts`, `http.ts` (AccessGuard), `auth.service.ts`, `tasks.service.ts`. Reste : `boards.service.ts`, controllers, `app.module.ts`, `main.ts`, tests Jest, `apps/web`, Docker, Playwright, `DECISIONS.md` (Nest 11 au lieu de 12 ESM ; driver `mongodb` natif au lieu de Mongoose ; `<dialog>` natif au lieu de Radix). |
| 2026-10-04 | L0–L5 | **Lots 0 à 5 terminés.** Tests verts : 5 `node:test` (shared), 39 Jest (API : critères § 4.1, 4.2, 4.3, 4.9, 4.10, 4.11, temps réel Socket.IO, commentaires, mentions, notifications, PJ), 4 parcours Playwright (premier lancement, création de compte, flux Kanban avec DnD clavier, collaboration temps réel + mention). Image Docker construite et vérifiée avec `docker compose`. ESLint et `tsc` propres. |
