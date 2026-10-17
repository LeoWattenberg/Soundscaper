// @ts-check
import { defineConfig, devices } from '@playwright/test';

import { browserProductSiteForBuild, vitePreviewServer } from './scripts/lib/browser-product-site-plan.mjs';

const site = browserProductSiteForBuild('lightscaper');

export default defineConfig({
	testDir: './tests/browser',
	testMatch: 'lightscaper-*.spec.js',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	workers: 2,
	timeout: 30_000,
	expect: { timeout: 5_000 },
	reporter: 'list',
	outputDir: 'test-results',
	webServer: vitePreviewServer(site),
	use: {
		baseURL: site.origin,
		serviceWorkers: 'block',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } },
	],
});
