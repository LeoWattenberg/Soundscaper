/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTakeCycleCaptureOrchestrator } from '../src/common/editor/controller/recording/take-cycle-capture-orchestrator.ts';
import { createTakeCycleCaptureSourceSpool } from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-capture-spool.ts';
import { createTakeCycleLiveCaptureSpool } from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-live-capture-spool.ts';
import type {
	TakeCycleFinalizationRequest,
	TakeCycleFinalizationResult,
	TakeCycleRecoveryRequest,
} from '../src/common/editor/controller/recording/take-cycle-recording-service.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { SourceRepository } from '../src/common/editor/storage/source-repository.ts';
import type { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROJECT_ID = 'recovery-retry-project';
const PCM = Float32Array.of(0, 0.25, 0.5, 0.75);

test('a failed recovery resume retains its draft and PCM through another IndexedDB reopen', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `take-cycle-retry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	const open = () => createProjectStore({ indexedDB, preferOpfs: false, databaseName });

	const firstStore = open();
	const first = recoveryFixture(firstStore, 'interrupt');
	await assert.rejects(first.finalize({
		projectId: PROJECT_ID, loopStartSample: 0, loopEndSample: 4,
		lanes: [{
			groupId: 'group-a', trackId: 'track-a', sequenceId: 'main-sequence',
			name: 'take', sampleRate: 48_000, channelCount: 1, chunkFrames: 4,
			capture: { kind: 'stream', spans: (async function* () {
				yield { startSample: 0, endSample: 4, channels: [PCM] };
			})() },
		}],
	}), /simulated process loss/u);
	await firstStore.close();

	const failedStore = open();
	const failed = recoveryFixture(failedStore, 'fail');
	const pending = await failed.inspectOpenRecovery({ projectId: PROJECT_ID });
	assert.ok(pending);
	const attempt = await failed.recoverOnOpen({ pending, decision: 'recover' });
	assert.deepEqual(attempt.resumedLanes.map(({ status }) => status), ['failed']);
	assert.equal(failed.pendingCaptureCount, 1);
	assert.deepEqual((await failedStore.rawPcmSpoolRepository!.list(PROJECT_ID)).map(({ spoolId }) => spoolId), ['envelope-1']);
	await failedStore.close();

	const retryStore = open();
	const read: number[][] = [];
	const retry = recoveryFixture(retryStore, 'commit', read);
	const retryPending = await retry.inspectOpenRecovery({ projectId: PROJECT_ID });
	assert.ok(retryPending);
	assert.equal(retryPending.draftCount, 1);
	const recovered = await retry.recoverOnOpen({ pending: retryPending, decision: 'recover' });
	assert.deepEqual(recovered.resumedLanes.map(({ status }) => status), ['committed']);
	assert.deepEqual(read, [[...PCM]]);
	assert.deepEqual(await retryStore.rawPcmSpoolRepository!.list(PROJECT_ID), []);
	await retryStore.close();
});

function recoveryFixture(
	store: ReturnType<typeof createProjectStore>,
	mode: 'interrupt' | 'fail' | 'commit',
	read: number[][] = [],
) {
	let nextId = 0;
	const holder: { orchestrator?: ReturnType<typeof createTakeCycleCaptureOrchestrator> } = {};
	const service = {
		async finalize(request: TakeCycleFinalizationRequest): Promise<TakeCycleFinalizationResult> {
			if (mode === 'interrupt') throw new Error('simulated process loss');
			const lane = request.lanes[0]!;
			if (mode === 'commit') {
				const orchestrator = holder.orchestrator;
				if (!orchestrator) throw new Error('Recovery test orchestrator is unavailable.');
				for (const publication of lane.publications) {
					for await (const chunk of orchestrator.readPassChunks(publication.mediaId)) {
						read.push([...chunk[0]!]);
					}
				}
			}
			return {
				kind: 'take-cycle-finalization', generation: request.publicationGeneration,
				lanes: [{
					groupId: lane.groupId, laneId: lane.laneId,
					status: mode === 'fail' ? 'failed' : 'committed',
					committedPasses: mode === 'fail' ? [] : lane.publications.map((publication) => ({
						generation: request.publicationGeneration, groupId: lane.groupId, laneId: publication.laneId,
						takeId: publication.takeId, mediaId: publication.mediaId,
						byteLength: publication.byteLength, sha256: publication.sha256,
					})),
					error: mode === 'fail' ? new Error('temporary project read failure') : null,
				}],
			};
		},
		async recover(request: TakeCycleRecoveryRequest) {
			return {
				kind: 'take-cycle-envelope-recovery' as const, disposition: 'clean' as const,
				envelopeId: null, generation: request.currentGeneration, actions: [],
			};
		},
		cancel() {},
	};
	const orchestrator = createTakeCycleCaptureOrchestrator({
		service,
		spool: createTakeCycleCaptureSourceSpool(
			store.sourceRepository as SourceRepository,
			createTakeCycleLiveCaptureSpool(store.rawPcmSpoolRepository as RawPcmSpoolRepository),
		),
		loadRecoveryEnvelope: () => null,
		createId(prefix) { nextId += 1; return `${prefix}-${String(nextId)}`; },
		activateCommittedSource() {},
		listRecoveredMedia: () => [],
	});
	holder.orchestrator = orchestrator;
	return orchestrator;
}
