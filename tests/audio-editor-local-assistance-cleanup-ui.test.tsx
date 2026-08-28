/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AssistanceSelectionFence } from
	'../src/common/editor/assistance/proposal-session.ts';
import type { LocalAssistanceBridge } from '../src/common/editor/ui/local-assistance-bridge.ts';
import type { LocalAssistanceSelectedMediaPreparationPort } from
	'../src/common/editor/ui/local-assistance-preparation.ts';
import { createLocalAssistanceSessionStore } from
	'../src/common/editor/ui/local-assistance-session-store.ts';
import LocalAssistanceCleanupReview from
	'../src/common/editor/ui/dialogs/LocalAssistanceCleanupReview.tsx';

const JOB_ID = 'a'.repeat(40);
const INPUT_CLAIM_ID = 'b'.repeat(40);
const OUTPUT_CLAIM_ID = 'c'.repeat(40);
const SHA256 = 'd'.repeat(64);
const FENCE = Object.freeze({
	schemaFamily: 'soundscaper' as const, schemaVersion: 1 as const,
	projectId: 'project-1', revision: 2, sequenceId: 'sequence-1',
	occurrenceIds: Object.freeze(['occurrence-1']), sourceId: 'source-1',
	sourceSha256: '1'.repeat(64), sourceStartFrame: 0, sourceEndFrame: 96_000,
	linkMembershipSha256: '2'.repeat(64), timingAuthoritySha256: '3'.repeat(64),
});
const MODEL = Object.freeze({
	modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0', task: 'speech-recognition',
	artifactSha256s: Object.freeze([SHA256]),
});
const VAD_MODEL = Object.freeze({
	modelId: 'silero-vad-v6', version: '6.0.0', task: 'voice-activity-detection',
	artifactSha256s: Object.freeze(['e'.repeat(64)]),
});
const TRANSCRIPT = JSON.stringify({ language: 'en', segments: [{
	startSeconds: 0, endSeconds: 2, text: 'um hello hello', speaker: null,
	words: [
		{ text: 'um', startSeconds: 0, endSeconds: 0.25, confidence: 0.9 },
		{ text: 'hello', startSeconds: 0.5, endSeconds: 1, confidence: 0.9 },
		{ text: 'hello', startSeconds: 1, endSeconds: 1.5, confidence: 0.9 },
	],
}] });

function fixture() {
	const body = new Blob([TRANSCRIPT], {
		type: 'application/vnd.soundscaper.transcript+json',
	});
	const preparedRequests: unknown[] = [];
	const accepted: readonly string[][] = [];
	let rejected = 0;
	const bridge: LocalAssistanceBridge = Object.freeze({
		models: async () => Object.freeze([MODEL]),
		createJob: async () => Object.freeze({ contractVersion: 1 as const, jobId: JOB_ID }),
		stageInput: async (request: Parameters<LocalAssistanceBridge['stageInput']>[0]) => Object.freeze({
			claimVersion: 1 as const, claimId: INPUT_CLAIM_ID, jobId: request.jobId,
			role: request.role, mediaType: request.mediaType, byteLength: request.byteLength, sha256: SHA256,
		}),
		reserveOutput: async (request: Parameters<LocalAssistanceBridge['reserveOutput']>[0]) => Object.freeze({
			claimVersion: 1 as const, claimId: OUTPUT_CLAIM_ID, jobId: request.jobId,
			role: request.role, mediaType: request.mediaType,
			maximumByteLength: request.maximumByteLength,
		}),
		run: async (request: Parameters<LocalAssistanceBridge['run']>[0]) => Object.freeze({
			contractVersion: 1 as const, jobId: request.jobId, operation: request.operation,
			outcome: 'completed' as const, result: Object.freeze({
				contractVersion: 1 as const, jobId: request.jobId, operation: request.operation,
				outputs: Object.freeze([Object.freeze({
					claimVersion: 1 as const, claimId: OUTPUT_CLAIM_ID, jobId: request.jobId,
					role: 'transcript' as const,
					mediaType: 'application/vnd.soundscaper.transcript+json',
					byteLength: body.size, sha256: SHA256,
				})]),
			}),
		}),
		cancel: async (jobId: string) => Object.freeze({
			contractVersion: 1 as const, jobId, outcome: 'not-active' as const,
		}),
		readOutput: async () => body,
		release: async () => true,
		onProgress: () => () => undefined,
	});
	const preparation: LocalAssistanceSelectedMediaPreparationPort = Object.freeze({
		listSelectedMedia: async () => Object.freeze({ sources: Object.freeze([Object.freeze({
			sourceId: 'source-1', label: 'Interview', mediaKind: 'audio' as const,
			operations: Object.freeze(['speech-recognition' as const]),
		})]) }),
		prepareSelectedMedia: async () => Object.freeze({
			sourceId: 'source-1', operation: 'speech-recognition' as const,
			selectionFence: FENCE,
			inputs: Object.freeze([Object.freeze({
				role: 'audio' as const, mediaType: 'audio/wav',
				bytes: new Blob(['audio'], { type: 'audio/wav' }),
			})]),
			outputs: Object.freeze([Object.freeze({
				role: 'transcript' as const,
				mediaType: 'application/vnd.soundscaper.transcript+json', maximumByteLength: 4096,
			})]),
		}),
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
			(accepted as string[][]).push([...proposalIds]);
		},
		rejectTranscriptCleanup: async () => { rejected += 1; },
		cancelTranscriptCleanup: async () => undefined,
	});
	return { bridge, preparation, preparedRequests, accepted, rejected: () => rejected };
}

