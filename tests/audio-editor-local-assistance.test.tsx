/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	resolveLocalAssistanceBridge,
	type LocalAssistanceBridge,
} from '../src/common/editor/ui/local-assistance-bridge.ts';
import {
	localAssistanceModelTaskSlots,
	type LocalAssistanceSelectedMediaPreparationPort,
} from '../src/common/editor/ui/local-assistance-preparation.ts';
import {
	createLocalAssistanceSessionStore,
	type LocalAssistanceSnapshot,
} from '../src/common/editor/ui/local-assistance-session-store.ts';
import {
	LocalAssistanceDialogView,
} from '../src/common/editor/ui/dialogs/LocalAssistanceDialog.tsx';
import {
	diarizationFixture,
	EMBEDDING_MODEL,
	FENCE,
	JOB_ID,
	OUTPUT_CLAIM_ID,
	MODEL,
	OUTPUT_SHA256,
	preparationFixture,
	rawBridgeFixture,
	selectedStore,
	SECOND_SEGMENTATION_MODEL,
	SEGMENTATION_MODEL,
	TRANSCRIPT_BODY,
} from './helpers/local-assistance-fixtures.ts';
import { encodeWav } from '../src/common/editor/wav.js';

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

test('speaker diarization is unavailable without both installed model tasks', async () => {
	for (const models of [
		Object.freeze([SEGMENTATION_MODEL]), Object.freeze([EMBEDDING_MODEL]),
	]) {
		const fixture = diarizationFixture(models);
		const store = createLocalAssistanceSessionStore(fixture);
		await store.load();
		store.selectSource('source-1');
		store.selectOperation('speaker-diarization');
		assert.equal(store.getSnapshot().phase, 'unavailable');
		assert.equal(store.getSnapshot().unavailableReason, 'no-compatible-model');
		assert.deepEqual(store.getSnapshot().selectedModelIds, []);
	}
});

test('speaker diarization submits one exact binding per task independent of selection order', async () => {
	const cases = Object.freeze([
		Object.freeze({
			selection: Object.freeze([EMBEDDING_MODEL.modelId, SEGMENTATION_MODEL.modelId]),
			expectedSegmentation: SEGMENTATION_MODEL,
		}),
		Object.freeze({
			selection: Object.freeze([
				SEGMENTATION_MODEL.modelId, EMBEDDING_MODEL.modelId,
				SECOND_SEGMENTATION_MODEL.modelId,
			]),
			expectedSegmentation: SECOND_SEGMENTATION_MODEL,
		}),
	]);
	for (const { selection, expectedSegmentation } of cases) {
		const fixture = diarizationFixture();
		const store = createLocalAssistanceSessionStore(fixture);
		await store.load();
		store.selectSource('source-1');
		store.selectOperation('speaker-diarization');
		for (const modelId of selection) store.selectModel(modelId);
		assert.deepEqual(store.getSnapshot().selectedModelIds, [
			expectedSegmentation.modelId, EMBEDDING_MODEL.modelId,
		]);
		assert.equal(store.getSnapshot().canRun, false);
		store.setConsent(true);
		assert.equal(store.getSnapshot().canRun, true);
		await store.run();
		assert.deepEqual(fixture.requests[0]?.models, [
			{
				modelId: expectedSegmentation.modelId, version: expectedSegmentation.version,
				artifactSha256s: expectedSegmentation.artifactSha256s,
			},
			{
				modelId: EMBEDDING_MODEL.modelId, version: EMBEDDING_MODEL.version,
				artifactSha256s: EMBEDDING_MODEL.artifactSha256s,
			},
		]);
	}
});

