/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTakeCycleCaptureOrchestrator } from '../src/common/editor/controller/take-cycle-capture-orchestrator.ts';
import type { TakeCycleCaptureDraft } from '../src/common/editor/controller/take-cycle-capture-spool.ts';
import type {
	TakeCycleFinalizationRequest,
	TakeCycleFinalizationResult,
} from '../src/common/editor/controller/take-cycle-recording-service.ts';

test('mixed envelope cleanup cannot activate stale cached bindings instead of resuming its raw draft', async () => {
	const draft = captureDraft();
	const publication = draft.lane.publications[0]!;
	const finalizations: TakeCycleFinalizationRequest[] = [];
	const activated: string[] = [];
	const orchestrator = createTakeCycleCaptureOrchestrator({
		service: {
			async finalize(request) {
				finalizations.push(request);
				return committedResult(request);
			},
			async recover(request) {
				return Object.freeze({
					kind: 'take-cycle-envelope-recovery' as const,
					disposition: 'cleanup-incomplete' as const,
					envelopeId: draft.lane.envelopeId,
					generation: request.currentGeneration,
					actions: Object.freeze([]),
				});
			},
			cancel() {},
		},
		spool: {
			allocateGeneration: async () => 1,
			beginLive: () => { throw new Error('not used'); },
			persist: () => { throw new Error('not used'); },
			list: async () => [draft],
			inspect: async () => ({ drafts: [draft], capturing: [], capturingCount: 0 }),
			resolveOpenCaptures: async () => [],
			readPass: () => { throw new Error('not used'); },
			remove: async () => true,
		},
		loadRecoveryEnvelope: async () => ({
			version: 1, envelopeId: draft.lane.envelopeId, state: 'staged', generation: 7,
			captureRequest: {
				groupId: draft.lane.groupId, laneId: draft.lane.laneId, laneIds: [publication.laneId],
				loopStartSample: 0, loopEndSample: 4,
				captureSpans: [{ startSample: 0, endSample: 4 }],
				takeIds: [publication.takeId], interrupted: false,
			},
			entries: [],
			projectFence: {
				projectId: draft.projectId, baseRevision: 0, baseSha256: '0'.repeat(64),
				targetRevision: 1, targetSha256: '1'.repeat(64),
			},
			targetProjectDocument: '{}',
		}),
		createId: (prefix) => `${prefix}-fresh`,
		activateCommittedSource: ({ mediaId }) => { activated.push(mediaId); },
		listRecoveredMedia: async () => [{
			generation: 7, groupId: draft.lane.groupId, laneId: publication.laneId,
			takeId: publication.takeId, mediaId: publication.mediaId,
			byteLength: publication.byteLength, sha256: publication.sha256,
		}],
	});
	const pending = await orchestrator.inspectOpenRecovery({ projectId: draft.projectId });
	assert.ok(pending);
	const result = await orchestrator.recoverOnOpen({ pending, decision: 'recover' });

	assert.equal(finalizations.length, 1);
	assert.deepEqual(result.resumedLanes.map(({ status }) => status), ['committed']);
	assert.deepEqual(activated, [publication.mediaId]);
});

function captureDraft(): TakeCycleCaptureDraft {
	return {
		version: 1, draftId: 'envelope-a', draftToken: 'token-a', projectId: 'project-cycle',
		publicationGeneration: 7,
		lane: {
			envelopeId: 'envelope-a', groupId: 'group-cycle', laneId: 'lane-a',
			loopStartSample: 0, loopEndSample: 4,
			captureSpans: [{ startSample: 0, endSample: 4 }], interrupted: false,
			publications: [{
				journalId: 'journal-a', laneId: 'lane-a', takeId: 'take-a', mediaId: 'media-a',
				byteLength: 20, sha256: 'ab'.repeat(32),
			}],
		},
		target: { trackId: 'track-a', sequenceId: 'main-sequence' },
		sources: [{
			mediaId: 'media-a', name: 'Cycle', sampleRate: 48_000,
			channelCount: 1, chunkFrames: 4, frameCount: 4,
		}],
	};
}

function committedResult(request: TakeCycleFinalizationRequest): TakeCycleFinalizationResult {
	const lane = request.lanes[0]!;
	return {
		kind: 'take-cycle-finalization', generation: request.publicationGeneration,
		lanes: [{
			groupId: lane.groupId, laneId: lane.laneId, status: 'committed', error: null,
			committedPasses: lane.publications.map((publication) => ({
				generation: request.publicationGeneration,
				groupId: lane.groupId,
				laneId: publication.laneId,
				takeId: publication.takeId,
				mediaId: publication.mediaId,
				byteLength: publication.byteLength,
				sha256: publication.sha256,
			})),
		}],
	};
}