async function completedStore(value: ReturnType<typeof fixture>) {
	const store = createLocalAssistanceSessionStore(value);
	await store.load();
	store.selectSource('source-1');
	store.selectOperation('speech-recognition');
	store.selectModel(MODEL.modelId);
	store.setConsent(true);
	await store.run();
	return store;
}

function vadContextFixture(speechFence: AssistanceSelectionFence = FENCE) {
	const transcriptBody = new Blob([TRANSCRIPT], {
		type: 'application/vnd.soundscaper.transcript+json',
	});
	const vadBody = new Blob([JSON.stringify({
		sampleRate: 16_000, segments: [
			{ startSample: 0, sampleCount: 8_000 }, { startSample: 24_000, sampleCount: 8_000 },
		],
	})], { type: 'application/vnd.soundscaper.voice-activity+json' });
	const cleanupRequests: unknown[] = [];
	const bridge: LocalAssistanceBridge = Object.freeze({
		models: async () => Object.freeze([MODEL, VAD_MODEL]),
		createJob: async () => Object.freeze({ contractVersion: 1 as const, jobId: JOB_ID }),
		stageInput: async (request: Parameters<LocalAssistanceBridge['stageInput']>[0]) => Object.freeze({
			claimVersion: 1 as const, claimId: INPUT_CLAIM_ID, jobId: request.jobId,
			role: request.role, mediaType: request.mediaType, byteLength: request.byteLength, sha256: SHA256,
		}),
		reserveOutput: async (request: Parameters<LocalAssistanceBridge['reserveOutput']>[0]) => Object.freeze({
			claimVersion: 1 as const, claimId: OUTPUT_CLAIM_ID, jobId: request.jobId,
			role: request.role, mediaType: request.mediaType,
			maximumByteLength: request.maximumByteLength,
		}),
		run: async (request: Parameters<LocalAssistanceBridge['run']>[0]) => {
			const role = request.operation === 'voice-activity-detection' ? 'voice-activity' : 'transcript';
			const body = role === 'voice-activity' ? vadBody : transcriptBody;
			return Object.freeze({
				contractVersion: 1 as const, jobId: request.jobId, operation: request.operation,
				outcome: 'completed' as const, result: Object.freeze({
					contractVersion: 1 as const, jobId: request.jobId, operation: request.operation,
					outputs: Object.freeze([Object.freeze({
						claimVersion: 1 as const, claimId: OUTPUT_CLAIM_ID, jobId: request.jobId,
						role, mediaType: `application/vnd.soundscaper.${role}+json`,
						byteLength: body.size, sha256: SHA256,
					})]),
				}),
			});
		},
		cancel: async (jobId: string) => Object.freeze({
			contractVersion: 1 as const, jobId, outcome: 'not-active' as const,
		}),
		readOutput: async ({ claim }: Parameters<LocalAssistanceBridge['readOutput']>[0]) => (
			claim.role === 'voice-activity' ? vadBody : transcriptBody
		),
		release: async () => true,
		onProgress: () => () => undefined,
	});
	const preparation: LocalAssistanceSelectedMediaPreparationPort = Object.freeze({
		listSelectedMedia: async () => Object.freeze({ sources: Object.freeze([Object.freeze({
			sourceId: 'source-1', label: 'Interview', mediaKind: 'audio' as const,
			operations: Object.freeze([
				'voice-activity-detection' as const, 'speech-recognition' as const,
			]),
		})]) }),
		prepareSelectedMedia: async ({ operation }: Parameters<
			LocalAssistanceSelectedMediaPreparationPort['prepareSelectedMedia']
		>[0]) => Object.freeze({
			sourceId: 'source-1', operation,
			selectionFence: operation === 'speech-recognition' ? speechFence : FENCE,
			inputs: Object.freeze([Object.freeze({
				role: 'audio' as const, mediaType: 'audio/wav',
				bytes: new Blob(['audio'], { type: 'audio/wav' }),
			})]),
			outputs: Object.freeze([Object.freeze({
				role: operation === 'voice-activity-detection' ? 'voice-activity' as const : 'transcript' as const,
				mediaType: operation === 'voice-activity-detection'
					? 'application/vnd.soundscaper.voice-activity+json'
					: 'application/vnd.soundscaper.transcript+json',
				maximumByteLength: 4096,
			})]),
		}),
		prepareTranscriptCleanup: async (request: unknown) => {
			cleanupRequests.push(request);
			return Object.freeze({ operation: 'speech-recognition', phase: 'review',
				fence: speechFence, proposals: Object.freeze([Object.freeze({
					id: 'filler-0-12000', kind: 'filler', startFrame: 0, endFrame: 12_000, text: 'um',
				})]) });
		},
		acceptTranscriptCleanup: async () => undefined,
		rejectTranscriptCleanup: async () => undefined,
		cancelTranscriptCleanup: async () => undefined,
	});
	return { bridge, preparation, cleanupRequests };
}

