/* SPDX-License-Identifier: AGPL-3.0-only */
import { defineConfig, devices } from '@playwright/test';
const framePort = Number(process.env.PLAYWRIGHT_LINK_FRAME_PORT || 4345), motionPort = Number(process.env.PLAYWRIGHT_LINK_MOTION_PORT || 4346);
const frameOrigin = `http://127.0.0.1:${framePort}`, motionOrigin = `http://127.0.0.1:${motionPort}`;
export default defineConfig({
	testDir: './tests/browser', testMatch: ['**/motionscaper-linked-editors.spec.ts', '**/motionscaper-linked-native-menu.spec.ts'], workers: 1, timeout: 90_000,
	forbidOnly: Boolean(process.env.CI), expect: { timeout: 15_000 }, reporter: 'list', outputDir: 'test-results',
	webServer: [ ['framescaper', framePort, frameOrigin], ['motionscaper', motionPort, motionOrigin] ].map(([product, port, origin]) => ({
		command: `node scripts/serve-pages-site.mjs .wrangler/motionscaper-links/${product} --host 127.0.0.1 --port ${port}`,
		url: `${origin}/en/`, reuseExistingServer: false, timeout: 120_000,
	})),
	use: { baseURL: frameOrigin, actionTimeout: 15_000, serviceWorkers: 'block', storageState: { cookies: [], origins: [] }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
