/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { LocalAssistanceBridge } from '../src/common/editor/assistance/local-assistance-bridge.ts';
import {
	localAssistanceModelCompatible,
	localAssistanceModelTaskSlots,
	type LocalAssistanceSelectedMediaPreparationPort,
} from '../src/common/editor/assistance/local-assistance-preparation.ts';
import {
	createLocalAssistanceSessionStore,
	type LocalAssistanceSnapshot,
} from '../src/common/editor/ui/local-assistance-session-store.ts';
import { LocalAssistanceDialogView } from '../src/common/editor/ui/dialogs/LocalAssistanceDialog.tsx';
import { FENCE, JOB_ID, OUTPUT_CLAIM_ID } from './helpers/local-assistance-fixtures.ts';

const TRANSNET_MODEL = Object.freeze({
	modelId: 'transnetv2', version: '1.0.0', task: 'shot-detection',
	artifactSha256s: Object.freeze(['a'.repeat(64)]),
});
const SUBSTITUTE_SHOT_MODEL = Object.freeze({
	modelId: 'substitute-shot-model', version: '1.0.0', task: 'shot-detection',
	artifactSha256s: Object.freeze(['b'.repeat(64)]),
});

test('Mark Cuts exposes Fast by default and Accurate only with an exact TransNet binding', async () => {
	assert.deepEqual(localAssistanceModelTaskSlots('shot-detection', 'fast'), []);
	assert.deepEqual(localAssistanceModelTaskSlots('shot-detection', 'accurate'), [['shot-detection']]);
	assert.equal(localAssistanceModelCompatible('shot-detection', TRANSNET_MODEL, 'accurate'), true);
	assert.equal(localAssistanceModelCompatible('shot-detection', SUBSTITUTE_SHOT_MODEL, 'accurate'), false);

	const fixture = shotDetectionFixture();
	const store = createLocalAssistanceSessionStore(fixture);
	await store.load();
	store.selectSource('source-1');
	store.selectOperation('shot-detection');
	assert.equal(store.getSnapshot().shotDetectionMode, 'fast');
	store.setConsent(true);
	assert.equal(store.getSnapshot().canRun, true, 'Fast is explicitly model-free');
	const fastMarkup = renderLocalAssistance(store.getSnapshot());
	assert.match(fastMarkup, /<legend>Mark Cuts mode<\/legend>/u);
	assert.match(fastMarkup, /type="radio" name="local-assistance-shot-mode" checked="" value="fast"/u);
	assert.match(fastMarkup, /Fast · model-free/u);
	assert.doesNotMatch(fastMarkup, /transnetv2 · 1\.0\.0/u);

	store.selectShotDetectionMode('accurate');
	assert.equal(store.getSnapshot().consent, false);
	assert.deepEqual(store.getSnapshot().selectedModelIds, []);
	assert.equal(store.getSnapshot().canRun, false);
	const accurateMarkup = renderLocalAssistance(store.getSnapshot());
	assert.match(accurateMarkup,
		/type="radio" name="local-assistance-shot-mode" checked="" value="accurate"/u);
	assert.match(accurateMarkup, /Accurate · TransNetV2/u);
	assert.match(accurateMarkup, /<option value="transnetv2">transnetv2 · 1\.0\.0<\/option>/u);
	assert.doesNotMatch(accurateMarkup, /substitute-shot-model/u);
	assert.throws(() => store.selectModel('substitute-shot-model'), /incompatible/iu);
	store.selectModel('transnetv2');
	store.setConsent(true);
	assert.equal(store.getSnapshot().canRun, true);

	const unavailable = createLocalAssistanceSessionStore(shotDetectionFixture({
		models: Object.freeze([SUBSTITUTE_SHOT_MODEL]),
	}));
	await unavailable.load();
	unavailable.selectSource('source-1');
	unavailable.selectOperation('shot-detection');
	unavailable.selectShotDetectionMode('accurate');
	assert.equal(unavailable.getSnapshot().phase, 'unavailable');
	assert.equal(unavailable.getSnapshot().unavailableReason, 'no-compatible-model');
});

