/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const SMOKE = 'desktop-packaged-runtime-smoke.spec.js';
const AUDIO_IO = 'desktop-packaged-audio-io.spec.js';
const DISPLAY_AUDIO = 'desktop-packaged-display-audio.spec.js';
const PRODUCTION = 'audio-editor-m4-production-parity.spec.js';
const KEYED = 'audio-editor-m4b2-keyframe-parity.spec.js';
const SOAK = 'audio-editor-soak-debug.spec.js';
const PACKAGED_SOAK = /(?:executes the current-host packaged operations|recovers a real persistent delivery job)/u;

export function createNightlyPackagedCoverageConfig(environment = process.env) {
	const payloadRoot = requiredRoot(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT');
	const runRoot = requiredRoot(environment, 'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT');
	const artifactRoot = resolve(runRoot, 'e2e-coverage/packaged-runtime');
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
				name: 'packaged-coverage-soundscaper',
				metadata: { productId: 'soundscaper' },
				testMatch: [SMOKE, DISPLAY_AUDIO, PRODUCTION],
			},
			{
				name: 'packaged-coverage-soundscaper-audio-devices',
				metadata: { productId: 'soundscaper', packagedAudioDeviceFixture: true },
				testMatch: [AUDIO_IO],
			},
			{
				name: 'packaged-coverage-soundscaper-soak',
				grep: PACKAGED_SOAK,
				testMatch: [SOAK],
			},
			{
				name: 'packaged-coverage-framescaper',
				metadata: { productId: 'framescaper' },
				testMatch: [SMOKE, KEYED],
			},
		],
	});
}

function requiredRoot(environment, key) {
	const value = environment[key];
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new Error(`${key} must be an absolute path.`);
	}
	return value;
}

export default createNightlyPackagedCoverageConfig();
