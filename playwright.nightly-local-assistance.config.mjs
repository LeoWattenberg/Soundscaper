/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

export function createNightlyLocalAssistanceConfig(environment = process.env) {
	if (environment.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS !== '1') {
		throw new Error('Real model tests perform large downloads. Set SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS=1 to run them.');
	}
	const payloadRoot = requiredRoot(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT');
	const runRoot = requiredRoot(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT');
	const artifactRoot = resolve(runRoot, 'local-assistance');
	return defineConfig({
		testDir: resolve(payloadRoot, 'tests/electron/local-assistance-models'),
		testMatch: '**/*.spec.js',
		timeout: 1_800_000,
		expect: { timeout: 30_000 },
		fullyParallel: false,
		workers: 1,
		retries: 0,
		forbidOnly: true,
		failOnFlakyTests: true,
		updateSnapshots: 'none',
		reporter: [
			['list'],
			['html', { outputFolder: resolve(artifactRoot, 'playwright-report'), open: 'never' }],
			['json', { outputFile: resolve(artifactRoot, 'results.json') }],
			['junit', { outputFile: resolve(artifactRoot, 'junit.xml') }],
		],
		outputDir: resolve(artifactRoot, 'test-results'),
		projects: [{ name: 'electron-real-models' }],
	});
}

function requiredRoot(environment, key) {
	const value = environment[key];
	if (typeof value !== 'string' || !isAbsolute(value)) throw new TypeError(`${key} must be an absolute path.`);
	return value;
}

export default createNightlyLocalAssistanceConfig();
