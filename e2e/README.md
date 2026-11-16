# Pruebas de punta a punta (Playwright)

Abren un navegador real y usan el sistema como lo haría la fundación.

## Primera vez

```bash
cd e2e
npm install
npx playwright install chromium
```

## Correr

1. Levanta el sistema: `docker compose --profile app up -d --build` (desde la raíz).
2. Desde `e2e/`:

| Comando | Qué hace |
|---|---|
| `npm test` | Corre todas las pruebas |
| `npm run test:ui` | Modo visual: ves cada paso y puedes repetir pruebas |
| `npm run test:headed` | Corre mostrando el navegador |
| `npm run reporte` | Abre el reporte de la última corrida (con capturas y video de las que fallaron) |
| `npm run grabar` | Abre el sistema y va generando el código de lo que haces con clics |

Contra el frontend en desarrollo (`npm run dev`): `BASE_URL=http://localhost:5173 npm test`
(en PowerShell: `$env:BASE_URL="http://localhost:5173"; npm test`).

## Qué se prueba

| Archivo | Pruebas |
|---|---|
| `tests/login.spec.ts` | Entrar, error con contraseña incorrecta, campos vacíos, cerrar sesión, rutas protegidas |
| `tests/olvide-contrasena.spec.ts` | "¿Olvidaste tu contraseña?": valida el correo, el correo llega a Mailpit y su enlace abre la pantalla correcta |
| `tests/navegacion.spec.ts` | Menú, barra de etapas y rutas (necesita un proceso activo; si no hay, se omiten) |

## Notas

- Usa el usuario de prueba `coordinacion@fcg.cl` / `Demo1234!`. Ninguna prueba cambia su contraseña.
- Las pruebas corren de a una porque el login permite 10 intentos por minuto y
  "¿Olvidaste tu contraseña?" 5 cada 15 minutos.
- Si en `.env` tienes `MAIL_REDIRIGIR_A`, los correos no llegan a Mailpit con el destinatario
  original y la prueba del enlace falla: déjalo vacío al correr las pruebas.
