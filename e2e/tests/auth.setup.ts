import { expect, test as setup } from '@playwright/test';
import { botonCerrarSesion, iniciarSesion } from './helpers';

// Inicia sesión una sola vez; las pruebas del proyecto "con-sesion" reutilizan
// el token guardado (localStorage) y no gastan intentos de login.
setup('iniciar sesión como equipo', async ({ page }) => {
  await iniciarSesion(page);
  await expect(botonCerrarSesion(page)).toBeVisible();
  await page.context().storageState({ path: '.auth/equipo.json' });
});
