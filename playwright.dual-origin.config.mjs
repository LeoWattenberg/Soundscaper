import { defineConfig, devices } from '@playwright/test';

const soundscaperOrigin = 'http://127.0.0.1:4332';
const framescaperOrigin = 'http://127.0.0.1:4333';
const fixtureRoot = '.wrangler/dual-origin-browser';
const outputDir = process.env.PLAYWRIGHT_DUAL_ORIGIN_OUTPUT_DIR ?? 'test-results/dual-origin';

function pagesServer(productId, origin, readinessPath) {
	const port = new URL(origin).port;
	return {
		command: 'node node_modules/wrangler/bin/wrangler.js pages dev '
			+ `${fixtureRoot}/${productId} --ip 127.0.0.1 --port ${port} `
			+ `--persist-to ${fixtureRoot}/state/${productId} --log-level=error `
			+ '--show-interactive-dev-session=false',
		url: `${origin}${readinessPath}`,
		reuseExistingServer: false,
		timeout: 120_000,
	};
}

export default defineConfig({
	testDir: './tests/browser/dual-origin',
	testMatch: '*.spec.js',
	timeout: 90_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	failOnFlakyTests: false,
	retries: 0,
	workers: 1,
	reporter: process.env.CI
		? [['github'], ['html', { outputFolder: 'playwright-report/dual-origin', open: 'never' }]]
		: 'list',
	outputDir,
	webServer: [
		pagesServer('soundscaper', soundscaperOrigin, '/transfer/send/'),
		pagesServer('framescaper', framescaperOrigin, '/transfer/receive/'),
	],
	use: {
		baseURL: soundscaperOrigin,
		serviceWorkers: 'block',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
	],
});
