import { expect, test, type Page } from '@playwright/test';

// Parcours de la spec § 5, joués dans l'ordre sur une base vide.
test.describe.configure({ mode: 'serial' });

const ADMIN_PASSWORD = 'admin-final-pass';
let boardUrl = '';
let alicePassword = '';

async function login(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.getByLabel('Identifiant').fill(username);
  await page.getByLabel('Mot de passe').fill(password);
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/auth/login')),
    page.getByRole('button', { name: 'Se connecter' }).click(),
  ]);
}

const card = (page: Page, name: string) => page.locator(`[data-task="${name}"]`);

/** Glisser-déposer clavier : Espace, flèches (espacées comme un humain), Espace. */
async function keyboardMove(page: Page, name: string, ...keys: string[]) {
  const handle = card(page, name).locator('[data-handle]');
  // Une fenêtre qui se ferme rend le focus de façon asynchrone : on vérifie qu'il est bien sur la carte.
  await expect(async () => {
    await handle.focus();
    await expect(handle).toBeFocused({ timeout: 200 });
  }).toPass();
  await page.keyboard.press('Space');
  for (const key of keys) {
    await page.waitForTimeout(150);
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');
}
const cell = (page: Page, column: string) => page.getByRole('group', { name: column, exact: true });

test('premier lancement : l’admin se connecte, doit changer son mot de passe, arrive sur ses boards', async ({
  page,
}) => {
  await login(page, 'admin', 'mauvais-mot-de-passe');
  await expect(page.getByRole('alert')).toHaveText('Identifiant ou mot de passe incorrect');

  await login(page, 'admin', 'admin-initial-1');
  await expect(page.getByRole('heading', { name: 'Choisissez votre mot de passe' })).toBeVisible();
  await page.getByLabel('Mot de passe actuel').fill('admin-initial-1');
  await page.getByLabel('Nouveau mot de passe (10 caractères minimum)').fill(ADMIN_PASSWORD);
  await page.getByLabel('Confirmer le nouveau mot de passe').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { name: 'Mes boards' })).toBeVisible();
  await expect(page.getByText('Aucun board pour l’instant.')).toBeVisible();
});

test('l’admin crée un compte et réinitialise son mot de passe', async ({ page }) => {
  await login(page, 'admin', ADMIN_PASSWORD);
  await page.getByRole('link', { name: 'Administration' }).click();
  await page.getByLabel('Identifiant').fill('alice');
  await page.getByLabel('Nom complet').fill('Alice Martin');
  await page.getByLabel('Mot de passe initial').fill('alice-initial-1');
  await page.getByRole('button', { name: 'Nouveau compte' }).click();
  const row = page.getByRole('row', { name: /alice/ });
  await expect(row).toContainText('Alice Martin');
  await row.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click();
  const status = page.getByRole('status');
  await expect(status).toContainText('Mot de passe temporaire de alice');
  alicePassword = /alice : (\S+)/.exec((await status.textContent()) ?? '')![1];
});

