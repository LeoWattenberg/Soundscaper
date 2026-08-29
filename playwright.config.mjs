import { defineConfig, devices } from '@playwright/test';

import {
	ordinaryBrowserProductSitePlan,
	vitePreviewServer,
} from './scripts/lib/browser-product-test-sites.mjs';

const sitePlan = ordinaryBrowserProductSitePlan();
const [soundscaper, framescaper] = sitePlan.sites;
const baseURL = soundscaper.origin;
process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS = JSON.stringify({
	soundscaper: soundscaper.origin,
	framescaper: framescaper.origin,
});

export default defineConfig({
	testDir: './tests/browser',
	testIgnore: ['handbook/**', 'dual-origin/**'],
	timeout: 30000,
	expect: { timeout: 5000 },
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	failOnFlakyTests: false,
	retries: process.env.CI ? 1 : 0,
	workers: process.env.CI ? 2 : undefined,
	reporter: process.env.CI
		? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
		: 'list',
	outputDir: 'test-results',
	webServer: [vitePreviewServer(soundscaper), vitePreviewServer(framescaper)],
	use: {
		baseURL,
		serviceWorkers: 'block',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'], browserName: 'firefox' } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'], browserName: 'webkit', deviceScaleFactor: 1 } },
	],
});
