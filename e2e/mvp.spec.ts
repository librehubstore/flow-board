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
  await card(page, name).focus();
  await page.keyboard.press('Space');
  for (const key of keys) {
    await page.waitForTimeout(150);
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');
}
const cell = (page: Page, column: string) => page.getByRole('group', { name: column, exact: true });

test('premier lancement : l’admin se connecte, doit changer son mot de passe, arrive sur ses boards', async ({ page }) => {
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

test('flux Kanban : création en rafale, glisser-déposer clavier, complétion, sous-tâches', async ({ page }) => {
  await login(page, 'admin', ADMIN_PASSWORD);
  await page.getByLabel('Nom du board').fill('Recette');
  await page.getByRole('button', { name: 'Créer un board' }).click();
  await expect(page.getByRole('heading', { name: 'Recette' })).toBeVisible();
  boardUrl = page.url();
  for (const col of ['À faire', 'Aujourd’hui', 'En cours', 'Terminé']) await expect(cell(page, col)).toBeVisible();

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

test('collaboration : un déplacement est visible chez l’autre membre en moins de 2 s, mention notifiée', async ({ browser }) => {
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
  await dialog.getByLabel('Écrire un commentaire… (@identifiant pour mentionner)').fill('Peux-tu relire @alice ?');
  await dialog.getByRole('button', { name: 'Envoyer' }).click();
  await expect(dialog.getByText('Peux-tu relire @alice ?')).toBeVisible();
  await expect(alicePage.getByRole('button', { name: 'Notifications (1)' })).toBeVisible({ timeout: 2000 });
  await alicePage.getByRole('button', { name: 'Notifications (1)' }).click();
  await expect(alicePage.getByText('admin vous a mentionné dans « T3 »')).toBeVisible();
});
