/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperWebVcrController } from '../src/common/editor/controller/framescaper-web-vcr-controller.ts';
import type { WebVcrSnapshot } from '../src/common/editor/web-vcr-domain.ts';

test('recovery cleanup closes locally when desktop guest disposal fails', async () => {
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
			async dispose() { calls.push('dispose'); throw new Error('dispose rejected'); },
		} as never,
		getCapture: () => capture as never,
		adapter: {
			select(id) { calls.push(`select:${id}`); },
			freezeCrop() {},
		},
		cropRuntimeAvailable: true,
		showPanel() {},
		hidePanel() {},
		onWarning(error) { warnings.push(error instanceof Error ? error.message : String(error)); },
		startAdmission: { begin() { throw new Error('Recording admission is not used in this test.'); } },
	});

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
