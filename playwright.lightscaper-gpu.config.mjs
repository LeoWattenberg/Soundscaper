// @ts-check
import { defineConfig, devices } from '@playwright/test';
import { browserProductSiteForBuild, vitePreviewServer } from './scripts/lib/browser-product-site-plan.mjs';

const site = browserProductSiteForBuild('lightscaper');
process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS = JSON.stringify({ lightscaper: site.origin });

// This finite software-renderer corpus qualifies all native color families and
// their Current Photo UI. Other Develop GPU families keep whole CPU fallback.
// Artifact verification precedes this config in the dedicated CI jobs.
export default defineConfig({
	testDir: './tests/browser',
	testMatch: ['lightscaper-native-gpu-current.spec.js', 'lightscaper-develop-gpu-preview-current.spec.js',
		'lightscaper-native-gpu-colors-current.spec.js', 'lightscaper-develop-gpu-colors-current.spec.js'],
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	workers: 1,
	retries: 0,
	timeout: 30_000,
	expect: { timeout: 5_000 },
	reporter: process.env.CI
		? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
		: 'list',
	outputDir: 'test-results',
	webServer: vitePreviewServer(site),
	use: {
		baseURL: site.origin,
		serviceWorkers: 'block',
		storageState: { cookies: [], origins: [] },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [{
		name: 'lightscaper-software-gpu',
		use: {
			...devices['Desktop Chrome'],
			browserName: 'chromium',
			launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
		},
	}],
});
