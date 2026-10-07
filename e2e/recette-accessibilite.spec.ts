import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Audit WCAG 2.1 AA (spec § 10) sur les écrans principaux, en thème clair puis sombre.
// Nommé pour s'exécuter après mvp.spec (ordre alphabétique, un seul worker) : réutilise ses données.
const PASSWORD = 'admin-final-pass';

async function audit(page: Page, name: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = r.violations.map(
    (v) =>
      `${v.id} (${v.nodes.length}) : ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
  expect(summary, `${name}\n${summary.join('\n')}`).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test(`accessibilité WCAG 2.1 AA — thème ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await audit(page, 'connexion');
    await page.getByLabel('Identifiant').fill('admin');
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('heading', { name: 'Mes boards' })).toBeVisible();
    await page.request.patch('/api/me', { headers: { 'x-flowboard-csrf': '1' }, data: { theme: 'system' } });
    await audit(page, 'boards');
    await page.getByRole('link', { name: /Recette/ }).click();
    await expect(page.locator('[data-task]').first()).toBeVisible();
    await audit(page, 'board');
    await page.locator('[data-task]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await audit(page, 'détail de tâche');
    await page.getByRole('button', { name: 'Fermer' }).click();
    await page.getByRole('button', { name: 'Réglages du board' }).click();
    await audit(page, 'réglages du board');
    await page.goto('/reports');
    await audit(page, 'rapports');
    await page.goto('/profile');
    await audit(page, 'profil');
    await page.goto('/admin');
    await audit(page, 'administration');
  });
}
