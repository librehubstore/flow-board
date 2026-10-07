import { expect, test } from '@playwright/test';

// Spec § 10 : un board de 1 000 tâches visibles s'affiche en moins de 1,5 s.
// Nommé pour s'exécuter après mvp.spec (ordre alphabétique, un seul worker) : réutilise le compte admin.
test('performance : board de 1 000 tâches affiché en moins de 1,5 s', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByLabel('Identifiant').fill('admin');
  await page.getByLabel('Mot de passe').fill('admin-final-pass');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Mes boards' })).toBeVisible();

  const headers = { 'x-flowboard-csrf': '1' };
  const board = await (await page.request.post('/api/boards', { headers, data: { name: 'Charge' } })).json();
  const columns: { _id: string }[] = board.columns;
  for (let i = 0; i < 1000; i += 50)
    await Promise.all(
      Array.from({ length: 50 }, (_, k) =>
        page.request.post(`/api/boards/${board._id}/tasks`, {
          headers,
          data: { name: `Tâche ${i + k}`, columnId: columns[(i + k) % 3]._id },
        }),
      ),
    );

  // Un chargement de chauffe (le serveur sort de 1 000 créations), puis la médiane de trois chargements :
  // une mesure unique à froid est trop bruitée pour un seuil (mesuré : 0,57 à 0,59 s en médiane).
  const load = async () => {
    const started = Date.now();
    await page.goto(`/boards/${board._id}`);
    await expect(page.locator('[data-task]')).toHaveCount(1000);
    return Date.now() - started;
  };
  await load();
  const times = [await load(), await load(), await load()].sort((a, b) => a - b);
  console.log(`Board de 1 000 tâches affiché en ${times[1]} ms (médiane de ${times.join(', ')})`);
  expect(times[1]).toBeLessThan(1500);
});
