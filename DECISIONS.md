# Décisions et hypothèses

Journal exigé par la spec (§ 0) : chaque ambiguïté tranchée par l'hypothèse la plus simple, et chaque écart par rapport au plan validé. Les identifiants `Lx.y` renvoient à `documentation/plan-implémentation.md`.

## Décisions validées avec le porteur du projet

| # | Sujet | Décision |
|---|---|---|
| D1 | Nom | **Flowboard**, sans aucune référence au produit d'origine (code, UI, paquets, image Docker, en-têtes). Le nom de code « Couloir » de la spec est abandonné. |
| D2 | Stack | Vite + React (SPA) et NestJS, TypeScript partout, une seule image Docker. |
| D3 | MongoDB | Mono-instance, **sans replica set** : ni transactions multi-documents ni change streams. |

## Écarts techniques par rapport au plan

| # | Plan | Retenu | Raison |
|---|---|---|---|
| D4 | NestJS dernière version | **NestJS 11** | Nest 12 est passé en ESM pur, incompatible avec Jest/ts-jest sans configuration lourde. À réévaluer plus tard. |
| D5 | Mongoose | **Driver `mongodb` natif** | La validation se fait déjà avec zod aux frontières : pas de schéma en double. Collections typées dans `apps/api/src/db.ts`. |
| D6 | Radix UI | **`<dialog>` natif** | Focus piégé, Échap et arrière-plan inerte fournis par le navigateur ; une dépendance de moins. |
| D7 | `@nestjs/schedule` | **`setInterval` (`unref`)** | Deux tâches périodiques seulement (purge de la corbeille, échéances) : pas besoin de cron. |
| D8 | `fractional-indexing` | **Positions flottantes + renumérotation** | Le paquet est ESM pur (même souci que D4). Milieu de deux flottants ; si l'écart s'épuise (~50 insertions au même endroit), la cellule est renumérotée (testé). |
| D9 | Vitest côté web | **`node:test` pour la logique partagée + Playwright** | La logique pure (échéances, groupes de complétion, mentions) vit dans `packages/shared` et se teste sans outillage ; l'UI est couverte par la recette E2E. |
| D10 | Commande de seed | **Variables d'environnement uniquement** | Le premier admin est créé au démarrage depuis `ADMIN_USERNAME` / `ADMIN_PASSWORD` ; une commande séparée ferait doublon. |
| D11 | — | Identifiants **UUID en chaîne** (`_id: string`) | Pas de conversion `ObjectId` entre API et client. |

## Hypothèses fonctionnelles

| # | Sujet (§ spec) | Hypothèse retenue |
|---|---|---|
| H1 | Premier admin (§ 4.1, § 5) | Il doit changer son mot de passe à la première connexion, comme tout compte créé par un admin. |
| H2 | Réinitialisation (§ 4.1) | Le serveur génère le mot de passe temporaire et l'affiche une seule fois à l'admin. |
| H3 | Compte désactivé (§ 4.1) | Connexion refusée avec le même message générique qu'un mauvais mot de passe (pas de fuite d'information). |
| H4 | Limitation des tentatives (§ 4.1) | 5 échecs par couple identifiant + IP, blocage jusqu'à 15 min après le premier échec. |
| H5 | CSRF (§ 4.1) | En-tête `x-flowboard-csrf: 1` obligatoire sur toute mutation + cookie `SameSite=Lax` ; une page tierce ne peut pas poser cet en-tête. |
| H6 | Admin global (§ 2) | « Voir tous les boards » = lecture seule sur tout board ; pour modifier, il doit en être membre (ou se le faire transférer). |
| H7 | Accès refusé | Un non-membre reçoit **404** (on ne révèle pas l'existence du board) ; un membre sans la permission reçoit **403**. |
| H8 | Suppression de board (§ 4.2) | Réservée à la permission « gérer la structure » (propriétaires). Purge définitive horaire après 30 jours de corbeille. |
| H9 | Transfert de propriété (§ 4.11) | Le nouveau propriétaire devient `owner` ; les anciens propriétaires deviennent éditeurs. |
| H10 | Nouvelle colonne | Insérée avant la colonne de complétion si celle-ci est la dernière. |
| H11 | Changement de colonne de complétion | Ne recalcule pas `completedAt` des tâches existantes. |
| H12 | Échéance sans heure (§ 4.3) | Stockée à minuit UTC du jour choisi ; elle court jusqu'à la fin de ce jour (UTC). Avec heure : convertie depuis le fuseau de l'utilisateur. |
| H13 | Échéance « tenue » (§ 4.3) | Cible = colonne de complétion par défaut (tenue si `completedAt` ≤ échéance) ; pour une autre colonne cible, la date de première arrivée est mémorisée. |
| H14 | Swimlanes (§ 4.2) | Ajouter la première swimlane y rattache toutes les tâches ; supprimer la dernière ramène le board à « sans swimlane » sans demander de destination. |
| H15 | Restauration d'archive (§ 4.3) | Colonne et swimlane d'origine si elles existent, sinon les premières ; la tâche est placée en bas. |
| H16 | Création « en haut » (§ 4.3) | Bouton `+` de l'en-tête de colonne (boards sans swimlane) ; « Ajouter une tâche » en bas de chaque cellule. |
| H17 | Notifications (§ 9) | Échéances vérifiées toutes les 10 min, destinataire = responsable, une seule notification J-1 et une seule « dépassée » (remises à zéro si l'échéance change). « Commentaire » notifie responsable + collaborateurs non déjà mentionnés. On n'est jamais notifié de ses propres actions. |
| H18 | Mentions (§ 4.3) | `@identifiant` ne notifie que les membres du board. |
| H19 | Pièces jointes (§ 4.3, § 10) | Images (PNG/JPEG/GIF/WebP) et PDF affichés dans le navigateur ; tout le reste (dont SVG et HTML) servi en téléchargement `application/octet-stream`. Taille vérifiée contre le paramètre d'instance (défaut 25 Mo). |
| H20 | Avatar (§ 4.1) | Initiales colorées au MVP ; l'upload d'image est prévu au lot 17. |
| H21 | Markdown | `react-markdown` sans HTML brut (pas d'injection) ; liens ouverts dans un nouvel onglet. |
| H22 | Temps réel (§ 4.2) | Diffusion en mémoire (une instance). Côté client, les échos d'une tâche en cours de modification locale sont ignorés : seule la réponse de la dernière requête fait foi (pas de retour arrière visuel). |