async function runOperation(
	store: ReturnType<typeof createLocalAssistanceSessionStore>,
	operation: 'voice-activity-detection' | 'speech-recognition',
	modelId: string,
) {
	store.selectOperation(operation);
	store.selectModel(modelId);
	store.setConsent(true);
	await store.run();
}

test('reviewing authenticated Parakeet output only prepares cleanup until an explicit subset is accepted', async () => {
	const value = fixture();
	const store = await completedStore(value);
	assert.equal(value.preparedRequests.length, 0, 'completed inference never prepares or applies cleanup');

	await store.prepareTranscriptCleanup();
	assert.equal(value.preparedRequests.length, 1);
	assert.equal((value.preparedRequests[0] as { voiceActivity: unknown }).voiceActivity, null);
	assert.equal((value.preparedRequests[0] as { preset: unknown }).preset, 'balanced');
	assert.deepEqual(store.getSnapshot().cleanup?.selectedProposalIds, []);
	assert.deepEqual(value.accepted, []);

	await store.prepareTranscriptCleanup('conservative');
	assert.equal((value.preparedRequests[1] as { preset: unknown }).preset, 'conservative');
	assert.deepEqual(store.getSnapshot().cleanup?.selectedProposalIds, []);

	store.setTranscriptCleanupProposalSelected('repetition-48000-72000', true);
	await store.acceptTranscriptCleanup();
	assert.deepEqual(value.accepted, [['repetition-48000-72000']]);
	assert.equal(store.getSnapshot().cleanup?.phase, 'accepted');
	assert.equal(store.getSnapshot().canAccept, false, 'cleanup invalidates the prior transcript fence');
});

test('rejecting cleanup is an explicit non-mutating decision', async () => {
	const value = fixture();
	const store = await completedStore(value);
	await store.prepareTranscriptCleanup();
	await store.rejectTranscriptCleanup();
	assert.equal(value.rejected(), 1);
	assert.deepEqual(value.accepted, []);
	assert.equal(store.getSnapshot().cleanup?.phase, 'rejected');
});

test('cleanup carries reviewed VAD only from the exact same selection fence in this session', async () => {
	for (const [speechFence, expectedVoiceActivity] of [
		[FENCE, true],
		[Object.freeze({ ...FENCE, revision: FENCE.revision + 1 }), false],
	] as const) {
		const value = vadContextFixture(speechFence);
		const store = createLocalAssistanceSessionStore(value);
		await store.load();
		store.selectSource('source-1');
		await runOperation(store, 'voice-activity-detection', VAD_MODEL.modelId);
		await runOperation(store, 'speech-recognition', MODEL.modelId);
		await store.prepareTranscriptCleanup();
		const request = value.cleanupRequests[0] as { voiceActivity: unknown };
		assert.equal(request.voiceActivity !== null, expectedVoiceActivity);
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
