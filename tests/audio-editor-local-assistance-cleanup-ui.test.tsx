/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AssistanceSelectionFence } from
	'../src/common/editor/assistance/proposal-session.ts';
import {
	createLocalAssistanceTranscriptCleanupPreparation,
	localAssistanceCleanupVoiceActivity,
} from '../src/common/editor/assistance/local-assistance-cleanup.ts';
import type {
	LocalAssistanceSelectedMediaPreparationPort,
	LocalAssistanceValidatedResultAcceptanceRequest,
} from '../src/common/editor/assistance/local-assistance-preparation.ts';
import type { LocalAssistanceSnapshot } from
	'../src/common/editor/ui/local-assistance-session-types.ts';
import { createLocalAssistanceTranscriptCleanupStore } from
	'../src/common/editor/ui/local-assistance-transcript-cleanup-store.ts';
import LocalAssistanceCleanupReview from
	'../src/common/editor/ui/dialogs/LocalAssistanceCleanupReview.tsx';

const FENCE = Object.freeze({
	projectId: 'project-1', schemaFamily: 'soundscaper' as const, schemaVersion: 1 as const,
	revision: 2, sequenceId: 'sequence-1',
	occurrenceIds: Object.freeze(['occurrence-1']), sourceId: 'source-1',
	sourceSha256: '1'.repeat(64), sourceStartFrame: 0, sourceEndFrame: 96_000,
	linkMembershipSha256: '2'.repeat(64), timingAuthoritySha256: '3'.repeat(64),
});
const MODEL = Object.freeze({
	modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0', task: 'speech-recognition',
	artifactSha256s: Object.freeze(['d'.repeat(64)]),
});
const VAD_MODEL = Object.freeze({
	modelId: 'silero-vad-v6', version: '6.0.0', task: 'voice-activity-detection',
	artifactSha256s: Object.freeze(['e'.repeat(64)]),
});
const TRANSCRIPT_REVIEW = Object.freeze({
	kind: 'transcript' as const, language: 'en', segments: Object.freeze([Object.freeze({
		startSeconds: 0, endSeconds: 2, text: 'um hello hello', speaker: null,
		words: Object.freeze([
			Object.freeze({ text: 'um', startSeconds: 0, endSeconds: 0.25, confidence: 0.9 }),
			Object.freeze({ text: 'hello', startSeconds: 0.5, endSeconds: 1, confidence: 0.9 }),
			Object.freeze({ text: 'hello', startSeconds: 1, endSeconds: 1.5, confidence: 0.9 }),
		]),
	})]),
});

test('the active cleanup store prepares review before an explicit subset is accepted', async () => {
	const fixture = cleanupFixture();
	assert.equal(fixture.store.available(), true);
	assert.equal(fixture.preparedRequests.length, 0);

	await fixture.store.prepare();
	assert.equal(fixture.snapshot().cleanup?.error, null);
	assert.equal(fixture.snapshot().cleanup?.phase, 'review');
	assert.equal(fixture.preparedRequests.length, 1);
	assert.equal((fixture.preparedRequests[0] as { voiceActivity: unknown }).voiceActivity, null);
	assert.equal((fixture.preparedRequests[0] as { preset: unknown }).preset, 'balanced');
	assert.deepEqual(fixture.snapshot().cleanup?.selectedProposalIds, []);
	assert.deepEqual(fixture.accepted, []);

	await fixture.store.prepare('conservative');
	assert.equal(fixture.snapshot().cleanup?.error, null);
	assert.equal(fixture.snapshot().cleanup?.phase, 'review');
	assert.equal((fixture.preparedRequests[1] as { preset: unknown }).preset, 'conservative');
	fixture.store.setSelected('repetition-48000-72000', true);
	await fixture.store.accept();
	assert.deepEqual(fixture.accepted, [['repetition-48000-72000']]);
	assert.equal(fixture.snapshot().cleanup?.phase, 'accepted');
	assert.equal(fixture.acceptance(), null, 'cleanup invalidates the prior transcript authority');
});

test('rejecting active cleanup review is an explicit non-mutating decision', async () => {
	const fixture = cleanupFixture();
	await fixture.store.prepare();
	assert.equal(fixture.snapshot().cleanup?.phase, 'review');
	await fixture.store.reject();
	assert.equal(fixture.rejected(), 1);
	assert.deepEqual(fixture.accepted, []);
	assert.equal(fixture.snapshot().cleanup?.phase, 'rejected');
});

test('cleanup carries reviewed VAD only from the exact same selection fence', () => {
	const transcript = transcriptAcceptance(FENCE);
	for (const [voiceFence, expected] of [
		[FENCE, true],
		[Object.freeze({ ...FENCE, revision: FENCE.revision + 1 }), false],
	] as const) {
		const voiceActivity = localAssistanceCleanupVoiceActivity(vadAcceptance(voiceFence));
		assert.ok(voiceActivity);
		assert.equal(
			createLocalAssistanceTranscriptCleanupPreparation(
				transcript, voiceActivity, 'balanced',
			).voiceActivity !== null,
			expected,
		);
	}
});

