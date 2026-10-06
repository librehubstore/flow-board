# Flowboard

Tableau Kanban interne, auto-hébergé : boards, swimlanes, limites WIP, collaboration temps réel, commentaires, pièces jointes, notifications. Comptes gérés par un administrateur, sans inscription publique.

- Spécification : [`documentation/kanbanflow-prompt.md`](documentation/kanbanflow-prompt.md)
- Exploitation (déploiement, sauvegarde, restauration) : [`documentation/exploitation.md`](documentation/exploitation.md)
- Plan et suivi d'avancement : [`documentation/plan-implémentation.md`](documentation/plan-implémentation.md)
- Décisions et hypothèses : [`DECISIONS.md`](DECISIONS.md)

## Architecture de déploiement

Trois conteneurs : **web** (nginx non root : SPA + relais de `/api`, WebSocket compris, et en-têtes de sécurité), **api** (NestJS, sans port publié) et **mongo** (MongoDB 7). Chaque application a son image : `apps/web/Dockerfile` et `apps/api/Dockerfile` (contexte de build : racine du dépôt).

Pipeline GitLab (`.gitlab-ci.yml`) : lint → tests (Jest + MongoDB) et recette Playwright → images web et api en parallèle → test de fumée de la pile → étiquettes `latest` / version → déploiement manuel par SSH, précédé d'une sauvegarde. Variables à définir : voir l'en-tête du fichier.

## Déploiement (Docker)

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='un-mot-de-passe-long' docker compose up -d --build
```

L'application écoute sur le port `8080` (`FLOWBOARD_PORT` pour le changer). Au premier lancement, base vide, l'administrateur est créé depuis `ADMIN_USERNAME` / `ADMIN_PASSWORD` et doit changer son mot de passe à la première connexion. Sans ces variables sur une base vide, l'application refuse de démarrer.

| Variable | Défaut | Rôle |
|---|---|---|
| `MONGO_URL` | `mongodb://localhost:27017/flowboard` | Base MongoDB (7+, mono-instance) |
| `PORT` | `3000` | Port HTTP du conteneur |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | — | Premier administrateur (base vide uniquement) |
| `COOKIE_SECURE` | `true` | Cookie de session `Secure` : laisser `true` derrière TLS |
| `TRUST_PROXY` | `1` (compose) | Proxys de confiance devant l'API : `1` = le conteneur web ; `2` si un reverse proxy TLS est aussi devant |
| `SESSION_DAYS` | `14` | Durée glissante des sessions |
| `UPLOAD_DIR` | `uploads` (`/data/uploads` dans l'image) | Stockage des pièces jointes |

Production : placer un reverse proxy TLS devant le port de l'application, en transmettant les WebSockets (`/api/socket.io`). Les données sont dans deux volumes : `mongo-data` et `uploads`.

Reverse proxy (Caddy, nginx), sauvegarde quotidienne (`scripts/backup.sh`), restauration testée (`scripts/restore.sh`), mises à jour : voir [`documentation/exploitation.md`](documentation/exploitation.md).

## Développement

Prérequis : Node 22+, MongoDB local sur `27017`.

```bash
npm install
npm run dev:api   # API sur :3000
npm run dev:web   # UI sur :5173 (proxy /api)
```

Configuration de l'API : `apps/api/.env` (valeurs de développement, versionné) puis `apps/api/.env.local` (secrets du poste, non versionné, prioritaire). Une variable déjà présente dans l'environnement du processus l'emporte toujours. Mettre au minimum `ADMIN_USERNAME` / `ADMIN_PASSWORD` dans `.env.local` pour le premier lancement.

## Tests

```bash
npm test            # logique partagée (node:test) + API (Jest, base Mongo de test jetable)
npm run build && npm run test:e2e   # recette Playwright sur l'application construite
npm run lint        # ESLint + vérification de types
```

## Structure

```
packages/shared   constantes, permissions, schémas zod, règles métier pures (front + back)
apps/api          NestJS, un module par fonctionnalité (voir ci-dessous)
apps/web          Vite + React : SPA servie par l'API en production
e2e               recette Playwright (parcours de la spec § 5)
```

### Modules de l'API (`apps/api/src`)

```
config/         variables d'environnement validées (zod), lecture de .env / .env.local
common/         décorateurs (@Public, @AdminOnly, @Perm…), pipe zod, erreurs métier, tâches périodiques
database/       module global : connexion MongoDB, collections typées, index
health/         GET /api/health (vérifie MongoDB)
board-access/   contrôle d'accès aux boards (permissions § 4.10)
auth/           connexion, sessions, mots de passe, garde globale (CSRF, session, rôles)
users/          profil, annuaire, administration des comptes, premier admin
audit/          journal d'audit des actions admin
settings/       paramètres d'instance
realtime/       Socket.IO : rooms par board et par utilisateur, diffusion
notifications/  notifications in-app
tasks/          tâches, journal des révisions, rappels d'échéance
boards/         boards, structure (colonnes, swimlanes), membres, corbeille
comments/       commentaires et mentions
attachments/    pièces jointes
```

Dépendances sans cycle : `database ← board-access ← auth ← realtime ← notifications ← tasks ← boards / comments / attachments`. Les suppressions en cascade passent par des événements (`task.deleted`, `board.purged`).