test('speaker diarization renders one installed-model selector per required task', () => {
	const snapshot: LocalAssistanceSnapshot = Object.freeze({
		phase: 'ready',
		sources: Object.freeze([Object.freeze({
			sourceId: 'source-1', label: 'Interview selection', mediaKind: 'audio' as const,
			operations: Object.freeze(['speaker-diarization' as const]),
		})]),
		models: Object.freeze([EMBEDDING_MODEL, SECOND_SEGMENTATION_MODEL, SEGMENTATION_MODEL]),
		selectedSourceId: 'source-1', selectedOperation: 'speaker-diarization',
		selectedModelIds: Object.freeze([SEGMENTATION_MODEL.modelId, EMBEDDING_MODEL.modelId]),
		consent: false, progress: null, result: null, unavailableReason: null, error: null,
		canRun: false, canCancel: false, canReview: false, canAccept: false,
	});
	const markup = renderToStaticMarkup(<LocalAssistanceDialogView
		copy={ENGLISH_COPY} snapshot={snapshot} onClose={() => undefined}
		onSelectSource={() => undefined} onSelectOperation={() => undefined}
		onSelectModel={() => undefined} onConsentChange={() => undefined}
		onRun={() => undefined} onCancel={() => undefined}
		onReview={() => undefined} onAccept={() => undefined}
	/>);
	assert.match(markup, /Installed compatible model · speaker-segmentation/u);
	assert.match(markup, /Installed compatible model · speaker-embedding/u);
	assert.match(markup, /<option value="segmentation-model" selected="">/u);
	assert.match(markup, /<option value="embedding-model" selected="">/u);
	assert.equal(markup.match(/<select/gu)?.length, 4);
});

test('preparation represents shot detection as a zero-model operation contract', () =>
	assert.deepEqual(localAssistanceModelTaskSlots('shot-detection'), []));

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
	assert.equal(snapshot.result?.outputs[0]?.review.kind, 'transcript');
	assert.equal(snapshot.result?.outputs[0]?.review.segments[0]?.text, 'Hello from the interview.');
	assert.equal(snapshot.canReview, true);
	assert.equal(snapshot.canAccept, false);
	const markup = renderToStaticMarkup(<LocalAssistanceDialogView
		copy={ENGLISH_COPY} snapshot={snapshot} reviewOpen onClose={() => undefined}
		onSelectSource={() => undefined} onSelectOperation={() => undefined}
		onSelectModel={() => undefined} onConsentChange={() => undefined}
		onRun={() => undefined} onCancel={() => undefined}
		onReview={() => undefined} onAccept={() => undefined}
	/>);
	assert.match(markup, /Hello from the interview\./u);
});

test('enhancement review derives exact output authority from its conformed staged input', async () => {
	const inputBytes = encodeWav([
		Float32Array.of(0.1, 0.2, 0.3), Float32Array.of(-0.1, -0.2, -0.3),
	], { sampleRate: 48_000, bitDepth: 32, float: true, dither: false });
	const input = new Blob([inputBytes], { type: 'audio/wav' });
	const output = new Blob([inputBytes], { type: 'audio/wav' });
	const model = Object.freeze({
		modelId: 'enhancer', version: '1.0.0', task: 'speech-enhancement',
		artifactSha256s: Object.freeze(['e'.repeat(64)]),
	});
	const bridge: LocalAssistanceBridge = Object.freeze({
		models: async () => Object.freeze([model]),
		createJob: async () => Object.freeze({ contractVersion: 1 as const, jobId: JOB_ID }),
		stageInput: async (request) => Object.freeze({
			claimVersion: 1 as const, claimId: 'd'.repeat(40), jobId: request.jobId,
			role: request.role, mediaType: request.mediaType, byteLength: request.byteLength,
			sha256: 'd'.repeat(64),
		}),
		reserveOutput: async (request) => Object.freeze({
			claimVersion: 1 as const, claimId: OUTPUT_CLAIM_ID, jobId: request.jobId,
			role: request.role, mediaType: request.mediaType,
			maximumByteLength: request.maximumByteLength,
		}),
		run: async (request) => Object.freeze({
			contractVersion: 1 as const, jobId: request.jobId,
			operation: 'speech-enhancement' as const, outcome: 'completed' as const,
			result: Object.freeze({ contractVersion: 1 as const, jobId: request.jobId,
				operation: 'speech-enhancement' as const, outputs: Object.freeze([Object.freeze({
					claimVersion: 1 as const, claimId: OUTPUT_CLAIM_ID, jobId: request.jobId,
					role: 'enhanced-audio' as const, mediaType: 'audio/wav',
					byteLength: output.size, sha256: OUTPUT_SHA256,
				})]) }),
		}),
		cancel: async (jobId) => Object.freeze({
			contractVersion: 1 as const, jobId, outcome: 'not-active' as const,
		}),
		readOutput: async () => output,
		release: async () => true,
		onProgress: () => () => undefined,
	});
	const preparation: LocalAssistanceSelectedMediaPreparationPort = Object.freeze({
		listSelectedMedia: async () => Object.freeze({ sources: Object.freeze([Object.freeze({
			sourceId: 'source-1', label: 'Dialogue', mediaKind: 'audio' as const,
			operations: Object.freeze(['speech-enhancement' as const]),
		})]) }),
		prepareSelectedMedia: async () => Object.freeze({
			sourceId: 'source-1', operation: 'speech-enhancement' as const, selectionFence: FENCE,
			inputs: Object.freeze([Object.freeze({ role: 'audio' as const,
				mediaType: 'audio/wav', bytes: input })]),
			outputs: Object.freeze([Object.freeze({ role: 'enhanced-audio' as const,
				mediaType: 'audio/wav', maximumByteLength: 4096 })]),
		}),
	});
	const store = createLocalAssistanceSessionStore({ bridge, preparation });
	await store.load();
	store.selectSource('source-1');
	store.selectOperation('speech-enhancement');
	store.selectModel('enhancer');
	store.setConsent(true);
	await store.run();
	assert.deepEqual(store.getSnapshot().result?.outputs[0]?.review, {
		kind: 'audio-wave', role: 'enhanced-audio', sampleRate: 48_000,
		channelCount: 2, frameCount: 3, sampleFormat: 'float32',
	});
});

