/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDesktopSmokeConfiguration } from '../desktop/desktop-smoke.js';
import {
	DESKTOP_DIRECT_WAV_SMOKE_PREFIX,
	DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS,
} from '../desktop/direct-wav-smoke.js';
import {
	DIRECT_WAV_TARGET_PATHS,
	validDesktopDirectWavNativeEvidence,
	validDesktopDirectWavRendererResult,
} from './helpers/desktop-direct-wav-smoke-probe.js';
import {
	DIRECT_WAV_MODE,
	DIRECT_WAV_TOKEN,
	directWavArgv,
	encodePlan,
	flushAsync,
	probeFixture,
} from './helpers/desktop-smoke-probe-fixture.mjs';

test('desktop smoke configuration preserves the base artifact probe', () => {
	assert.deepEqual(parseDesktopSmokeConfiguration(['/opt/Soundscaper']), {
		mode: 'disabled',
		plan: null,
	});
	assert.deepEqual(parseDesktopSmokeConfiguration([
		'/opt/Soundscaper',
		'--soundscaper-smoke',
	]), {
		mode: 'artifact',
		plan: null,
	});
});

test('base artifact smoke remains did-finish-load driven', async () => {
	const fixture = probeFixture({ argv: ['/opt/Soundscaper', '--soundscaper-smoke'] });
	fixture.probe.attach(fixture.window);
	assert.equal(fixture.window.webContents.executions.length, 0);

	await fixture.window.webContents.emit('did-finish-load');
	await flushAsync();

	assert.equal(fixture.window.webContents.executions.length, 2);
	assert.deepEqual(fixture.exits, [0]);
	assert.equal(fixture.logs.length, 1);
	assert.match(fixture.logs[0], /^SOUNDSCAPER_DESKTOP_SMOKE /u);
	assert.equal(fixture.evidenceCalls.length, 0);
});

