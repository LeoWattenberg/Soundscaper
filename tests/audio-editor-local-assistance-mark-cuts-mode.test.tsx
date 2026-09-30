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
import { createLocalAssistanceAdvancedWorkflowSessionStore } from
	'../src/common/editor/ui/local-assistance-advanced-session-store.ts';
import type { LocalAssistanceSnapshot } from
	'../src/common/editor/ui/local-assistance-session-types.ts';
import { LocalAssistanceDialogView } from '../src/common/editor/ui/dialogs/LocalAssistanceDialog.tsx';

const JOB_ID = 'a'.repeat(40);
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

	const store = createLocalAssistanceAdvancedWorkflowSessionStore(shotDetectionFixture());
	await store.load();
	store.selectSource('source-1');
	store.selectOperation('shot-detection');
	assert.equal(store.getSnapshot().shotDetectionMode, 'fast');
	assert.equal(store.getSnapshot().canRun, true, 'Fast is explicitly model-free');
	const fastMarkup = renderLocalAssistance(store.getSnapshot());
	assert.match(fastMarkup, /<legend>Mark Cuts mode<\/legend>/u);
	assert.match(fastMarkup, /type="radio" name="local-assistance-shot-mode" checked="" value="fast"/u);
	assert.match(fastMarkup, /Fast · model-free/u);
	assert.doesNotMatch(fastMarkup, /transnetv2 · 1\.0\.0/u);

	store.selectShotDetectionMode('accurate');
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
	assert.equal(store.getSnapshot().canRun, true);

	const unavailable = createLocalAssistanceAdvancedWorkflowSessionStore(shotDetectionFixture({
		models: Object.freeze([SUBSTITUTE_SHOT_MODEL]),
	}));
	await unavailable.load();
	unavailable.selectSource('source-1');
	unavailable.selectOperation('shot-detection');
	unavailable.selectShotDetectionMode('accurate');
	assert.equal(unavailable.getSnapshot().phase, 'unavailable');
	assert.equal(unavailable.getSnapshot().unavailableReason, 'no-compatible-model');
	await Promise.all([store.dispose(), unavailable.dispose()]);
});

test('the active Advanced store sends one exact Mark Cuts mode and model binding', async () => {
	const fast = shotDetectionFixture();
	const fastStore = await selectedShotStore(fast, 'fast');
	await fastStore.run();
	assert.equal(fastStore.getSnapshot().phase, 'unavailable');
	assert.equal(fast.requests[0]?.shotDetectionMode, 'fast');
	assert.deepEqual(fast.requests[0]?.models, []);

	fastStore.selectShotDetectionMode('accurate');
	assert.deepEqual(fastStore.getSnapshot().selectedModelIds, []);
	fastStore.selectModel('transnetv2');
	fastStore.selectShotDetectionMode('fast');
	assert.deepEqual(fastStore.getSnapshot().selectedModelIds, []);

	const accurate = shotDetectionFixture();
	const accurateStore = await selectedShotStore(accurate, 'accurate');
	await accurateStore.run();
	assert.equal(accurateStore.getSnapshot().phase, 'unavailable');
	assert.equal(accurate.requests[0]?.shotDetectionMode, 'accurate');
	assert.deepEqual(accurate.requests[0]?.models, [TRANSNET_MODEL]);
	await Promise.all([fastStore.dispose(), accurateStore.dispose()]);
});

async function selectedShotStore(
	fixture: ReturnType<typeof shotDetectionFixture>,
	mode: 'fast' | 'accurate',
) {
	const store = createLocalAssistanceAdvancedWorkflowSessionStore(fixture);
	await store.load();
	store.selectSource('source-1');
	store.selectOperation('shot-detection');
	if (mode === 'accurate') {
		store.selectShotDetectionMode(mode);
		store.selectModel('transnetv2');
	}
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
}> = {}) {
	const requests: Parameters<
		NonNullable<LocalAssistanceSelectedMediaPreparationPort['prepareAdvancedWorkflow']>
	>[0][] = [];
	const models = options.models ?? Object.freeze([TRANSNET_MODEL, SUBSTITUTE_SHOT_MODEL]);
	const workflow = {
		custody: { release: async () => true },
		createJob: async () => Object.freeze({ contractVersion: 1 as const, jobId: JOB_ID }),
		run: async () => { throw new Error('Typed preparation refusal must not run the workflow.'); },
		cancel: async () => Object.freeze({ contractVersion: 1 as const, jobId: JOB_ID,
			outcome: 'not-active' as const }),
		readOutput: async () => { throw new Error('Typed preparation refusal has no output.'); },
		onProgress: () => () => undefined,
	};
	const bridge = {
		models: async () => models,
		workflow,
	} as unknown as LocalAssistanceBridge;
	const preparation = {
		listSelectedMedia: async () => Object.freeze({ sources: Object.freeze([Object.freeze({
			sourceId: 'source-1', label: 'Camera selection', mediaKind: 'video' as const,
			operations: Object.freeze(['shot-detection' as const]),
		})]) }),
		prepareSelectedMedia: async () => { throw new Error('Advanced never enters operation-v1.'); },
		prepareAdvancedWorkflow: async (request: Parameters<
			NonNullable<LocalAssistanceSelectedMediaPreparationPort['prepareAdvancedWorkflow']>
		>[0]) => {
			requests.push(request);
			return Object.freeze({ outcome: 'unavailable' as const,
				reason: 'aggregate-custody-unavailable' as const });
		},
	} satisfies LocalAssistanceSelectedMediaPreparationPort;
	return { bridge, preparation, requests };
}
