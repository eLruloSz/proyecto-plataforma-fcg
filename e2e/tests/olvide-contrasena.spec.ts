import { expect, test } from '@playwright/test';
import { EQUIPO, enlaceDeRestablecer } from './helpers';

// Ojo: el backend permite 5 solicitudes de "¿Olvidaste tu contraseña?" cada 15 minutos.
// Si corres esta prueba muchas veces seguidas, espera un rato.
test.describe('¿Olvidaste tu contraseña?', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
  });

  test('valida el formato del correo', async ({ page }) => {
    await page.getByLabel('Correo', { exact: true }).fill('esto-no-es-un-correo');
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await expect(page.getByRole('alert')).toHaveText('Ingresa un correo válido.');
  });

  test('envía el enlace por correo y el enlace abre la pantalla para elegir contraseña', async ({ page, request }) => {
    const desde = Date.now();
    await page.getByLabel('Correo', { exact: true }).fill(EQUIPO.email);
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();

    const ruta = await enlaceDeRestablecer(request, EQUIPO.email, desde);
    await page.goto(ruta);
    await expect(page.getByRole('heading', { name: 'Elige una nueva contraseña' })).toBeVisible();
    await expect(page.getByLabel('Contraseña (mínimo 10 caracteres)')).toBeVisible();
    await expect(page.getByLabel('Repetir contraseña')).toBeVisible();
    // No se guarda una contraseña nueva: así Demo1234! sigue sirviendo para las demás pruebas.
  });

  test('un enlace inválido muestra un error', async ({ page }) => {
    await page.goto('/acceso#t=enlace-que-no-existe');
    await expect(page.getByRole('heading', { name: 'No se pudo usar el enlace' })).toBeVisible();
  });
});
