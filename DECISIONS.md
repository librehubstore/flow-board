# Décisions et hypothèses

Journal exigé par la spec (§ 0) : chaque ambiguïté tranchée par l'hypothèse la plus simple, et chaque écart par rapport au plan validé. Les identifiants `Lx.y` renvoient à `documentation/plan-implémentation.md`.

## Décisions validées avec le porteur du projet

| # | Sujet | Décision |
|---|---|---|
| D1 | Nom | **Flowboard**, sans aucune référence au produit d'origine (code, UI, paquets, image Docker, en-têtes). Le nom de code « Couloir » de la spec est abandonné. |
| D2 | Stack | Vite + React (SPA) et NestJS, TypeScript partout. **Deux images** (révision du 2026-10-05) : `web` (nginx, SPA + relais `/api`) et `api` (NestJS), plus MongoDB. |
| D3b | Stockage des pièces jointes | **Disque local** (volume `uploads`) ; pas de stockage S3 pour l'instant (lot 17.3 reporté). |
| D3d | Onboarding (révision du 2026-10-06) | **Paramètre d'instance** : `admin` (défaut, conforme à la spec § 12) ou `open` (inscription email + mot de passe avec validation, ou Google), emails transactionnels **Brevo**. La spec excluait l'inscription : elle reste désactivée tant que l'admin ne l'ouvre pas. |
| D3c | CI/CD | **GitLab CI** : lint, tests, recette, deux images construites en parallèle, test de fumée de la pile, publication, déploiement manuel SSH. |
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
| D12 | `@nestjs/config` | **Config validée par zod + `process.loadEnvFile`** (`apps/api/.env` versionné, `.env.local` prioritaire et ignoré) | Natif Node, validation stricte au démarrage ; l'environnement du processus prime toujours (Docker). |
| D13 | class-validator / DTO classes | **Schémas zod partagés** (`ZodPipe`) | Un seul schéma pour le client et le serveur. |
| D14 | Repository par entité | **Collections typées exposées par `Db`**, requêtes dans les services du module propriétaire | Le driver natif tient déjà ce rôle ; une classe repository par collection n'ajouterait qu'une indirection. Règle : un module n'écrit que dans ses collections. |
| D16 | Index texte Mongo (`$text`) | **Sous-chaîne normalisée** (`searchText` sans accents ni casse, regex échappée, ET entre mots) | `$text` ne trouve que des mots entiers : taper « certif » ne trouverait pas « certificat ». Mesuré < 500 ms sur 50 000 tâches ; passer à `$text` si le volume explose. |
| D17 | Entité `RecurrenceRule` séparée | **Récurrence embarquée dans chaque occurrence** (règle + ancre + rang) | Modifier la règle n'affecte naturellement que les occurrences suivantes ; pas de jointure. La RRULE iCal est calculée à la volée (`rrule`). |
| D15 | Couplage direct pour les cascades | **`@nestjs/event-emitter`** : `task.deleted`, `board.purged` | Commentaires, pièces jointes et notifications nettoient leurs propres données sans dépendance circulaire vers les tâches. |

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
| H23 | Date d'une occurrence (§ 4.4) | La « date de début » d'une occurrence est le jour même de l'occurrence (minuit UTC) : elle apparaît dans la colonne de départ ce jour-là et reste dans « À venir » jusque-là. L'échéance garde son décalage par rapport à cette date. |
| H24 | Ancre de récurrence | À la première définition : l'échéance si elle existe, sinon aujourd'hui. Terminée en retard, la suivante est calculée après la date de complétion (pas de rafale d'occurrences passées). |
| H25 | Copie d'une occurrence | Nom, description, sous-tâches décochées, labels, couleur, responsable, estimations ; pas les collaborateurs, commentaires ni pièces jointes. |
| H26 | Filtre de board (§ 4.5) | « Cette semaine » = du lundi au dimanche dans le fuseau de l'utilisateur ; « En retard » ignore les tâches terminées. Les compteurs WIP comptent toutes les tâches, filtrées ou non. Le filtre est enregistré côté serveur (par utilisateur et par board). |
| H27 | Minuteur (§ 4.6) | Un Pomodoro porte toujours sur une tâche. La fin d'une session est appliquée par le serveur à la première lecture après l'échéance (aucune tâche planifiée) ; la pause se termine seule ; la session suivante se relance à la main. Une interruption remet le cycle à zéro. Le chronomètre ne s'arrête pas en changeant de tâche (nouvelle « part »). |
| H28 | Motifs d'interruption | Liste fixe (interne, externe, réunion, autre) + précision libre ; la spec dit « paramétrable », réévaluer si besoin. |
| H29 | Visibilité du temps | Chacun voit et modifie ses entrées ; le propriétaire du board (permission « voir le temps des autres ») et l'admin voient toutes celles du board. |
| H30 | Exports CSV | Format Excel français : séparateur « ; », BOM UTF-8, heures décimales à virgule ; une cellule commençant par `=`, `+`, `-` ou `@` est préfixée d'une apostrophe (injection de formule). |
| H31 | WIP en pomodoros (§ 4.2) | Pomodoros estimés d'une tâche = son estimation en temps ÷ 25 min, arrondi au supérieur ; une tâche sans estimation compte 0. |
| H32 | Numérotation (§ 4.3) | L'activation numérote les tâches existantes par ordre de création ; la désactivation masque les numéros sans les effacer ; le compteur ne recule jamais. |
| H33 | Modèles de board (§ 4.2) | Tout board peut être marqué « modèle » par son propriétaire ; tout utilisateur peut alors en copier la structure (colonnes, swimlanes, labels, couleurs, champs, réglage de numérotation), sans tâches ni membres. Le modèle lui-même reste privé. |
| H34 | Copie de board (§ 4.2) | Réservée aux propriétaires. Avec tâches : seulement les non archivées, sans commentaires, pièces jointes, temps ni historique ; le responsable n'est gardé que s'il s'agit de l'auteur de la copie ; les numéros sont conservés. |
| H35 | Champs personnalisés (§ 4.3) | Le type d'un champ est figé après création ; retirer une option efface les valeurs correspondantes. Le filtre porte sur les champs « liste » ; les champs texte et nombre passent par la recherche texte. |
| H36 | Rôles personnalisés (§ 4.10) | Un rôle doit inclure « voir le board » ; un rôle encore attribué ne peut pas être supprimé ; le modifier change aussitôt les droits des membres concernés. |
| H37 | Journal du board (§ 4.9) | Le journal porte sur les tâches (création, modifications, déplacements, archivage, commentaires, pièces jointes) ; les changements de structure du board ne sont pas journalisés. |
| H38 | Suivi de colonne (§ 4.2) | Par utilisateur et par colonne ; une tâche créée directement dans la colonne compte comme une entrée ; l'auteur du déplacement n'est pas notifié. |
| H39 | Couleurs personnalisées | 20 au plus par board ; en retirer une ramène les tâches concernées au jaune. |
| H40 | Inscription (onboarding ouvert) | Réponse identique que l'email soit nouveau ou déjà inscrit (pas d'énumération) ; un compte en attente reçoit un nouveau lien, l'ancien est invalidé. Lien valable 24 h, à usage unique, stocké haché. Les comptes en attente ne peuvent pas se connecter ; ils ne sont pas purgés automatiquement. |
| H41 | Connexion par email | Les comptes inscrits se connectent avec leur email (ou leur identifiant, dérivé de l'email : `jean.dupont`, `jean.dupont-2`…). Les comptes créés par Google n'ont pas de mot de passe. |
| H42 | Liaison Google | Un compte Google est lié au compte existant de même email (vérifié par Google), y compris en mode `admin` : c'est le seul cas où Google sert hors libre-service. Un compte en attente lié par Google est activé. |
| H43 | Emails | Langue = langue par défaut de l'instance (inscription) ou du profil (accueil) ; marque = nom de l'instance (ex. « Freehub »). Un échec d'envoi Brevo est journalisé sans bloquer l'inscription. |
