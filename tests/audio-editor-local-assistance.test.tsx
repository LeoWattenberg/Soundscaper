/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ASSISTANCE_OPERATIONS } from '../src/common/editor/assistance/operation.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import {
	resolveLocalAssistanceBridge,
	type LocalAssistanceBridge,
} from '../src/common/editor/ui/local-assistance-bridge.ts';
import { createLocalAssistanceMenuItems } from '../src/common/editor/ui/local-assistance-menu.ts';
import {
	type LocalAssistanceSelectedMediaPreparationPort,
} from '../src/common/editor/ui/local-assistance-preparation.ts';
import {
	createLocalAssistanceSessionStore,
	type LocalAssistanceSnapshot,
} from '../src/common/editor/ui/local-assistance-session-store.ts';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import {
	LocalAssistanceDialogView,
} from '../src/common/editor/ui/dialogs/LocalAssistanceDialog.tsx';

const JOB_ID = 'a'.repeat(40);
const INPUT_CLAIM_ID = 'b'.repeat(40);
const OUTPUT_CLAIM_ID = 'c'.repeat(40);
const INPUT_SHA256 = '6ed8919ce20490a5e3ad8630a4fab69475297abd07db73918dd5f36fcfaeb11b';
const OUTPUT_SHA256 = 'f6a214f7a5fcda0c2cee9660b7fc29f5649e3c68aad48e20e950137c98913a68';
const MODEL_SHA256 = 'f'.repeat(64);

const FENCE = Object.freeze({
	projectId: 'project-1', schemaVersion: 30, revision: 2, sequenceId: 'sequence-1',
	occurrenceIds: Object.freeze(['occurrence-1']), sourceId: 'source-1',
	sourceSha256: '1'.repeat(64), sourceStartFrame: 10, sourceEndFrame: 20,
	linkMembershipSha256: '2'.repeat(64), timingAuthoritySha256: '3'.repeat(64),
});

const MODEL = Object.freeze({
	modelId: 'speech-model', version: '1.2.3', task: 'speech-recognition',
	artifactSha256s: Object.freeze([MODEL_SHA256]),
});

const INVENTORY = Object.freeze({
	sources: Object.freeze([Object.freeze({
		sourceId: 'source-1', label: 'Interview selection', mediaKind: 'audio' as const,
		operations: Object.freeze(['speech-recognition' as const]),
	})]),
});

function prepared(inputBody = new Blob(['audio'], { type: 'audio/wav' })) {
	return Object.freeze({
		sourceId: 'source-1', operation: 'speech-recognition' as const, selectionFence: FENCE,
		inputs: Object.freeze([Object.freeze({ role: 'audio' as const,
			mediaType: 'audio/wav', bytes: inputBody })]),
		outputs: Object.freeze([Object.freeze({ role: 'transcript' as const,
			mediaType: 'application/vnd.soundscaper.transcript+json', maximumByteLength: 4096 })]),
	});
}

function preparationFixture(body?: Blob): LocalAssistanceSelectedMediaPreparationPort {
	return Object.freeze({
		listSelectedMedia: async () => INVENTORY,
		prepareSelectedMedia: async () => prepared(body),
	});
}

interface RawLocalAssistanceApi {
	models(): Promise<unknown>;
	createJob(): Promise<unknown>;
	stageInput(request: Readonly<Record<string, unknown>>): Promise<unknown>;
	reserveOutput(request: Readonly<Record<string, unknown>>): Promise<unknown>;
	run(request?: unknown): Promise<unknown>;
	cancel(jobId?: unknown): Promise<unknown>;
	readOutput(request?: unknown): Promise<unknown>;
	release(jobId?: unknown): Promise<unknown>;
	onProgress(listener: (value: unknown) => void): () => void;
}

function rawBridgeFixture(outputBody = new Blob(['result'], {
	type: 'application/vnd.soundscaper.transcript+json',
})) {
	const calls: string[] = [];
	let progress: ((value: unknown) => void) | null = null;
	const api: RawLocalAssistanceApi = {
		models: async () => {
			calls.push('models');
			return [MODEL];
		},
		createJob: async () => {
			calls.push('create');
			return { contractVersion: 1, jobId: JOB_ID };
		},
		stageInput: async (request: Readonly<Record<string, unknown>>) => {
			calls.push(`stage:${request.role}`);
			assert.ok(request.bytes instanceof Blob);
			assert.equal(request.sha256, INPUT_SHA256);
			assert.equal('byteLength' in request, false);
			return { claimVersion: 1, claimId: INPUT_CLAIM_ID, jobId: JOB_ID,
				role: 'audio', mediaType: 'audio/wav', byteLength: 5, sha256: INPUT_SHA256 };
		},
		reserveOutput: async (request: Readonly<Record<string, unknown>>) => {
			calls.push(`reserve:${request.role}`);
			return { claimVersion: 1, claimId: OUTPUT_CLAIM_ID, jobId: JOB_ID,
				role: 'transcript', mediaType: 'application/vnd.soundscaper.transcript+json',
				maximumByteLength: 4096 };
		},
		run: async () => {
			calls.push('run');
			return { contractVersion: 1, jobId: JOB_ID, operation: 'speech-recognition',
				outcome: 'completed', result: { contractVersion: 1, jobId: JOB_ID,
					operation: 'speech-recognition', outputs: [{ claimVersion: 1,
						claimId: OUTPUT_CLAIM_ID, jobId: JOB_ID, role: 'transcript',
						mediaType: 'application/vnd.soundscaper.transcript+json',
						byteLength: outputBody.size, sha256: OUTPUT_SHA256 }] } };
		},
		cancel: async () => {
			calls.push('cancel');
			return { contractVersion: 1, jobId: JOB_ID, outcome: 'cancelled' };
		},
		readOutput: async () => {
			calls.push('read');
			return outputBody;
		},
		release: async () => {
			calls.push('release');
			return true;
		},
		onProgress: (listener: (value: unknown) => void) => {
			progress = listener;
			return () => { progress = null; };
		},
	};
	return { api, calls, emit(value: unknown) { progress?.(value); } };
}

