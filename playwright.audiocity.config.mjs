/* SPDX-License-Identifier: AGPL-3.0-only */

import { defineConfig, devices } from '@playwright/test';
import { audiocityValidationPort } from './scripts/lib/audiocity-validation-config.mjs';

const port = audiocityValidationPort(process.env.PLAYWRIGHT_PORT, 4325);
const baseURL = `http://127.0.0.1:${port}`;
// This suite serves only Soundscaper; relative test URLs use its baseURL.
delete process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS;

export default defineConfig({
	testDir: './tests/browser/audiocity', fullyParallel: false, workers: 1, timeout: 90_000,
	expect: { timeout: 10_000 }, reporter: 'list', outputDir: 'test-results/audiocity',
	use: { baseURL, serviceWorkers: 'block', acceptDownloads: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: { command: 'node scripts/audiocity-validation-server.mjs', url: `${baseURL}/api/audiocom/usage`,
		reuseExistingServer: false, timeout: 120_000, gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 } },
});
