/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperWebVcrController } from '../src/common/editor/controller/framescaper-web-vcr-controller.ts';
import type { WebVcrSnapshot } from '../src/common/editor/web-vcr-domain.ts';

test('recovery cleanup closes locally when desktop guest disposal fails', async () => {
	const fixture = recoveryHarness({ rejectDispose: true });
	const { calls, controller, state, warnings } = fixture;

	await controller.initialize();
	await controller.actions.activate();
	state.phase = 'recovery';
	state.sources = [
		{ sourceId: 'web-vcr:opaque-source', role: 'display' },
		{ sourceId: 'web-vcr:page-audio', role: 'system-audio' },
	];
	controller.synchronizeCapture();
	await tick();
	state.phase = 'inactive';
	state.sources = [];
	controller.synchronizeCapture();
	await tick();

	assert.equal(controller.snapshot.modeActive, false);
	assert.equal(calls.includes('dispose'), true);
	assert.equal(calls.includes('select:devices'), true);
	assert.equal(warnings.includes('dispose rejected'), true);
});

test('closing a failed Web VCR preview resets capture before selecting devices', async () => {
	const { calls, controller, state } = recoveryHarness();
	await controller.initialize();
	await controller.actions.activate();
	state.phase = 'failed';

	await controller.actions.close();

	assert.ok(calls.indexOf('reset-failure') < calls.indexOf('select:devices'));
	assert.equal(controller.snapshot.modeActive, false);
});

test('recovery cleanup retries after a new capture starts during guest disposal', async () => {
	const disposal = deferred<void>();
	const { calls, controller, state, warnings } = recoveryHarness({ disposeGate: disposal.promise });
	await controller.initialize();
	await controller.actions.activate();
	state.phase = 'recovery';
	state.sources = recoverySources();
	controller.synchronizeCapture();
	await tick();
	state.phase = 'inactive';
	state.sources = [];
	controller.synchronizeCapture();
	await tick();
	state.phase = 'permission-pending';
	disposal.resolve();
	await tick();

	assert.equal(controller.snapshot.modeActive, true);
	assert.equal(calls.includes('select:devices'), false);
	assert.deepEqual(warnings, []);

	state.phase = 'inactive';
	controller.synchronizeCapture();
	await tick();
	assert.equal(controller.snapshot.modeActive, false);
	assert.equal(calls.includes('select:devices'), true);
});

function recoveryHarness(options: Readonly<{
	rejectDispose?: boolean;
	disposeGate?: Promise<void>;
}> = {}) {
	const calls: string[] = [];
	const warnings: string[] = [];
	const state = {
		phase: 'inactive', sources: [] as { sourceId: string; role: string }[],
		setupDefaults: { destination: 'project', countdownMs: 0 },
	};
	const capture = {
		state,
		get snapshot() { return state; },
		actions: {
			async requestPreview() { state.phase = 'previewing'; },
			async release() { state.phase = 'inactive'; state.sources = []; },
			resetFailure() { calls.push('reset-failure'); state.phase = 'inactive'; },
		},
	};
	const controller = createFramescaperWebVcrController({
		enabled: true,
		bridge: {
			async handshake() {
				return { version: 1, capability: { status: 'available', resolutions: ['1080p'] }, captureGrantTtlMs: 10_000 };
			},
			async open() { return hostSnapshot(); },
			async setCaptureState() { return true; },
			subscribe() { return () => undefined; },
			async dispose() {
				calls.push('dispose');
				await options.disposeGate;
				if (options.rejectDispose) throw new Error('dispose rejected');
			},
		} as never,
		getCapture: () => capture as never,
		adapter: {
			select(id) {
				if (id === 'devices' && state.phase !== 'inactive') throw new Error('capture is active');
				calls.push(`select:${id}`);
			},
			freezeCrop() {},
		},
		cropRuntimeAvailable: true,
		showPanel() {},
		hidePanel() {},
		onWarning(error) { warnings.push(error instanceof Error ? error.message : String(error)); },
		startAdmission: { begin() { throw new Error('Recording admission is not used in this test.'); } },
	});
	return { calls, controller, state, warnings };
}

function recoverySources(): { sourceId: string; role: string }[] {
	return [
		{ sourceId: 'web-vcr:opaque-source', role: 'display' },
		{ sourceId: 'web-vcr:page-audio', role: 'system-audio' },
	];
}

function hostSnapshot(): Readonly<WebVcrSnapshot> {
	return {
		version: 1, sessionId: 'a'.repeat(32), generation: 1, phase: 'ready',
		capability: { status: 'available', resolutions: ['1080p'] }, resolution: '1080p',
		aspect: 'free', crop: { x: 0, y: 0, width: 1, height: 1 }, autoCrop: false,
		monitorMuted: false, autoStop: false, visible: true, targetEndedRecordingToken: null,
		captureSurface: { width: 1_920, height: 1_080 }, outputSize: { width: 1_920, height: 1_080 },
		metrics: null, failure: null,
		navigation: {
			generation: 1, url: 'https://example.test/', canGoBack: false,
			canGoForward: false, isLoading: false,
		},
		target: null,
	};
}

async function tick(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}
