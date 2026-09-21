/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

const ENVIRONMENT_KEYS = [
	'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT',
	'SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT',
];

test('packaged coverage has a dedicated deterministic Playwright workload', async () => {
	const originalEnvironment = Object.fromEntries(
		ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
	);
	const payloadRoot = resolve('/tmp/soundscaper-nightly-packaged-coverage-payload');
	const runRoot = resolve('/tmp/soundscaper-nightly-packaged-coverage-run');
	try {
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT = payloadRoot;
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT = runRoot;
		const { createNightlyPackagedCoverageConfig } = await import(
			'../playwright.nightly-packaged-coverage.config.mjs?dedicated-packaged-coverage'
		);
		const config = createNightlyPackagedCoverageConfig(process.env);
		const projects = Object.fromEntries(config.projects.map((project) => [project.name, project]));

		assert.equal(config.testDir, resolve(payloadRoot, 'tests/browser'));
		assert.equal(config.outputDir, resolve(runRoot, 'e2e-coverage/packaged-runtime/test-results'));
		assert.equal(config.fullyParallel, false);
		assert.equal(config.failOnFlakyTests, true);
		assert.equal(config.retries, 0);
		assert.equal(config.workers, 1);
		assert.deepEqual(Object.keys(projects), [
			'packaged-coverage-soundscaper',
			'packaged-coverage-soundscaper-audio-devices',
			'packaged-coverage-framescaper',
		]);
		assert.deepEqual(projects['packaged-coverage-soundscaper'].metadata, {
			productId: 'soundscaper',
		});
		assert.deepEqual(projects['packaged-coverage-soundscaper'].testMatch, [
			'desktop-packaged-runtime-smoke.spec.js',
			'desktop-packaged-display-audio.spec.js',
			'audio-editor-m4-production-parity.spec.js',
		]);
		assert.deepEqual(
			projects['packaged-coverage-soundscaper-audio-devices'].metadata,
			{ productId: 'soundscaper', packagedAudioDeviceFixture: true },
		);
		assert.deepEqual(projects['packaged-coverage-soundscaper-audio-devices'].testMatch, [
			'desktop-packaged-audio-io.spec.js',
		]);
		assert.deepEqual(projects['packaged-coverage-framescaper'].metadata, {
			productId: 'framescaper',
		});
		assert.deepEqual(projects['packaged-coverage-framescaper'].testMatch, [
			'desktop-packaged-runtime-smoke.spec.js',
			'audio-editor-m4b2-keyframe-parity.spec.js',
		]);
		assert.deepEqual(config.reporter, [
			['list'],
			['html', {
				outputFolder: resolve(runRoot, 'e2e-coverage/packaged-runtime/playwright-report'),
				open: 'never',
			}],
			['json', {
				outputFile: resolve(runRoot, 'e2e-coverage/packaged-runtime/results.json'),
			}],
			['junit', {
				outputFile: resolve(runRoot, 'e2e-coverage/packaged-runtime/junit.xml'),
			}],
		]);
	} finally {
		for (const [key, value] of Object.entries(originalEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test('packaged coverage rejects relative launcher paths', async () => {
	const originalEnvironment = Object.fromEntries(
		ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
	);
	try {
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT = resolve('/tmp/payload');
		process.env.SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT = resolve('/tmp/run');
		const { createNightlyPackagedCoverageConfig } = await import(
			'../playwright.nightly-packaged-coverage.config.mjs?reject-relative-paths'
		);
		assert.throws(() => createNightlyPackagedCoverageConfig({
			SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: 'relative/payload',
			SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: resolve('/tmp/run'),
		}), /absolute path/u);
	} finally {
		for (const [key, value] of Object.entries(originalEnvironment)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
