import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test/e2e',
    fullyParallel: false,
    workers: 1,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:8765',
        viewport: { width: 1440, height: 1000 },
        launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'node --import tsx --import ./test/e2e/mock-drivehub.mts .next/standalone/server.js',
        url: 'http://127.0.0.1:8765',
        reuseExistingServer: false,
        env: {
            EASYCHECK_E2E: '1',
            PORT: '8765',
            HOSTNAME: '127.0.0.1',
            NEXT_TELEMETRY_DISABLED: '1',
            APP_URL: 'http://127.0.0.1:8765',
            API_KEY: 'synthetic-test-api-key-at-least-32-characters',
            DRIVEHUB_APP_USERNAME: 'synthetic-app-user',
            DRIVEHUB_APP_PASSWORD: 'synthetic-app-password',
            DRIVEHUB_CLIENT_ID: 'synthetic-app-client',
            DRIVEHUB_EMAIL: 'driver@example.com',
            DRIVEHUB_PASSWORD: 'test-password',
        },
    },
});
