/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const PREVIEW = 'audio-editor-video-preview-benchmark.spec.js';
const PRODUCTION = 'audio-editor-m4-production-parity.spec.js';
const KEYED = 'audio-editor-m4b2-keyframe-parity.spec.js';
const SMOKE = 'desktop-packaged-runtime-smoke.spec.js';

function requiredRoot(environment, key) {
	const value = environment[key];
	if (typeof value !== 'string' || !isAbsolute(value)) throw new Error(`${key} must be an absolute path.`);
	return value;
}

export function createNightlyPackagedMetricsConfig(environment = process.env) {
	const payloadRoot = requiredRoot(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT');
	const runRoot = requiredRoot(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT');
	const artifactRoot = resolve(runRoot, 'packaged-runtime');
	return defineConfig({
		testDir: resolve(payloadRoot, 'tests/browser'),
		timeout: 360_000,
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
		projects: [
			{
				name: 'packaged-soundscaper',
				metadata: { productId: 'soundscaper' },
				testMatch: [SMOKE, PRODUCTION],
			},
			{
				name: 'packaged-framescaper',
				metadata: { productId: 'framescaper' },
				testMatch: [SMOKE, PREVIEW, KEYED],
			},
		],
	});
}

export default createNightlyPackagedMetricsConfig();
