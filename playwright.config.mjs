// @ts-check
import { defineConfig, devices } from '@playwright/test';

import {
	ordinaryBrowserProductSitePlan,
	vitePreviewServer,
} from './scripts/lib/browser-product-test-sites.mjs';

const sitePlan = ordinaryBrowserProductSitePlan();
const [soundscaper] = sitePlan.sites;
const baseURL = soundscaper.origin;
process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS = JSON.stringify(Object.fromEntries(
	sitePlan.sites.map(({ productId, origin }) => [productId, origin]),
));

export default defineConfig({
	testDir: './tests/browser',
	testIgnore: ['handbook/**', 'dual-origin/**'],
	timeout: 30000,
	expect: { timeout: 5000 },
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	failOnFlakyTests: false,
	retries: process.env.CI ? 1 : 0,
	// Media-heavy workflows spawn native decoder/capture processes. Letting
	// Playwright scale to half of a high-core workstation can starve those
	// processes until otherwise healthy workflows hit their bounds. Firefox's
	// real-audio CI jobs narrow this further to one worker per shard.
	workers: process.env.CI ? 2 : 4,
	reporter: process.env.CI
		? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
		: 'list',
	outputDir: 'test-results',
	webServer: sitePlan.sites.map((site) => vitePreviewServer(site)),
	use: {
		baseURL,
		serviceWorkers: 'block',
		storageState: { cookies: [], origins: [] },
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'], browserName: 'firefox' } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'], browserName: 'webkit', deviceScaleFactor: 1 } },
	],
});
