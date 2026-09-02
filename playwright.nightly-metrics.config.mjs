/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

import {
	firstLaunchSetupSeedValue,
	firstLaunchSetupStorageKey,
} from './src/common/editor/ui/first-launch-setup.ts';

const METRIC_SPECS = Object.freeze([
	'audio-editor-video-preview-benchmark.spec.js',
	'audio-editor-longform-editorial-benchmark.spec.js',
	'audio-editor-m4-production-parity.spec.js',
	'audio-editor-m4b2-keyframe-parity.spec.js',
]);

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
	try { url = new URL(value); } catch {
		throw new Error('SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL must be a valid loopback URL.');
	}
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
		|| url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new Error('SOUNDSCAPER_NIGHTLY_TESTS_BASE_URL must be an HTTP loopback URL.');
	}
	return url.href.replace(/\/$/u, '');
}

export function createNightlyMetricsConfig(environment = process.env) {
	const payloadRoot = requireAbsolutePath(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT');
	const runRoot = requireAbsolutePath(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT');
	const metricsRoot = resolve(runRoot, 'metrics');
	return defineConfig({
		testDir: resolve(payloadRoot, 'tests/browser'),
		testMatch: METRIC_SPECS,
		timeout: 30_000,
		expect: { timeout: 5_000 },
		fullyParallel: false,
		forbidOnly: true,
		failOnFlakyTests: true,
		retries: 0,
		workers: 1,
		updateSnapshots: 'none',
		reporter: [
			['list'],
			['html', { outputFolder: resolve(metricsRoot, 'playwright-report'), open: 'never' }],
			['json', { outputFile: resolve(metricsRoot, 'results.json') }],
			['junit', { outputFile: resolve(metricsRoot, 'junit.xml') }],
		],
		outputDir: resolve(metricsRoot, 'test-results'),
		use: {
			baseURL: requireLoopbackURL(environment),
			serviceWorkers: 'block',
			trace: 'retain-on-failure',
			screenshot: 'only-on-failure',
			// Every fresh context counts as a first launch; seed the finished-setup
			// flag so the workspace chooser never sits in front of a nightly spec.
			storageState: {
				cookies: [],
				origins: [{
					origin: new URL(requireLoopbackURL(environment)).origin,
					localStorage: [{ name: firstLaunchSetupStorageKey('soundscaper'), value: firstLaunchSetupSeedValue() }],
				}],
			},
		},
		projects: [{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				browserName: 'chromium',
				channel: 'chromium',
				headless: true,
				launchOptions: { args: ['--enable-gpu'] },
			},
		}],
	});
}

export default createNightlyMetricsConfig();