test('flux Kanban : création en rafale, glisser-déposer clavier, complétion, sous-tâches', async ({
  page,
}) => {
  await login(page, 'admin', ADMIN_PASSWORD);
  await page.getByLabel('Nom du board').fill('Recette');
  await page.getByRole('button', { name: 'Créer un board' }).click();
  await expect(page.getByRole('heading', { name: 'Recette' })).toBeVisible();
  boardUrl = page.url();
  for (const col of ['À faire', 'Aujourd’hui', 'En cours', 'Terminé'])
    await expect(cell(page, col)).toBeVisible();

  // Saisie en rafale : Entrée crée la tâche et le champ reste prêt.
  await cell(page, 'À faire').getByRole('button', { name: '+ Ajouter une tâche' }).click();
  const field = page.getByLabel('Nom de la tâche, Entrée pour valider');
  for (const name of ['T1', 'T2', 'T3']) {
    await field.fill(name);
    await field.press('Enter');
  }
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('');
  await expect(cell(page, 'À faire').locator('[data-task]')).toHaveCount(3);

  // Glisser-déposer au clavier : Espace pour saisir, flèche, Espace pour déposer.
  await keyboardMove(page, 'T1', 'ArrowRight');
  await expect(cell(page, 'Aujourd’hui').locator('[data-task="T1"]')).toBeVisible();
  await page.reload();
  await expect(cell(page, 'Aujourd’hui').locator('[data-task="T1"]')).toBeVisible();

  // Dépôt dans la colonne de complétion → groupe « Aujourd'hui ».
  await keyboardMove(page, 'T2', 'ArrowRight', 'ArrowRight', 'ArrowRight');
  const done = cell(page, 'Terminé');
  await expect(done.locator('[data-task="T2"]')).toBeVisible();
  await expect(done.getByRole('button', { name: /Aujourd’hui/ })).toBeVisible();

  // Détail : 3 sous-tâches dont 1 cochée → la carte affiche 1/3.
  await card(page, 'T3').click();
  const dialog = page.getByRole('dialog');
  const subtask = dialog.getByLabel('Nouvelle sous-tâche, Entrée pour ajouter');
  for (const name of ['a', 'b', 'c']) {
    await subtask.fill(name);
    await subtask.press('Enter');
    await expect(dialog.getByRole('checkbox', { name, exact: true })).toBeVisible();
  }
  await dialog.getByRole('checkbox', { name: 'a', exact: true }).check();
  await expect(dialog.getByRole('heading', { name: /Sous-tâches 1\/3/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(card(page, 'T3')).toContainText('1/3');
});

test('récurrence : une tâche hebdomadaire terminée prépare la suivante dans « À venir »', async ({
  page,
}) => {
  await login(page, 'admin', ADMIN_PASSWORD);
  await page.goto(boardUrl);
  await card(page, 'T1').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Récurrence').selectOption('weekly');
  await expect(dialog.getByText('Occurrence n° 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, 'T1')).toContainText('↻');

  await keyboardMove(page, 'T1', 'ArrowRight', 'ArrowRight');
  await expect(cell(page, 'Terminé').locator('[data-task="T1"]')).toBeVisible();
  const upcoming = cell(page, 'À faire').getByText('À venir (1)');
  await expect(upcoming).toBeVisible();
  await upcoming.click();
  await expect(cell(page, 'À faire').getByRole('button', { name: /↻ T1/ })).toBeVisible();
});

test('collaboration : un déplacement est visible chez l’autre membre en moins de 2 s, mention notifiée', async ({
  browser,
}) => {
  const adminPage = await (await browser.newContext()).newPage();
  await login(adminPage, 'admin', ADMIN_PASSWORD);
  const boardId = boardUrl.split('/').pop()!;
  const users = await (await adminPage.request.get('/api/users')).json();
  const alice = users.find((u: { username: string }) => u.username === 'alice');
  const added = await adminPage.request.post(`/api/boards/${boardId}/members`, {
    headers: { 'x-flowboard-csrf': '1' },
    data: { userId: alice._id, role: 'editor' },
  });
  expect(added.ok()).toBe(true);

  const alicePage = await (await browser.newContext()).newPage();
  await login(alicePage, 'alice', alicePassword);
  await alicePage.getByLabel('Mot de passe actuel').fill(alicePassword);
  await alicePage.getByLabel('Nouveau mot de passe (10 caractères minimum)').fill('alice-final-pass');
  await alicePage.getByLabel('Confirmer le nouveau mot de passe').fill('alice-final-pass');
  await alicePage.getByRole('button', { name: 'Enregistrer' }).click();
  await alicePage.goto(boardUrl);
  await expect(card(alicePage, 'T3')).toBeVisible();
  await adminPage.goto(boardUrl);
  await expect(card(adminPage, 'T3')).toBeVisible();

  await keyboardMove(adminPage, 'T3', 'ArrowRight', 'ArrowRight');
  await expect(cell(alicePage, 'En cours').locator('[data-task="T3"]')).toBeVisible({ timeout: 2000 });

  // Mention dans un commentaire → la cloche d'Alice s'incrémente en temps réel.
  await card(adminPage, 'T3').click();
  const dialog = adminPage.getByRole('dialog');
  await dialog
    .getByLabel('Écrire un commentaire… (@identifiant pour mentionner)')
    .fill('Peux-tu relire @alice ?');
  await dialog.getByRole('button', { name: 'Envoyer' }).click();
  await expect(dialog.getByText('Peux-tu relire @alice ?')).toBeVisible();
  await expect(alicePage.getByRole('button', { name: 'Notifications (1)' })).toBeVisible({ timeout: 2000 });
  await alicePage.getByRole('button', { name: 'Notifications (1)' }).click();
  await expect(alicePage.getByText('admin vous a mentionné dans « T3 »')).toBeVisible();
});

test('filtre mémorisé et recherche globale (/) jusqu’à un mot de commentaire', async ({ page }) => {
  await login(page, 'admin', ADMIN_PASSWORD);
  await page.goto(boardUrl);
  await page.getByLabel('Filtrer les tâches…').fill('T2');
  await expect(card(page, 'T3')).toBeHidden();
  await expect(card(page, 'T2')).toBeVisible();
  await expect(page.getByText(/tâches? masquées?/)).toBeVisible();
  await page.waitForTimeout(600); // enregistrement différé du filtre
  await page.reload();
  await expect(page.getByLabel('Filtrer les tâches…')).toHaveValue('T2');
  await expect(card(page, 'T3')).toBeHidden();
  await page.getByRole('button', { name: 'Réinitialiser' }).click();
  await expect(card(page, 'T3')).toBeVisible();

  await page.locator('body').press('/');
  const dialog = page.getByRole('dialog', { name: 'Rechercher' });
  await dialog.getByLabel('Nom, description, commentaire, sous-tâche, label…').fill('relire');
  await dialog.getByRole('button', { name: /T3/ }).click();
  await expect(page.getByRole('dialog', { name: 'T3' })).toBeVisible();
});

test('temps : chronomètre persistant, Pomodoro interrompu, Pomodoro désactivable', async ({ page }) => {
  await login(page, 'admin', ADMIN_PASSWORD);
  await page.goto(boardUrl);
  await card(page, 'T2').click();
  const dialog = page.getByRole('dialog', { name: 'T2' });
  await dialog.getByRole('button', { name: /Chronomètre/ }).click();
  const bar = page.getByRole('timer');
  await expect(bar).toContainText('Chronomètre');
  await expect(bar).toContainText('T2');
  await page.reload();
  await expect(page.getByRole('timer')).toContainText('T2'); // état côté serveur
  await page.getByRole('dialog', { name: 'T2' }).getByRole('button', { name: 'Fermer' }).click(); // ?task= rouvre le détail
  await page.getByRole('timer').getByRole('button', { name: 'Arrêter' }).click();
  await expect(page.getByRole('timer')).toBeHidden();

  await card(page, 'T2').click();
  await page
    .getByRole('dialog', { name: 'T2' })
    .getByRole('button', { name: /Pomodoro/ })
    .click();
  await expect(page.getByRole('timer')).toContainText(/24:5\d|25:00/);
  await page.getByRole('dialog', { name: 'T2' }).getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('timer').getByRole('button', { name: 'Interrompre' }).click();
  await page.getByLabel('Motif').selectOption('meeting');
  await page.getByRole('button', { name: 'Confirmer' }).click();
  await expect(page.getByRole('timer')).toBeHidden();

  await page.goto('/profile');
  await page.getByLabel(/Activer le Pomodoro/).uncheck();
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await expect(page.getByRole('status')).toContainText('Enregistré');
  await page.goto(boardUrl);
  await card(page, 'T2').click();
  await expect(
    page.getByRole('dialog', { name: 'T2' }).getByRole('button', { name: /Chronomètre/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'T2' }).getByRole('button', { name: /Pomodoro/ }),
  ).toHaveCount(0);
});

test('rapport de temps de la semaine, export CSV et vue impression', async ({ page }) => {
  await login(page, 'admin', ADMIN_PASSWORD);
  const boardId = boardUrl.split('/').pop()!;
  const tasks = (await (await page.request.get(`/api/boards/${boardId}`)).json()).tasks as {
    _id: string;
    name: string;
  }[];
  const t3 = tasks.find((x) => x.name === 'T3')!;
  const logged = await page.request.post('/api/time-entries', {
    headers: { 'x-flowboard-csrf': '1' },
    data: {
      taskId: t3._id,
      startAt: new Date(Date.now() - 4 * 3_600_000),
      durationSeconds: 5400,
      timeLabels: ['Facturable'],
    },
  });
  expect(logged.ok()).toBe(true);

  await page.getByRole('link', { name: 'Rapports' }).click();
  await page.getByLabel('Regrouper par').selectOption('task');
  await expect(page.getByRole('row', { name: /T3/ })).toContainText('1 h 30');
  await expect(page.getByRole('link', { name: 'Exporter en CSV' })).toHaveAttribute('href', /format=csv/);

  await page.goto(boardUrl);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('header')).toBeHidden();
  await expect(card(page, 'T3')).toBeVisible();
});

test('raccourcis clavier : aide (?), nouvelle tâche (n), filtre (f)', async ({ page }) => {
  await login(page, 'admin', ADMIN_PASSWORD);
  await page.goto(boardUrl);
  await expect(card(page, 'T2')).toBeVisible();
  await page.locator('body').press('?');
  await expect(page.getByRole('dialog', { name: 'Raccourcis clavier' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('body').press('n');
  await expect(page.getByLabel('Nom de la tâche, Entrée pour valider')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.locator('body').press('f');
  await expect(page.getByLabel('Filtrer les tâches…')).toBeFocused();
});

test('lot 11 : numérotation, champ personnalisé sur la carte, historique, journal et mode mur', async ({
  page,
}) => {
  await login(page, 'admin', ADMIN_PASSWORD);
  await page.goto(boardUrl);
  await page.getByRole('button', { name: 'Réglages du board' }).click();
  const settings = page.getByRole('dialog', { name: 'Réglages du board' });
  await settings.getByLabel(/Numéroter les tâches/).check();
  await settings.getByLabel('Préfixe (ex. OPS-)').fill('REC-');
  await settings.getByLabel('Préfixe (ex. OPS-)').blur();
  await settings.getByLabel('Nouveau champ').fill('Client');
  await settings.getByLabel('Nouveau champ').press('Enter');
  await settings.getByLabel('Sur la carte').check();
  await settings.getByRole('button', { name: 'Fermer' }).click();
  await expect(card(page, 'T2')).toContainText(/REC-\d+/);

  await card(page, 'T2').click();
  const dialog = page.getByRole('dialog', { name: 'T2' });
  await dialog.getByRole('textbox', { name: 'Client' }).fill('Acme');
  await dialog.getByRole('textbox', { name: 'Client' }).blur();
  await expect(card(page, 'T2')).toContainText('Client :Acme');
  await dialog.getByText('Historique').click();
  await expect(dialog.getByText('Client : — → Acme')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer' }).click();

  await page.getByRole('button', { name: 'Journal' }).click();
  const journal = page.getByRole('dialog', { name: 'Journal' });
  await journal.getByLabel('Type d’événement').selectOption('taskChanged');
  await expect(journal.getByText('Client : — → Acme')).toBeVisible();
  await journal.getByRole('button', { name: 'Fermer' }).click();

  await page.getByRole('link', { name: 'Mode mur' }).click();
  await expect(page.getByRole('button', { name: 'Plein écran' })).toBeVisible();
  await expect(card(page, 'T2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rechercher' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Ajouter une tâche' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Quitter le mode mur' }).click();
  await expect(page.getByRole('button', { name: 'Réglages du board' })).toBeVisible();
});

test('onboarding : l’admin ouvre les inscriptions, la page d’inscription apparaît puis disparaît', async ({
  page,
  browser,
}) => {
  await login(page, 'admin', ADMIN_PASSWORD);
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Instance' }).click();
  await page.getByLabel(/Inscription en libre-service/).check();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByLabel(/Inscription en libre-service/)).toBeChecked();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/');
  await expect(visitor.getByLabel('Identifiant ou email')).toBeVisible();
  await visitor.getByRole('link', { name: 'Créer un compte' }).click();
  await visitor.getByLabel('Adresse email').fill('nouvelle@librehub.store');
  await visitor.getByLabel('Nom complet').fill('Nouvelle Venue');
  await visitor.getByLabel('Nouveau mot de passe (10 caractères minimum)').fill('bienvenue-2026');
  await visitor.getByLabel('Confirmer le nouveau mot de passe').fill('bienvenue-2026');
  await visitor.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(visitor.getByRole('heading', { name: 'Vérifiez votre boîte mail' })).toBeVisible();
  // Compte en attente : visible par l'admin, pas encore utilisable.
  await page.getByRole('tab', { name: 'Comptes' }).click();
  await expect(page.getByRole('row', { name: /nouvelle/ })).toContainText('Email non validé');

  await page.getByRole('tab', { name: 'Instance' }).click();
  await page.getByLabel(/Par l’administration/).check();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByLabel(/Par l’administration/)).toBeChecked();
  await visitor.goto('/register');
  await expect(visitor.getByRole('link', { name: 'Créer un compte' })).toHaveCount(0);
});

test('menu contextuel : clic droit pour dupliquer, suppression confirmée, accès clavier (Maj+F10)', async ({
  page,
}) => {
  await login(page, 'admin', ADMIN_PASSWORD);
  await page.goto(boardUrl);
  await card(page, 'T2').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions pour « T2 »' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Ouvrir', 'Dupliquer', 'Archiver', 'Supprimer…']);
  await expect(menu.getByRole('menuitem', { name: 'Ouvrir' })).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Dupliquer' }).click();
  await expect(card(page, 'T2 (copie)')).toBeVisible();
  await expect(menu).toBeHidden();

  // Suppression : une confirmation ; « Annuler » ne supprime rien.
  await card(page, 'T2 (copie)').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Supprimer…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Supprimer la tâche ?' });
  await expect(confirm).toContainText('« T2 (copie) » sera supprimée définitivement');
  await confirm.getByRole('button', { name: 'Annuler' }).click();
  await expect(card(page, 'T2 (copie)')).toBeVisible();
  await card(page, 'T2 (copie)').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Supprimer…' }).click();
  await page
    .getByRole('dialog', { name: 'Supprimer la tâche ?' })
    .getByRole('button', { name: 'Supprimer' })
    .click();
  await expect(card(page, 'T2 (copie)')).toHaveCount(0);

  // Clavier : Maj+F10 sur la carte, flèches, Échap rend le focus à la carte.
  await card(page, 'T2').locator('[data-handle]').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Ouvrir' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Dupliquer' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(card(page, 'T2').locator('[data-handle]')).toBeFocused();
});
