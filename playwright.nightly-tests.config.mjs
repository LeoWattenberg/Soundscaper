/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

function requireAbsolutePath(environment, key) {
	const value = environment[key];
	if (typeof value !== 'string' || value.length === 0 || !isAbsolute(value)) {
		throw new Error(`${key} must be an absolute path supplied by the nightly test launcher.`);
	}
	return value;
}

function requireLoopbackURL(environment) {
	const value = environment.SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL;
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL must be a valid loopback URL.');
	}
	if (
		url.protocol !== 'http:'
		|| url.hostname !== '127.0.0.1'
		|| url.username !== ''
		|| url.password !== ''
		|| url.pathname !== '/'
		|| url.search !== ''
		|| url.hash !== ''
	) {
		throw new Error('SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL must be an HTTP loopback URL.');
	}
	return url.href.replace(/\/$/u, '');
}

export function createNightlyTestsConfig(environment = process.env, platform = process.platform) {
	const payloadRoot = requireAbsolutePath(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT');
	const runRoot = requireAbsolutePath(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT');
	const baseURL = requireLoopbackURL(environment);
	const projects = [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				browserName: 'chromium',
				channel: 'chromium',
				headless: true,
				launchOptions: { args: ['--enable-gpu'] },
			},
		},
		{ name: 'firefox', use: { ...devices['Desktop Firefox'], browserName: 'firefox' } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'], browserName: 'webkit' } },
	];

	return defineConfig({
		testDir: resolve(payloadRoot, 'tests/browser'),
		timeout: 30000,
		expect: { timeout: 5000 },
		fullyParallel: true,
		forbidOnly: true,
		failOnFlakyTests: false,
		retries: 1,
		workers: 2,
		updateSnapshots: 'none',
		reporter: [
			['list'],
			['html', { outputFolder: resolve(runRoot, 'playwright-report'), open: 'never' }],
			['json', { outputFile: resolve(runRoot, 'results.json') }],
			['junit', { outputFile: resolve(runRoot, 'junit.xml') }],
		],
		outputDir: resolve(runRoot, 'test-results'),
		use: {
			baseURL,
			serviceWorkers: 'block',
			trace: 'on-first-retry',
			screenshot: 'only-on-failure',
		},
		// Playwright's Windows WebKit build disables Web Audio at compile time,
		// while Soundscaper requires it to boot and decode its fixture projects.
		projects: platform === 'win32' ? projects.slice(0, 2) : projects,
	});
}

export default createNightlyTestsConfig();
