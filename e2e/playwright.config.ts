import { defineConfig, devices } from '@playwright/test';

/**
 * Las pruebas corren contra el sistema levantado con Docker:
 *   docker compose --profile app up -d --build   → http://localhost:8080
 * Para probar contra el frontend en desarrollo (npm run dev):
 *   BASE_URL=http://localhost:5173 npx playwright test
 */
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';

const SIN_SESION = /(login|olvide-contrasena)\.spec\.ts/;

export default defineConfig({
  testDir: './tests',
  // Todas las pruebas usan la misma base de datos y el login tiene un límite
  // de 10 intentos por minuto: se corren de a una.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'es-CL',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Inicia sesión una vez y guarda la sesión en .auth/equipo.json
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'sin-sesion',
      testMatch: SIN_SESION,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'con-sesion',
      testIgnore: [SIN_SESION, /.*\.setup\.ts/],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/equipo.json' },
    },
  ],
});