test('Mark Cuts mode changes clear review state and runs propagate one exact mode without fallback', async () => {
	const fast = shotDetectionFixture({ detector: 'ffmpeg-scdet' });
	const fastStore = createLocalAssistanceSessionStore(fast);
	await fastStore.load();
	fastStore.selectSource('source-1');
	fastStore.selectOperation('shot-detection');
	fastStore.setConsent(true);
	await fastStore.run();
	assert.equal(fastStore.getSnapshot().phase, 'completed');
	assert.ok(fastStore.getSnapshot().result);
	assert.equal(fast.prepareRequests[0]?.shotDetectionMode, 'fast');
	assert.deepEqual(fast.runRequests[0]?.models, []);

	fastStore.selectShotDetectionMode('accurate');
	assert.equal(fastStore.getSnapshot().result, null);
	assert.equal(fastStore.getSnapshot().consent, false);
	assert.deepEqual(fastStore.getSnapshot().selectedModelIds, []);
	fastStore.selectModel('transnetv2');
	fastStore.setConsent(true);
	fastStore.selectShotDetectionMode('fast');
	assert.equal(fastStore.getSnapshot().consent, false);
	assert.deepEqual(fastStore.getSnapshot().selectedModelIds, []);

	const accurate = shotDetectionFixture({ detector: 'transnetv2' });
	const accurateStore = createLocalAssistanceSessionStore(accurate);
	await accurateStore.load();
	accurateStore.selectSource('source-1');
	accurateStore.selectOperation('shot-detection');
	accurateStore.selectShotDetectionMode('accurate');
	accurateStore.selectModel('transnetv2');
	accurateStore.setConsent(true);
	await accurateStore.run();
	assert.equal(accurateStore.getSnapshot().phase, 'completed');
	assert.equal(accurate.prepareRequests[0]?.shotDetectionMode, 'accurate');
	assert.deepEqual(accurate.runRequests[0]?.models, [{
		modelId: TRANSNET_MODEL.modelId, version: TRANSNET_MODEL.version,
		artifactSha256s: TRANSNET_MODEL.artifactSha256s,
	}]);

	for (const [selectedMode, preparedMode] of [
		['fast', 'accurate'], ['accurate', 'fast'],
	] as const) {
		const mismatch = shotDetectionFixture({ preparedMode,
			detector: selectedMode === 'fast' ? 'ffmpeg-scdet' : 'transnetv2' });
		const store = await selectedShotStore(mismatch, selectedMode);
		await store.run();
		assert.equal(store.getSnapshot().phase, 'error');
		assert.deepEqual(mismatch.runRequests, [], 'an opposite-mode preparation cannot reach inference');
	}

	for (const [selectedMode, detector] of [
		['fast', 'transnetv2'], ['accurate', 'ffmpeg-scdet'],
	] as const) {
		const mismatch = shotDetectionFixture({ detector });
		const store = await selectedShotStore(mismatch, selectedMode);
		await store.run();
		assert.equal(store.getSnapshot().phase, 'error');
		assert.equal(store.getSnapshot().result, null,
			'an opposite detector result cannot silently substitute for the selected mode');
	}
	const omitted = shotDetectionFixture({ omitPreparedMode: true });
	const omittedStore = await selectedShotStore(omitted, 'fast');
	await omittedStore.run();
	assert.equal(omittedStore.getSnapshot().phase, 'error');
	assert.deepEqual(omitted.runRequests, [], 'an explicit Fast request also requires an exact mode echo');
});

async function selectedShotStore(
	fixture: ReturnType<typeof shotDetectionFixture>,
	mode: 'fast' | 'accurate',
): Promise<ReturnType<typeof createLocalAssistanceSessionStore>> {
	const store = createLocalAssistanceSessionStore(fixture);
	await store.load();
	store.selectSource('source-1');
	store.selectOperation('shot-detection');
	if (mode === 'accurate') {
		store.selectShotDetectionMode(mode);
		store.selectModel('transnetv2');
	}
	store.setConsent(true);
	return store;
}

function renderLocalAssistance(snapshot: LocalAssistanceSnapshot): string {
	return renderToStaticMarkup(<LocalAssistanceDialogView
		copy={ENGLISH_COPY} snapshot={snapshot} surface="advanced" onClose={() => undefined}
		onSelectSource={() => undefined} onSelectOperation={() => undefined}
		onSelectModel={() => undefined} onShotDetectionModeChange={() => undefined}
		onConsentChange={() => undefined} onRun={() => undefined} onCancel={() => undefined}
		onReview={() => undefined} onAccept={() => undefined}
	/>);
}

