import { expect, test } from '@playwright/test';
import { hayProcesoActivo } from './helpers';

// Estas pruebas necesitan un proceso activo (con la base recién creada solo
// aparece la pantalla "Iniciar proceso"). Si no lo hay, se marcan como omitidas.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  test.skip(!(await hayProcesoActivo(page)), 'No hay un proceso activo: inícialo en la plataforma para correr estas pruebas.');
});

const paginas = [
  { menu: 'Comunicación', ruta: '/comunicacion', titulo: 'Comunicación' },
  { menu: 'Seguimiento por liceo', ruta: '/seguimiento', titulo: 'Seguimiento por liceo' },
  { menu: 'Concursos anteriores', ruta: '/generaciones', titulo: 'Concursos anteriores' },
  { menu: 'Usuarios', ruta: '/usuarios', titulo: 'Usuarios' },
];

for (const p of paginas) {
  test(`el menú abre "${p.menu}"`, async ({ page }) => {
    // Solo el menú lateral: el Dashboard puede tener enlaces con el mismo texto.
    await page.locator('aside').getByRole('link', { name: p.menu, exact: true }).click();
    await expect(page).toHaveURL(p.ruta);
    await expect(page.getByRole('heading', { level: 1, name: p.titulo, exact: true })).toBeVisible();
    await expect(page.getByText('Internal server error')).toHaveCount(0);
  });
}

test('abre "Mi perfil"', async ({ page }) => {
  await page.goto('/perfil');
  await expect(page.getByRole('heading', { level: 1, name: 'Mi perfil' })).toBeVisible();
});

test('la barra de etapas marca una sola etapa en curso', async ({ page }) => {
  const barra = page.getByRole('list', { name: 'Etapas del proceso' });
  await expect(barra).toBeVisible();
  await expect(barra.locator('[aria-current="step"]')).toHaveCount(1);
});

test('una ruta que no existe vuelve al inicio', async ({ page }) => {
  await page.goto('/ruta-que-no-existe');
  await expect(page).toHaveURL('/');
});
