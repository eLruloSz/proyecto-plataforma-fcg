import { APIRequestContext, expect, Page } from '@playwright/test';

/** Usuario de los datos de prueba (db/02_datos_demo.sql). */
export const EQUIPO = { email: 'coordinacion@fcg.cl', password: 'Demo1234!' };

/** Interfaz web de Mailpit (docker-compose.yml). */
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export async function iniciarSesion(page: Page, email = EQUIPO.email, password = EQUIPO.password) {
  await page.goto('/');
  await page.getByLabel('Correo', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

export const botonCerrarSesion = (page: Page) => page.getByRole('button', { name: 'Cerrar sesión' });

/**
 * Espera a que cargue la sesión y responde si hay un proceso activo.
 * Sin proceso activo solo se muestra la pantalla "Iniciar proceso" (sin el menú lateral).
 */
export async function hayProcesoActivo(page: Page): Promise<boolean> {
  await expect(botonCerrarSesion(page)).toBeVisible();
  return page.getByRole('link', { name: 'Seguimiento por liceo' }).isVisible();
}

interface MensajeMailpit { ID: string; Created: string }

/**
 * Busca en Mailpit el correo de "Restablecer tu contraseña" enviado a `para`
 * después de `desde` y devuelve la ruta del enlace (/acceso#t=...).
 */
export async function enlaceDeRestablecer(request: APIRequestContext, para: string, desde: number): Promise<string> {
  let ruta = '';
  await expect
    .poll(async () => {
      const r = await request.get(`${MAILPIT}/api/v1/search`, {
        params: { query: `to:"${para}" subject:"Restablecer tu contraseña"` },
      });
      if (!r.ok()) return '';
      const { messages } = (await r.json()) as { messages: MensajeMailpit[] };
      // Margen de 5 s por si el reloj del contenedor no calza exacto con el del PC.
      const nuevo = messages.find((m) => new Date(m.Created).getTime() >= desde - 5_000);
      if (!nuevo) return '';
      const detalle = await (await request.get(`${MAILPIT}/api/v1/message/${nuevo.ID}`)).json();
      const texto = `${detalle.Text ?? ''} ${detalle.HTML ?? ''}`;
      const url = texto.match(/https?:\/\/[^\s"'<>]+\/acceso#t=[A-Za-z0-9_-]+/)?.[0];
      if (!url) return '';
      const u = new URL(url);
      ruta = u.pathname + u.hash; // sin el dominio: sirve con 8080 o con 5173
      return ruta;
    }, {
      timeout: 15_000,
      message: `No llegó a Mailpit (${MAILPIT}) el correo para ${para}. ¿Está MAIL_REDIRIGIR_A configurado en .env?`,
    })
    .not.toBe('');
  return ruta;
}
