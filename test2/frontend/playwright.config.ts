import { defineConfig } from '@playwright/test';

// Config del E2E de frontend (Test 2). Corre contra el sistema ya levantado en Docker.
export default defineConfig({
  testDir: '.',
  testMatch: /e2e-test2-etapa1-frontend\.spec\.ts/,
  workers: 1,               // los casos comparten estado (nómina → invitar → Forms): van en orden
  fullyParallel: false,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8080',
    screenshot: 'on',       // una captura por caso: sirve de evidencia para el informe
    trace: 'retain-on-failure',
    locale: 'es-CL',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});