test('the renderer admits only the exact nested pathless local-assistance bridge', () => {
	const fixture = rawBridgeFixture();
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	assert.notEqual(bridge, fixture.api);
	assert.equal(resolveLocalAssistanceBridge(fixture.api), null);
	assert.equal(resolveLocalAssistanceBridge({ localAssistance: {
		...fixture.api, readOutput: undefined,
	} }), null);
	assert.equal(resolveLocalAssistanceBridge({ localAssistance: {
		...fixture.api, filesystemPath: () => '/tmp/output',
	} }), null);
});

test('the session never runs implicitly and requires explicit source, operation, model, and consent', async () => {
	const fixture = rawBridgeFixture();
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	const store = createLocalAssistanceSessionStore({ bridge, preparation: preparationFixture() });
	const disconnect = store.connect();
	await store.load();

	assert.deepEqual(fixture.calls, ['models']);
	assert.equal(store.getSnapshot().canRun, false);
	store.selectSource('source-1');
	store.selectOperation('speech-recognition');
	store.selectModel('speech-model');
	assert.equal(store.getSnapshot().canRun, false);
	store.setConsent(true);
	assert.equal(store.getSnapshot().canRun, true);
	store.selectModel('speech-model');
	assert.equal(store.getSnapshot().consent, false);
	assert.equal(store.getSnapshot().canRun, false);
	disconnect();
});

test('one explicit run stages Blob input, validates output, and releases custody', async () => {
	const fixture = rawBridgeFixture();
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	const store = createLocalAssistanceSessionStore({ bridge, preparation: preparationFixture() });
	store.connect();
	await store.load();
	store.selectSource('source-1');
	store.selectOperation('speech-recognition');
	store.selectModel('speech-model');
	store.setConsent(true);
	await store.run();

	assert.deepEqual(fixture.calls, [
		'models', 'create', 'stage:audio', 'reserve:transcript', 'run', 'read', 'release',
	]);
	const snapshot = store.getSnapshot();
	assert.equal(snapshot.phase, 'completed');
	assert.equal(snapshot.result?.outputs[0]?.bytes instanceof Blob, true);
	assert.equal(snapshot.canReview, true);
	assert.equal(snapshot.canAccept, false);
});

test('unavailable operation outcomes remain typed and still release custody', async () => {
	const fixture = rawBridgeFixture();
	fixture.api.run = async () => {
		fixture.calls.push('run');
		return { contractVersion: 1, jobId: JOB_ID, operation: 'speech-recognition',
			outcome: 'unavailable', reason: 'adapter-unavailable' };
	};
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	const store = selectedStore(bridge, preparationFixture());
	await store.run();

	assert.deepEqual(fixture.calls, ['models', 'create', 'stage:audio', 'reserve:transcript', 'run', 'release']);
	assert.equal(store.getSnapshot().phase, 'unavailable');
	assert.equal(store.getSnapshot().unavailableReason, 'adapter-unavailable');
	assert.equal(store.getSnapshot().canReview, false);
});

test('declining main-owned consent cancels execution and still releases custody', async () => {
	const fixture = rawBridgeFixture();
	fixture.api.run = async () => {
		fixture.calls.push('run');
		return { contractVersion: 1, jobId: JOB_ID, operation: 'speech-recognition',
			outcome: 'consent-declined' };
	};
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	const store = selectedStore(bridge, preparationFixture());
	await store.run();

	assert.deepEqual(fixture.calls, ['models', 'create', 'stage:audio', 'reserve:transcript', 'run', 'release']);
	assert.equal(store.getSnapshot().phase, 'cancelled');
	assert.equal(store.getSnapshot().canReview, false);
});

