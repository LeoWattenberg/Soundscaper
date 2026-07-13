import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4322);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: './tests/browser',
	timeout: 30000,
	expect: { timeout: 5000 },
	fullyParallel: true,
	webServer: {
		command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
		url: baseURL,
		reuseExistingServer: false,
		timeout: 30000,
	},
	use: { baseURL, trace: 'on-first-retry' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
