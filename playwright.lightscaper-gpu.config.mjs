// @ts-check
import { defineConfig, devices } from '@playwright/test';
import { browserProductSiteForBuild, vitePreviewServer } from './scripts/lib/browser-product-site-plan.mjs';

const site = browserProductSiteForBuild('lightscaper');
process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS = JSON.stringify({ lightscaper: site.origin });

// This finite software-renderer corpus qualifies native color, verified LUTs,
// natural-extent geometry, manual optics, spatial effects, local masks, Original-space
// Clone/Heal and their Current Photo UI.
// Artifact verification precedes this config in the dedicated CI jobs.
export default defineConfig({
	testDir: './tests/browser',
	testMatch: ['lightscaper-native-gpu-current.spec.js', 'lightscaper-develop-gpu-preview-current.spec.js',
		'lightscaper-native-gpu-colors-current.spec.js', 'lightscaper-develop-gpu-colors-current.spec.js',
		'lightscaper-native-gpu-lut-current.spec.js', 'lightscaper-develop-gpu-lut-current.spec.js',
		'lightscaper-native-gpu-geometry-current.spec.js', 'lightscaper-develop-gpu-geometry-current.spec.js',
		'lightscaper-native-gpu-optics-current.spec.js', 'lightscaper-develop-gpu-optics-current.spec.js',
		'lightscaper-native-gpu-spatial-current.spec.js', 'lightscaper-develop-gpu-spatial-current.spec.js',
		'lightscaper-native-gpu-mask-blend-current.spec.js',
		'lightscaper-native-gpu-mask-context-current.spec.js',
		'lightscaper-native-gpu-mask-overlay-current.spec.js',
		'lightscaper-native-gpu-masked-context-integration-current.spec.js',
		'lightscaper-native-gpu-mask-numeric-refusal-current.spec.js',
		'lightscaper-native-gpu-mask-large-current.spec.js',
		'lightscaper-develop-gpu-mask-current.spec.js',
		'lightscaper-native-gpu-repair-current.spec.js',
		'lightscaper-native-gpu-repair-fault-current.spec.js',
		'lightscaper-native-gpu-repair-broker-current.spec.js',
		'lightscaper-native-gpu-repair-large-current.spec.js',
		'lightscaper-develop-gpu-repair-current.spec.js'],
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
