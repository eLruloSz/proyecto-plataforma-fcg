import { expect, test } from '@playwright/test';
import { botonCerrarSesion, EQUIPO, iniciarSesion } from './helpers';

test.describe('Inicio de sesión', () => {
  test('entra con el usuario de prueba y guarda la sesión', async ({ page }) => {
    await iniciarSesion(page);
    await expect(botonCerrarSesion(page)).toBeVisible();
    const token = await page.evaluate(() => localStorage.getItem('becas_token'));
    expect(token).toBeTruthy();
  });

  test('la sesión se mantiene al recargar la página', async ({ page }) => {
    await iniciarSesion(page);
    await expect(botonCerrarSesion(page)).toBeVisible();
    await page.reload();
    await expect(botonCerrarSesion(page)).toBeVisible();
  });

  test('con contraseña incorrecta muestra un error y no entra', async ({ page }) => {
    await iniciarSesion(page, EQUIPO.email, 'ContraseñaMala123');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('becas_token'))).toBeNull();
  });

  test('con campos vacíos pide correo y contraseña', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Ingresa tu correo y contraseña.');
  });

  test('cerrar sesión vuelve al login y borra el token', async ({ page }) => {
    await iniciarSesion(page);
    await botonCerrarSesion(page).click();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('becas_token'))).toBeNull();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  });

  test('sin sesión, cualquier ruta muestra el login', async ({ page }) => {
    await page.goto('/comunicacion');
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await expect(page.getByText('Comunicación', { exact: true })).toHaveCount(0);
  });
});
