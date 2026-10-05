# Flowboard

Tableau Kanban interne, auto-hébergé : boards, swimlanes, limites WIP, collaboration temps réel, commentaires, pièces jointes, notifications. Comptes gérés par un administrateur, sans inscription publique.

- Spécification : [`documentation/kanbanflow-prompt.md`](documentation/kanbanflow-prompt.md)
- Plan et suivi d'avancement : [`documentation/plan-implémentation.md`](documentation/plan-implémentation.md)
- Décisions et hypothèses : [`DECISIONS.md`](DECISIONS.md)

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
| `TRUST_PROXY` | — | Derrière un reverse proxy : nombre de proxys de confiance (ex. `1`) |
| `SESSION_DAYS` | `14` | Durée glissante des sessions |
| `UPLOAD_DIR` | `uploads` (`/data/uploads` dans l'image) | Stockage des pièces jointes |

Production : placer un reverse proxy TLS devant le port de l'application, en transmettant les WebSockets (`/api/socket.io`). Les données sont dans deux volumes : `mongo-data` et `uploads`.

## Développement

Prérequis : Node 22+, MongoDB local sur `27017`.

```bash
npm install
ADMIN_USERNAME=admin ADMIN_PASSWORD=admin-dev-pass COOKIE_SECURE=false npm run dev:api   # API sur :3000
npm run dev:web                                                                         # UI sur :5173 (proxy /api)
```

## Tests

```bash
npm test            # logique partagée (node:test) + API (Jest, base Mongo de test jetable)
npm run build && npm run test:e2e   # recette Playwright sur l'application construite
npm run lint        # ESLint + vérification de types
```

## Structure

```
packages/shared   constantes, permissions, schémas zod, règles métier pures (front + back)
apps/api          NestJS : auth, administration, boards, tâches, temps réel, commentaires, PJ, notifications
apps/web          Vite + React : SPA servie par l'API en production
e2e               recette Playwright (parcours de la spec § 5)
```