test('cancellation is explicit and release is attempted after the run quiesces', { timeout: 5_000 }, async () => {
	const fixture = rawBridgeFixture();
	let finish: ((value: unknown) => void) | null = null;
	let markStarted: (() => void) | null = null;
	const started = new Promise<void>((resolve) => { markStarted = resolve; });
	fixture.api.run = () => {
		fixture.calls.push('run');
		markStarted?.();
		return new Promise((resolve) => { finish = resolve; });
	};
	fixture.api.cancel = async () => {
		fixture.calls.push('cancel');
		finish?.({ contractVersion: 1, jobId: JOB_ID, operation: 'speech-recognition',
			outcome: 'unavailable', reason: 'adapter-unavailable' });
		return { contractVersion: 1, jobId: JOB_ID, outcome: 'cancelled' };
	};
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	const store = selectedStore(bridge, preparationFixture());
	const running = store.run();
	await started;
	assert.equal(fixture.calls.includes('run'), true);
	await store.cancel();
	await running;

	assert.equal(store.getSnapshot().phase, 'cancelled');
	assert.deepEqual(fixture.calls.slice(-2), ['cancel', 'release']);
});

test('missing selected-media preparation is truthful and never invents bytes', async () => {
	const fixture = rawBridgeFixture();
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	const store = createLocalAssistanceSessionStore({ bridge, preparation: null });
	await store.load();
	assert.equal(store.getSnapshot().phase, 'selection-required');
	assert.equal(store.getSnapshot().unavailableReason, 'selection-required');
	assert.deepEqual(fixture.calls, []);
});

test('Local Assistance menu is desktop- and capability-gated and survives the Framescaper filter', () => {
	const opened: string[] = [];
	const desktop = createLocalAssistanceMenuItems({ desktopAvailable: true,
		capabilityActive: true, copy: ENGLISH_COPY }, { open: () => opened.push('opened') });
	assert.equal(desktop[0]?.id, 'local-assistance');
	assert.equal(desktop[0]?.label, 'Local Assistance…');
	desktop[0]?.onClick();
	assert.deepEqual(opened, ['opened']);
	assert.deepEqual(createLocalAssistanceMenuItems({ desktopAvailable: false,
		capabilityActive: true, copy: ENGLISH_COPY }, { open: () => undefined }), []);
	assert.deepEqual(createLocalAssistanceMenuItems({ desktopAvailable: true,
		capabilityActive: false, copy: ENGLISH_COPY }, { open: () => undefined }), []);

	const filtered = filterProductMenus([{ id: 'analyze', items: desktop }], {
		audioAnalysis: false, audioGenerators: true, audioEffects: true,
		audioMacros: true, audioRecording: true, videoMotionTracking: false,
		assistanceAssets: true,
	}, 'framescaper');
	assert.equal(filtered[0]?.items[0]?.id, 'local-assistance');
});

test('the focused EN/DE catalog and dialog expose all operations without an implicit accept path', () => {
	assert.equal(ENGLISH_COPY.localAssistance, 'Local Assistance');
	assert.equal(GERMAN_COPY.localAssistance, 'Lokale Assistenz');
	const snapshot: LocalAssistanceSnapshot = Object.freeze({
		phase: 'ready', sources: INVENTORY.sources, models: Object.freeze([MODEL]),
		selectedSourceId: 'source-1', selectedOperation: null, selectedModelId: null, consent: false,
		progress: null, result: null, unavailableReason: null, error: null,
		canRun: false, canCancel: false, canReview: false, canAccept: false,
	});
	const markup = renderToStaticMarkup(<LocalAssistanceDialogView
		copy={ENGLISH_COPY} snapshot={snapshot} onClose={() => undefined}
		onSelectSource={() => undefined} onSelectOperation={() => undefined}
		onSelectModel={() => undefined} onConsentChange={() => undefined}
		onRun={() => undefined} onCancel={() => undefined}
		onReview={() => undefined} onAccept={() => undefined}
	/>);
	assert.equal(ASSISTANCE_OPERATIONS.length, 15);
	for (const operation of ASSISTANCE_OPERATIONS) assert.match(markup, new RegExp(operation, 'u'));
	assert.equal(markup.match(/<option value="" disabled=""[^>]*>Choose<\/option>/gu)?.length, 3);
	assert.match(markup, /I consent to local processing/u);
	assert.match(markup, /Review result[^<]*<\/button>/u);
	assert.match(markup, /Accept proposal[^<]*<\/button>/u);
	assert.match(markup, /disabled=""[^>]*>Review result|>Review result<\/button>/u);
});

function selectedStore(
	bridge: LocalAssistanceBridge,
	preparation: LocalAssistanceSelectedMediaPreparationPort,
) {
	const store = createLocalAssistanceSessionStore({ bridge, preparation });
	store.connect();
	return {
		...store,
		async run() {
			await store.load();
			store.selectSource('source-1');
			store.selectOperation('speech-recognition');
			store.selectModel('speech-model');
			store.setConsent(true);
			await store.run();
		},
	};
}