function shotDetectionFixture(options: Readonly<{
	models?: readonly (typeof TRANSNET_MODEL | typeof SUBSTITUTE_SHOT_MODEL)[];
	preparedMode?: 'fast' | 'accurate';
	omitPreparedMode?: boolean;
	detector?: 'ffmpeg-scdet' | 'transnetv2';
}> = {}) {
	const prepareRequests: Parameters<
		LocalAssistanceSelectedMediaPreparationPort['prepareSelectedMedia']
	>[0][] = [];
	const runRequests: Parameters<LocalAssistanceBridge['run']>[0][] = [];
	const detector = options.detector ?? 'ffmpeg-scdet';
	const body = new Blob([JSON.stringify({
		schemaVersion: 1, detector, timescale: 90_000, sourceFrameCount: 240, boundaries: [],
	})], { type: 'application/vnd.soundscaper.shot-boundaries+json' });
	const models = options.models ?? Object.freeze([TRANSNET_MODEL, SUBSTITUTE_SHOT_MODEL]);
	const bridge: LocalAssistanceBridge = Object.freeze({
		models: async () => models,
		createJob: async () => Object.freeze({ contractVersion: 1 as const, jobId: JOB_ID }),
		stageInput: async (request: Parameters<LocalAssistanceBridge['stageInput']>[0]) => Object.freeze({
			claimVersion: 1 as const, claimId: '4'.repeat(40), jobId: request.jobId,
			role: request.role, mediaType: request.mediaType, byteLength: request.byteLength,
			sha256: '5'.repeat(64),
		}),
		reserveOutput: async (request: Parameters<LocalAssistanceBridge['reserveOutput']>[0]) => Object.freeze({
			claimVersion: 1 as const, claimId: OUTPUT_CLAIM_ID, jobId: request.jobId,
			role: request.role, mediaType: request.mediaType,
			maximumByteLength: request.maximumByteLength,
		}),
		run: async (request: Parameters<LocalAssistanceBridge['run']>[0]) => {
			runRequests.push(request);
			return Object.freeze({
				contractVersion: 1 as const, jobId: request.jobId,
				operation: 'shot-detection' as const, outcome: 'completed' as const,
				result: Object.freeze({ contractVersion: 1 as const, jobId: request.jobId,
					operation: 'shot-detection' as const, outputs: Object.freeze([Object.freeze({
						claimVersion: 1 as const, claimId: OUTPUT_CLAIM_ID, jobId: request.jobId,
						role: 'shot-boundaries' as const,
						mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
						byteLength: body.size, sha256: '6'.repeat(64),
					})]) }),
			});
		},
		cancel: async (jobId: string) => Object.freeze({
			contractVersion: 1 as const, jobId, outcome: 'not-active' as const,
		}),
		readOutput: async () => body,
		release: async () => true,
		onProgress: () => () => undefined,
	});
	const preparation: LocalAssistanceSelectedMediaPreparationPort = Object.freeze({
		listSelectedMedia: async () => Object.freeze({ sources: Object.freeze([Object.freeze({
			sourceId: 'source-1', label: 'Camera selection', mediaKind: 'video' as const,
			operations: Object.freeze(['shot-detection' as const]),
		})]) }),
		prepareSelectedMedia: async (request: Parameters<
			LocalAssistanceSelectedMediaPreparationPort['prepareSelectedMedia']
		>[0]) => {
			prepareRequests.push(request);
			return Object.freeze({
				sourceId: 'source-1', operation: 'shot-detection' as const,
				...(options.omitPreparedMode ? {} : {
					shotDetectionMode: options.preparedMode ?? request.shotDetectionMode ?? 'fast',
				}),
				selectionFence: FENCE,
				inputs: Object.freeze([Object.freeze({ role: 'video' as const,
					mediaType: 'video/mp4', bytes: new Blob(['video'], { type: 'video/mp4' }) })]),
				outputs: Object.freeze([Object.freeze({ role: 'shot-boundaries' as const,
					mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
					maximumByteLength: 4096 })]),
			});
		},
	});
	return { bridge, preparation, prepareRequests, runRequests };
}