test('cleanup review renders unchecked per-item choices and explicit decisions', () => {
	const markup = renderToStaticMarkup(<LocalAssistanceCleanupReview
		copy={{}}
		cleanup={Object.freeze({
			phase: 'review', preset: 'balanced', proposals: Object.freeze([
				Object.freeze({ id: 'filler', kind: 'filler', startFrame: 0, endFrame: 12_000, text: 'um' }),
				Object.freeze({ id: 'silence', kind: 'silence', startFrame: 24_000, endFrame: 48_000, text: '' }),
			]), selectedProposalIds: Object.freeze([]), usesVoiceActivity: true, error: null,
		})}
		onPresetChange={() => undefined}
		onSelectionChange={() => undefined}
		onAccept={() => undefined}
		onReject={() => undefined}
	/>);
	assert.equal(markup.match(/type="checkbox"/gu)?.length, 2);
	assert.match(markup, /Conservative/u);
	assert.match(markup, /Balanced/u);
	assert.match(markup, /Aggressive/u);
	assert.doesNotMatch(markup, /checked=""/u);
	assert.match(markup, /Measured silence/u);
	assert.match(markup, /disabled="">Apply selected cleanup/u);
	assert.match(markup, />Reject cleanup</u);
});

function cleanupFixture() {
	const preparedRequests: unknown[] = [];
	const accepted: string[][] = [];
	let rejected = 0;
	let acceptance: LocalAssistanceValidatedResultAcceptanceRequest | null = transcriptAcceptance(FENCE);
	let snapshot = completedSnapshot();
	const preparation = {
		listSelectedMedia: async () => ({ sources: [] }),
		prepareSelectedMedia: async () => { throw new Error('not used'); },
		prepareTranscriptCleanup: async (request: unknown) => {
			preparedRequests.push(request);
			return Object.freeze({
				operation: 'speech-recognition', phase: 'review', fence: FENCE,
				proposals: Object.freeze([
					Object.freeze({ id: 'filler-0-12000', kind: 'filler',
						startFrame: 0, endFrame: 12_000, text: 'um' }),
					Object.freeze({ id: 'repetition-48000-72000', kind: 'repetition',
						startFrame: 48_000, endFrame: 72_000, text: 'hello' }),
				]),
			});
		},
		acceptTranscriptCleanup: async (proposalIds: readonly string[]) => {
			accepted.push([...proposalIds]);
		},
		rejectTranscriptCleanup: async () => { rejected += 1; },
		cancelTranscriptCleanup: async () => undefined,
	} satisfies LocalAssistanceSelectedMediaPreparationPort;
	const store = createLocalAssistanceTranscriptCleanupStore({
		preparation,
		snapshot: () => snapshot,
		acceptance: () => acceptance,
		clearAcceptance: () => { acceptance = null; },
		voiceActivity: () => null,
		update: (change) => { snapshot = Object.freeze({ ...snapshot, ...change }); },
		disposed: () => false,
	});
	return { store, preparedRequests, accepted, snapshot: () => snapshot,
		acceptance: () => acceptance, rejected: () => rejected };
}

function transcriptAcceptance(
	selectionFence: AssistanceSelectionFence,
): LocalAssistanceValidatedResultAcceptanceRequest {
	return Object.freeze({
		sourceId: 'source-1', operation: 'speech-recognition', selectionFence,
		models: Object.freeze([MODEL]),
		outputs: Object.freeze([Object.freeze({
			claim: Object.freeze({ claimVersion: 1 as const, claimId: 'c'.repeat(40),
				jobId: 'a'.repeat(40), role: 'transcript' as const,
				mediaType: 'application/vnd.soundscaper.transcript+json',
				byteLength: 1, sha256: 'd'.repeat(64) }),
			review: TRANSCRIPT_REVIEW,
		})]),
	});
}

function vadAcceptance(
	selectionFence: AssistanceSelectionFence,
): LocalAssistanceValidatedResultAcceptanceRequest {
	return Object.freeze({
		sourceId: 'source-1', operation: 'voice-activity-detection', selectionFence,
		models: Object.freeze([VAD_MODEL]),
		outputs: Object.freeze([Object.freeze({
			claim: Object.freeze({ claimVersion: 1 as const, claimId: 'b'.repeat(40),
				jobId: 'a'.repeat(40), role: 'voice-activity' as const,
				mediaType: 'application/vnd.soundscaper.voice-activity+json',
				byteLength: 1, sha256: 'e'.repeat(64) }),
			review: Object.freeze({ kind: 'voice-activity' as const, sampleRate: 16_000 as const,
				segments: Object.freeze([Object.freeze({ startSample: 0, sampleCount: 8_000 })]) }),
		})]),
	});
}

function completedSnapshot(): LocalAssistanceSnapshot {
	return Object.freeze({
		phase: 'completed', sources: Object.freeze([]), models: Object.freeze([MODEL]),
		selectedSourceId: 'source-1', selectedOperation: 'speech-recognition',
		shotDetectionMode: 'fast', selectedModelIds: Object.freeze([MODEL.modelId]),
		consent: false, progress: null, result: Object.freeze({
			operation: 'speech-recognition', outputs: Object.freeze([]),
		}), unavailableReason: null, error: null, cleanup: null,
		canRun: false, canCancel: false, canReview: true, canAccept: true,
		canPrepareTranscriptCleanup: true,
	});
}