test('reviewed speech output enables one explicit controller-owned acceptance', async () => {
	const fixture = rawBridgeFixture();
	const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
	assert.ok(bridge);
	const accepted: unknown[] = [];
	const store = selectedStore(bridge, preparationFixture(undefined, async (request) => {
		accepted.push(request);
	}));
	await store.run();
	const reviewable = store.getSnapshot();
	assert.equal(reviewable.canAccept, true);
	const view = (reviewOpen: boolean) => renderToStaticMarkup(<LocalAssistanceDialogView
		copy={ENGLISH_COPY} snapshot={reviewable} reviewOpen={reviewOpen} onClose={() => undefined}
		onSelectSource={() => undefined} onSelectOperation={() => undefined}
		onSelectModel={() => undefined} onConsentChange={() => undefined}
		onRun={() => undefined} onCancel={() => undefined}
		onReview={() => undefined} onAccept={() => undefined}
	/>);
	assert.match(view(false), /<button type="button" disabled="">Accept proposal<\/button>/u);
	assert.match(view(true), /<button type="button">Accept proposal<\/button>/u);
	await store.accept();
	assert.equal(store.getSnapshot().phase, 'accepted');
	assert.equal(store.getSnapshot().canAccept, false);
	assert.deepEqual(accepted, [{
		sourceId: 'source-1', operation: 'speech-recognition', selectionFence: FENCE,
		models: [MODEL],
		outputs: [{
			claim: {
				claimVersion: 1, claimId: OUTPUT_CLAIM_ID, jobId: JOB_ID, role: 'transcript',
				mediaType: 'application/vnd.soundscaper.transcript+json',
				byteLength: new Blob([TRANSCRIPT_BODY]).size, sha256: OUTPUT_SHA256,
			},
			review: {
				kind: 'transcript', language: 'en', segments: [{
					startSeconds: 0, endSeconds: 1.25, text: 'Hello from the interview.',
					words: [], speaker: null,
				}],
			},
		}],
	}]);
});

test('invalid transcript JSON and schema are refused before review', async () => {
	for (const [body, sha256] of [
		['not json', '7ccfa1fbf3940e6f0c0375d87c0f9235a50514e14cb427bdfaf5077987b26ccf'],
		[JSON.stringify({ language: 'en', segments: [{ startSeconds: 0, endSeconds: 1 }] }),
			'95d33cf2f510efffc877bf3b3f56534d51fd3563216db6626594229ffadd35cc'],
	] as const) {
		const fixture = rawBridgeFixture(new Blob([body], {
			type: 'application/vnd.soundscaper.transcript+json',
		}), sha256);
		const bridge = resolveLocalAssistanceBridge({ localAssistance: fixture.api });
		assert.ok(bridge);
		const store = selectedStore(bridge, preparationFixture());
		await store.run();
		assert.equal(store.getSnapshot().phase, 'error');
		assert.equal(store.getSnapshot().result, null);
		assert.equal(store.getSnapshot().canReview, false);
	}
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
