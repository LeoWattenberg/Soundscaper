/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

import {
	firstLaunchSetupSeedValue,
	firstLaunchSetupStorageKey,
} from './src/common/editor/ui/first-launch-setup.ts';

export function createNightlyDualOriginConfig(environment = process.env) {
	const payloadRoot = requiredRoot(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT');
	const runRoot = requiredRoot(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT');
	const origins = productOrigins(environment.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS);
	const artifactRoot = resolve(runRoot, 'e2e-coverage/dual-origin');
	return defineConfig({
		testDir: resolve(payloadRoot, 'tests/browser/dual-origin'),
		testMatch: '*.spec.js',
		timeout: 90_000,
		expect: { timeout: 15_000 },
		fullyParallel: false,
		forbidOnly: true,
		failOnFlakyTests: true,
		retries: 0,
		workers: 1,
		updateSnapshots: 'none',
		reporter: [
			['list'],
			['html', { outputFolder: resolve(artifactRoot, 'playwright-report'), open: 'never' }],
			['json', { outputFile: resolve(artifactRoot, 'results.json') }],
			['junit', { outputFile: resolve(artifactRoot, 'junit.xml') }],
		],
		outputDir: resolve(artifactRoot, 'test-results'),
		use: {
			baseURL: origins.soundscaper,
			serviceWorkers: 'block',
			storageState: {
				cookies: [],
				origins: [{
					origin: origins.soundscaper,
					localStorage: [{
						name: firstLaunchSetupStorageKey('soundscaper'),
						value: firstLaunchSetupSeedValue(),
					}],
				}],
			},
			trace: 'retain-on-failure',
			screenshot: 'only-on-failure',
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

function requiredRoot(environment, key) {
	const value = environment[key];
	if (typeof value !== 'string' || !isAbsolute(value)) throw new TypeError(`${key} must be an absolute path.`);
	return value;
}

function productOrigins(encoded) {
	let value;
	try { value = JSON.parse(encoded); } catch {
		throw new TypeError('SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS must name both loopback product origins.');
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS must name both loopback product origins.');
	}
	const origins = {};
	for (const productId of ['soundscaper', 'framescaper']) {
		let url;
		try { url = new URL(value[productId]); } catch {
			throw new TypeError('SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS must name both loopback product origins.');
		}
		if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
			|| url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
			throw new TypeError('SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS must name both loopback product origins.');
		}
		origins[productId] = url.origin;
	}
	if (origins.soundscaper === origins.framescaper) {
		throw new Error('Nightly dual-origin coverage requires distinct product origins.');
	}
	return Object.freeze(origins);
}

export default createNightlyDualOriginConfig();