test('direct-WAV lifecycle resolves only smoke targets and emits bounded renderer and native evidence', async () => {
	const plan = {
		schemaVersion: 1,
		mode: DIRECT_WAV_MODE,
		productId: 'soundscaper',
		token: DIRECT_WAV_TOKEN,
	};
	const selections = [];
	const targetPaths = DIRECT_WAV_TARGET_PATHS;
	const fixture = probeFixture({
		argv: [
			'/opt/Soundscaper',
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${DIRECT_WAV_MODE}`,
			`--soundscaper-smoke-plan=${encodePlan(plan)}`,
			'--soundscaper-smoke-app-data=/private/smoke-root',
		],
		executionResult: validDesktopDirectWavRendererResult(),
		directWavTargetHarness: {
			async resolveSavePath(choice) {
				selections.push(choice.purpose);
				return targetPaths[selections.length - 1] ?? null;
			},
			async evidence() {
				return validDesktopDirectWavNativeEvidence({ selectionPurposes: selections });
			},
		},
	});

	fixture.probe.attach(fixture.window);
	assert.equal(DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS, 1_800_000);
	assert.deepEqual(fixture.scheduledDelays, [DESKTOP_DIRECT_WAV_SMOKE_TIMEOUT_MS]);
	assert.equal(await fixture.probe.resolveSavePath({ purpose: 'audio-pcm-mix' }), targetPaths[0]);
	assert.equal(await fixture.probe.resolveSavePath({ purpose: 'audio-pcm-mix' }), targetPaths[1]);
	assert.equal(await fixture.probe.resolveSavePath({ purpose: 'audio-pcm-mix' }), targetPaths[2]);
	assert.equal(await fixture.probe.resolveSavePath({ purpose: 'audio-pcm-mix' }), targetPaths[3]);
	assert.equal(await fixture.probe.resolveSavePath({ purpose: 'audio-pcm-mix' }), targetPaths[4]);
	await fixture.probe.rendererReady();

	assert.deepEqual(fixture.exits, [0]);
	assert.deepEqual(fixture.window.webContents.userGestures, [true]);
	assert.equal(fixture.errors.length, 0);
	assert.equal(fixture.logs.length, 1);
	assert.match(fixture.logs[0], new RegExp(`^${DESKTOP_DIRECT_WAV_SMOKE_PREFIX} `, 'u'));
	assert.deepEqual(JSON.parse(fixture.logs[0].slice(DESKTOP_DIRECT_WAV_SMOKE_PREFIX.length + 1)), {
		schemaVersion: 1,
		mode: DIRECT_WAV_MODE,
		productId: 'soundscaper',
		token: DIRECT_WAV_TOKEN,
		renderer: validDesktopDirectWavRendererResult(),
		native: validDesktopDirectWavNativeEvidence(),
	});
	assert.doesNotMatch(fixture.logs[0], /private\/smoke/u);
});

test('a direct-WAV watchdog timeout names the stage the renderer stalled on', async () => {
	const fixture = probeFixture({
		argv: directWavArgv(),
		executionResult: 'completed BW64 export',
		productId: 'soundscaper',
		directWavTargetHarness: {
			resolveSavePath: async () => '/private/smoke/completed.wav',
			evidence: async () => validDesktopDirectWavNativeEvidence(),
		},
	});
	fixture.probe.attach(fixture.window);
	assert.equal(fixture.scheduledCallbacks.length, 1);

	fixture.scheduledCallbacks[0]();
	await flushAsync();

	assert.equal(fixture.errors.length, 1);
	assert.match(fixture.errors[0], /timed out waiting for completed BW64 export/u);
	assert.deepEqual(fixture.exits, [2]);
	assert.match(fixture.window.webContents.executions.at(-1), /__scapeDirectWavSmokeStage/u);
});

test('a direct-WAV watchdog timeout stays unqualified when the stage marker is unreadable', async () => {
	const fixture = probeFixture({
		argv: directWavArgv(),
		executionError: new Error('renderer is unresponsive'),
		productId: 'soundscaper',
		directWavTargetHarness: {
			resolveSavePath: async () => '/private/smoke/completed.wav',
			evidence: async () => validDesktopDirectWavNativeEvidence(),
		},
	});
	fixture.probe.attach(fixture.window);

	fixture.scheduledCallbacks[0]();
	await flushAsync();

	assert.equal(fixture.errors.length, 1);
	assert.equal(fixture.errors[0], `${DESKTOP_DIRECT_WAV_SMOKE_PREFIX} timed out`);
	assert.deepEqual(fixture.exits, [2]);
});

test('direct-WAV lifecycle reports validation failures under its own bounded prefix', async () => {
	const plan = {
		schemaVersion: 1,
		mode: DIRECT_WAV_MODE,
		productId: 'soundscaper',
		token: DIRECT_WAV_TOKEN,
	};
	let evidenceCalls = 0;
	const fixture = probeFixture({
		argv: [
			'/opt/Soundscaper',
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${DIRECT_WAV_MODE}`,
			`--soundscaper-smoke-plan=${encodePlan(plan)}`,
			'--soundscaper-smoke-app-data=/private/smoke-root',
		],
		executionResult: validDesktopDirectWavRendererResult({ realtimeCount: 1 }),
		directWavTargetHarness: {
			resolveSavePath: async () => null,
			evidence: async () => {
				evidenceCalls += 1;
				return validDesktopDirectWavNativeEvidence();
			},
		},
	});
	fixture.probe.attach(fixture.window);

	await fixture.probe.rendererReady();

	assert.deepEqual(fixture.exits, [2]);
	assert.equal(fixture.logs.length, 0);
	assert.equal(fixture.errors.length, 1);
	assert.equal(evidenceCalls, 0);
	assert.match(fixture.errors[0], new RegExp(`^${DESKTOP_DIRECT_WAV_SMOKE_PREFIX} failed:`, 'u'));
});

test('desktop smoke preserves a cross-realm renderer rejection message', async () => {
	const plan = {
		schemaVersion: 1,
		mode: DIRECT_WAV_MODE,
		productId: 'soundscaper',
		token: DIRECT_WAV_TOKEN,
	};
	const fixture = probeFixture({
		argv: [
			'/opt/Soundscaper',
			'--soundscaper-smoke',
			`--soundscaper-smoke-mode=${DIRECT_WAV_MODE}`,
			`--soundscaper-smoke-plan=${encodePlan(plan)}`,
			'--soundscaper-smoke-app-data=/private/smoke-root',
		],
		executionError: Object.create(Object.freeze({
			name: 'Error',
			message: 'Renderer timing probe exposed its actual failure.',
		})),
		directWavTargetHarness: {
			resolveSavePath: async () => null,
			evidence: async () => validDesktopDirectWavNativeEvidence(),
		},
	});
	fixture.probe.attach(fixture.window);

	await fixture.probe.rendererReady();

	assert.deepEqual(fixture.exits, [2]);
	assert.deepEqual(fixture.errors, [
		`${DESKTOP_DIRECT_WAV_SMOKE_PREFIX} failed: Renderer timing probe exposed its actual failure.`,
	]);
});
