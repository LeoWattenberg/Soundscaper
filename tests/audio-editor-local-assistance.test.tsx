/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { resolveLocalAssistanceBridge, type LocalAssistanceModel } from
	'../src/common/editor/assistance/local-assistance-bridge.ts';
import { localAssistanceModelTaskSlots } from
	'../src/common/editor/assistance/local-assistance-preparation.ts';
import { createLocalAssistanceAdvancedWorkflowSessionStore } from
	'../src/common/editor/ui/local-assistance-advanced-session-store.ts';
import type { LocalAssistanceSnapshot } from
	'../src/common/editor/ui/local-assistance-session-types.ts';
import {
	localAssistanceReviewIdentity,
	LocalAssistanceDialogView,
} from '../src/common/editor/ui/dialogs/LocalAssistanceDialog.tsx';
import {
	EMBEDDING_MODEL,
	MODEL,
	rawBridgeFixture,
	SECOND_SEGMENTATION_MODEL,
	SEGMENTATION_MODEL,
} from './helpers/local-assistance-fixtures.ts';

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

test('Advanced speaker diarization requires one installed model for each task', async () => {
	for (const models of [
		Object.freeze([SEGMENTATION_MODEL]), Object.freeze([EMBEDDING_MODEL]),
	]) {
		const store = diarizationSelectionStore(models);
		await store.load();
		store.selectSource('source-1');
		store.selectOperation('speaker-diarization');
		assert.equal(store.getSnapshot().phase, 'unavailable');
		assert.equal(store.getSnapshot().unavailableReason, 'no-compatible-model');
		assert.deepEqual(store.getSnapshot().selectedModelIds, []);
		await store.dispose();
	}
});

test('Advanced speaker diarization keeps one exact binding per task independent of selection order', async () => {
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
		const store = diarizationSelectionStore(Object.freeze([
			EMBEDDING_MODEL, SECOND_SEGMENTATION_MODEL, SEGMENTATION_MODEL,
		]));
		await store.load();
		store.selectSource('source-1');
		store.selectOperation('speaker-diarization');
		for (const modelId of selection) store.selectModel(modelId);
		assert.deepEqual(store.getSnapshot().selectedModelIds, [
			expectedSegmentation.modelId, EMBEDDING_MODEL.modelId,
		]);
		assert.equal(store.getSnapshot().canRun, true);
		await store.dispose();
	}
});

test('speaker diarization renders one installed-model selector per required task', () => {
	const snapshot = selectionSnapshot({
		selectedOperation: 'speaker-diarization',
		models: Object.freeze([EMBEDDING_MODEL, SECOND_SEGMENTATION_MODEL, SEGMENTATION_MODEL]),
		selectedModelIds: Object.freeze([SEGMENTATION_MODEL.modelId, EMBEDDING_MODEL.modelId]),
	});
	const markup = renderLocalAssistance(snapshot, null);
	assert.match(markup, /Installed compatible model · speaker-segmentation/u);
	assert.match(markup, /Installed compatible model · speaker-embedding/u);
	assert.match(markup, /<option value="segmentation-model" selected="">/u);
	assert.match(markup, /<option value="embedding-model" selected="">/u);
	assert.equal(markup.match(/<select/gu)?.length, 4);
	assert.doesNotMatch(markup, /Mark Cuts mode/u);
});

test('preparation represents shot detection as a zero-model operation contract', () => {
	assert.deepEqual(localAssistanceModelTaskSlots('shot-detection'), []);
});

test('review identity authorizes only the exact active Advanced result', () => {
	const bytes = new Blob(['transcript'], {
		type: 'application/vnd.soundscaper.transcript+json',
	});
	const snapshot: LocalAssistanceSnapshot = Object.freeze({
		...selectionSnapshot({ selectedOperation: 'speech-recognition',
			models: Object.freeze([MODEL]), selectedModelIds: Object.freeze([MODEL.modelId]) }),
		phase: 'completed', canRun: false, canReview: true, canAccept: true,
		result: Object.freeze({ operation: 'speech-recognition', outputs: Object.freeze([
			Object.freeze({
				claim: Object.freeze({ claimVersion: 1 as const, claimId: 'c'.repeat(40),
					jobId: 'a'.repeat(40), role: 'transcript' as const,
					mediaType: bytes.type, byteLength: bytes.size, sha256: '4'.repeat(64) }),
				bytes,
				review: Object.freeze({ kind: 'transcript' as const, language: 'en', segments: Object.freeze([]) }),
			}),
		]) }),
	});
	const identity = localAssistanceReviewIdentity(snapshot);
	assert.ok(identity);
	assert.doesNotMatch(acceptProposalButton(renderLocalAssistance(snapshot, identity)), / disabled=""/u);
	const replacement: LocalAssistanceSnapshot = Object.freeze({ ...snapshot,
		result: snapshot.result && Object.freeze({ ...snapshot.result,
			outputs: Object.freeze(snapshot.result.outputs.map((output) => Object.freeze({ ...output,
				claim: Object.freeze({ ...output.claim, jobId: 'd'.repeat(40) }),
			}))) }) });
	assert.match(acceptProposalButton(renderLocalAssistance(replacement, identity)), / disabled=""/u);
});

function diarizationSelectionStore(models: readonly LocalAssistanceModel[]) {
	return createLocalAssistanceAdvancedWorkflowSessionStore({
		bridge: {
			models: async () => models,
			workflow: { custody: {}, readOutput: async () => new Blob(),
				onProgress: () => () => undefined },
		} as never,
		preparation: {
			listSelectedMedia: async () => ({ sources: [{
				sourceId: 'source-1', label: 'Interview selection', mediaKind: 'audio',
				operations: ['speaker-diarization'],
			}] }),
			prepareSelectedMedia: async () => null,
			prepareAdvancedWorkflow: async () => null,
		} as never,
	});
}

function selectionSnapshot(overrides: Partial<LocalAssistanceSnapshot>): LocalAssistanceSnapshot {
	return Object.freeze({
		phase: 'ready',
		sources: Object.freeze([Object.freeze({
			sourceId: 'source-1', label: 'Interview selection', mediaKind: 'audio' as const,
			operations: Object.freeze(['speech-recognition' as const, 'speaker-diarization' as const]),
		})]),
		models: Object.freeze([MODEL]), selectedSourceId: 'source-1', selectedOperation: null,
		shotDetectionMode: 'fast', selectedModelIds: Object.freeze([]), consent: false,
		progress: null, result: null, unavailableReason: null, error: null, cleanup: null,
		canRun: false, canCancel: false, canReview: false, canAccept: false,
		canPrepareTranscriptCleanup: false,
		...overrides,
	});
}

function renderLocalAssistance(
	snapshot: LocalAssistanceSnapshot,
	reviewedResultIdentity: string | null,
): string {
	return renderToStaticMarkup(<LocalAssistanceDialogView
		copy={ENGLISH_COPY} snapshot={snapshot} surface="advanced"
		reviewedResultIdentity={reviewedResultIdentity} onClose={() => undefined}
		onSelectSource={() => undefined} onSelectOperation={() => undefined}
		onSelectModel={() => undefined} onConsentChange={() => undefined}
		onRun={() => undefined} onCancel={() => undefined}
		onReview={() => undefined} onAccept={() => undefined}
	/>);
}

function acceptProposalButton(markup: string): string {
	const tag = markup.match(/<button[^>]*>(?:<span[^>]*>)?Accept proposal/u);
	assert.ok(tag, 'the advanced surface renders an acceptance control');
	return tag[0];
}
