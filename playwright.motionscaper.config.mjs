/* SPDX-License-Identifier: AGPL-3.0-only */
// @ts-check

import { defineConfig, devices } from '@playwright/test';
import { ordinaryBrowserProductSitePlan, siteFor, vitePreviewServer } from './scripts/lib/browser-product-site-plan.mjs';

const site = siteFor(ordinaryBrowserProductSitePlan(), 'motionscaper');
process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS = JSON.stringify({ motionscaper: site.origin });

export default defineConfig({
	testDir: './tests/browser',
	testMatch: '**/motionscaper*.spec.{js,ts}',
	testIgnore: ['**/motionscaper-linked-editors.spec.ts', '**/motionscaper-linked-native-menu.spec.ts'],
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	workers: 2,
	timeout: 30_000,
	expect: { timeout: 5_000 },
	reporter: 'list',
	outputDir: 'test-results',
	webServer: [vitePreviewServer(site)],
	use: {
		baseURL: site.origin,
		serviceWorkers: 'block',
		storageState: { cookies: [], origins: [] },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		// Qualify this bounded workflow before widening the local engine matrix.
		{ name: 'firefox', testMatch: ['**/motionscaper-platform.spec.ts', '**/motionscaper-video-delivery.spec.ts', '**/motionscaper-project-release.spec.ts'], use: { ...devices['Desktop Firefox'], browserName: 'firefox', deviceScaleFactor: 1 } },
		{ name: 'webkit', testMatch: ['**/motionscaper-platform.spec.ts', '**/motionscaper-video-delivery.spec.ts', '**/motionscaper-project-release.spec.ts'], use: { ...devices['Desktop Safari'], browserName: 'webkit', deviceScaleFactor: 1 } },
	],
});
