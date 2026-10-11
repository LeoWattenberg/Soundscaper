/* SPDX-License-Identifier: AGPL-3.0-only */
import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_SUCCESSOR_PORT || 4335);
const origin = `http://127.0.0.1:${port}`;
process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS = JSON.stringify({ framescaper: origin });
export default defineConfig({
	testDir: './tests/browser', testMatch: '**/motionscaper-successor-*.spec.ts', fullyParallel: true, workers: 2,
	forbidOnly: Boolean(process.env.CI), timeout: 30_000, expect: { timeout: 10_000 }, reporter: 'list', outputDir: 'test-results',
	webServer: [{ command: `node node_modules/vite/bin/vite.js preview --outDir dist --host 127.0.0.1 --port ${port} --strictPort --logLevel error`, url: `${origin}/en/`, reuseExistingServer: false, timeout: 120_000 }],
	use: { baseURL: origin, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
