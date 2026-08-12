/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTakeCycleCaptureOrchestrator,
	type TakeCycleCapturedLane,
} from '../src/common/editor/controller/take-cycle-capture-orchestrator.ts';
import { createTakeCycleCaptureSourceSpool } from '../src/common/editor/controller/take-cycle-capture-spool.ts';
import { createTakeCycleLiveCaptureSpool } from '../src/common/editor/controller/take-cycle-live-capture-spool.ts';
import type {
	TakeCycleFinalizationRequest,
	TakeCycleFinalizationResult,
	TakeCycleRecoveryRequest,
} from '../src/common/editor/controller/take-cycle-recording-service.ts';
import type { TakeCycleRecoveryEnvelope } from '../src/common/editor/take-cycle-recovery-envelope.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { SourceRepository } from '../src/common/editor/storage/source-repository.ts';
import { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const CHUNK_A = Float32Array.of(0, 0.25, 0.5, 0.75);
const CHUNK_B = Float32Array.of(1, 0.75, 0.5, 0.25);
const CHUNK_C = Float32Array.of(-0.25, -0.5);

test('capture orchestration durably spools a stream and exposes exact repository composition ports', async () => {
	const storage = storageFixture('memory');
	const fixture = orchestratorFixture(storage);
	const result = await fixture.orchestrator.finalize({
		projectId: 'project-cycle',
		loopStartSample: 100,
		loopEndSample: 108,
		lanes: [capturedLane('track-a', [CHUNK_A, CHUNK_B, CHUNK_C], 100)],
	});

	assert.deepEqual(result.lanes.map(({ status }) => status), ['committed']);
	assert.equal(fixture.finalizations.length, 1);
	const request = fixture.finalizations[0]!;
	assert.deepEqual(request.lanes[0]?.captureSpans, [
		{ startSample: 100, endSample: 104 },
		{ startSample: 104, endSample: 108 },
		{ startSample: 108, endSample: 110 },
	]);
	assert.equal(request.lanes[0]?.interrupted, true);
	assert.deepEqual(request.lanes[0]?.publications.map(({ byteLength }) => byteLength), [40, 12]);
	assert.match(request.lanes[0]?.publications[0]?.sha256 ?? '', /^[a-f0-9]{64}$/u);
	assert.deepEqual(fixture.ids, [
		'envelope', 'lane', 'take', 'media', 'journal', 'lane', 'take', 'media', 'journal',
	]);
	assert.deepEqual(fixture.targets, [{ trackId: 'track-a', sequenceId: 'main-sequence' }]);
	assert.deepEqual(fixture.descriptions.map(({ frameCount }) => frameCount), [8, 2]);
	assert.deepEqual(fixture.reads.get('media-4'), [[...CHUNK_A], [...CHUNK_B]]);
	assert.deepEqual(fixture.reads.get('media-8'), [[...CHUNK_C]]);
	assert.deepEqual(fixture.activated, [
		{ laneId: 'lane-2', takeId: 'take-3', mediaId: 'media-4' },
		{ laneId: 'lane-6', takeId: 'take-7', mediaId: 'media-8' },
	]);
	assert.equal(fixture.orchestrator.pendingCaptureCount, 0);
	assert.equal(await storage.sources.getMetadata('envelope-1'), null, 'settlement deletes exact draft metadata and PCM');
});

test('imperative live capture registers before recording and advances only after each awaited append', async () => {
	const storage = storageFixture('memory');
	const fixture = orchestratorFixture(storage);
	const session = await fixture.orchestrator.beginLiveSession({
		projectId: 'project-cycle',
		loopStartSample: 100, loopEndSample: 108,
	});
	const capture = await session.beginLane({
		groupId: 'group-track-a',
			trackId: 'track-a', sequenceId: 'main-sequence', name: 'track-a cycle',
			sampleRate: 48_000, channelCount: 1, chunkFrames: 4,
	});

	assert.equal(session.publicationGeneration, 1);
	assert.deepEqual(fixture.ids, ['envelope', 'lane']);
	assert.deepEqual((await storage.rawPcmSpools.list('project-cycle')).map(({ state, frameCount, chunkCount }) => ({
		state, frameCount, chunkCount,
	})), [{ state: 'capturing', frameCount: 0, chunkCount: 0 }]);
	await capture.append({ startSample: 100, endSample: 104, channels: [CHUNK_A] });
	assert.equal(capture.frameCount, 4);
	assert.deepEqual((await storage.rawPcmSpools.list('project-cycle')).map(({ frameCount, chunkCount, data }) => ({
		frameCount, chunkCount,
		captureSpans: (data as { readonly captureSpans: unknown }).captureSpans,
	})), [{ frameCount: 4, chunkCount: 1, captureSpans: [{ startSample: 100, endSample: 104 }] }]);
	await capture.seal();
	const result = await session.finalize();

	assert.deepEqual(result.lanes.map(({ status }) => status), ['committed']);
	assert.deepEqual(fixture.ids, ['envelope', 'lane', 'take', 'media', 'journal']);
	assert.deepEqual(fixture.reads.get('media-4'), [[...CHUNK_A]]);
	assert.deepEqual(await storage.rawPcmSpools.list('project-cycle'), []);
});

test('concurrent two-track lanes share one generation and finalize through separate groups', async () => {
	const storage = storageFixture('memory');
	const fixture = orchestratorFixture(storage, { failedLaneIds: new Set(['lane-2']) });
	const session = await fixture.orchestrator.beginLiveSession({
		projectId: 'project-cycle', loopStartSample: 0, loopEndSample: 4,
	});
	const captures = await Promise.all(['track-a', 'track-b'].map((trackId) => (
		session.beginLane({
			groupId: `group-${trackId}`,
			trackId, sequenceId: 'main-sequence', name: `${trackId} cycle`,
			sampleRate: 48_000, channelCount: 1, chunkFrames: 4,
		})
	)));
	const generations = (await storage.rawPcmSpools.list('project-cycle')).map(({ data }) => (
		(data as { readonly publicationGeneration: number }).publicationGeneration
	));
	assert.deepEqual(generations, [1, 1]);
	assert.equal(session.publicationGeneration, 1);
	await Promise.all(captures.map((capture, index) => capture.append({
		startSample: 0, endSample: 4, channels: [index ? CHUNK_B : CHUNK_A],
	})));
	await Promise.all(captures.map((capture) => capture.seal()));
	const result = await session.finalize();
	assert.deepEqual(result.lanes.map(({ status }) => status), ['failed', 'committed']);
	assert.deepEqual(fixture.activated.map(({ laneId }) => laneId), ['lane-4']);
	assert.deepEqual(fixture.finalizations.map(({ publicationGeneration, lanes }) => ({
		publicationGeneration, groupId: lanes[0]?.groupId,
	})), [
		{ publicationGeneration: 1, groupId: 'group-track-a' },
		{ publicationGeneration: 1, groupId: 'group-track-b' },
	]);
});

test('routed lane isolation activates only committed lanes and releases every settled draft', async () => {
	const storage = storageFixture('memory');
	const fixture = orchestratorFixture(storage, { failedLaneIds: new Set(['lane-2']) });
	const result = await fixture.orchestrator.finalize({
		projectId: 'project-cycle',
		loopStartSample: 0, loopEndSample: 4,
		lanes: [
			capturedLane('track-a', [CHUNK_A], 0),
			capturedLane('track-b', [CHUNK_B], 0),
		],
	});

	assert.deepEqual(result.lanes.map(({ status }) => status), ['failed', 'committed']);
	assert.deepEqual(fixture.activated, [{ laneId: 'lane-7', takeId: 'take-8', mediaId: 'media-9' }]);
	assert.equal(fixture.orchestrator.pendingCaptureCount, 0);
	assert.deepEqual(await storage.sources.list(), []);
});

test('an IndexedDB draft reopens with the same stable IDs and resumes before an envelope existed', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueName('cycle-capture-reopen');
	const firstStorage = storageFixture('indexeddb', indexedDB, databaseName);
	const interrupted = orchestratorFixture(firstStorage, { loseFirstFinalize: true });
	await assert.rejects(interrupted.orchestrator.finalize({
		projectId: 'project-cycle',
		loopStartSample: 100, loopEndSample: 108,
		lanes: [capturedLane('track-a', [CHUNK_A, CHUNK_B], 100)],
	}), /simulated process loss/u);
	assert.equal(interrupted.orchestrator.pendingCaptureCount, 1);
	assert.deepEqual((await firstStorage.rawPcmSpools.list('project-cycle')).map(({ spoolId, state }) => ({
		spoolId, state,
	})), [{ spoolId: 'envelope-1', state: 'sealed' }]);
	await firstStorage.close();

	const reopenedStorage = storageFixture('indexeddb', indexedDB, databaseName);
	const reopened = orchestratorFixture(reopenedStorage);
	const pending = await pendingRecovery(reopened.orchestrator);
	assert.equal(pending.publicationGeneration, 1);
	assert.equal(pending.draftCount, 1);
	const recovered = await reopened.orchestrator.recoverOnOpen({
		pending, decision: 'recover',
	});

	assert.equal(recovered.plan.disposition, 'clean');
	assert.deepEqual(recovered.resumedLanes.map(({ laneId, status }) => ({ laneId, status })), [
		{ laneId: 'lane-2', status: 'committed' },
	]);
	assert.deepEqual(reopened.finalizations[0]?.lanes[0]?.publications.map(({ takeId, mediaId, journalId }) => ({
		takeId, mediaId, journalId,
	})), [{ takeId: 'take-3', mediaId: 'media-4', journalId: 'journal-5' }]);
	assert.deepEqual(reopened.reads.get('media-4'), [[...CHUNK_A], [...CHUNK_B]]);
	assert.deepEqual(reopened.activated, [{ laneId: 'lane-2', takeId: 'take-3', mediaId: 'media-4' }]);
	assert.deepEqual(await reopenedStorage.rawPcmSpools.list('project-cycle'), []);
	assert.equal(reopened.orchestrator.pendingCaptureCount, 0);
	await reopenedStorage.close();
});

test('two crashed routed groups reopen under one exact generation and resume independently', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueName('cycle-capture-two-group-reopen');
	const firstStorage = storageFixture('indexeddb', indexedDB, databaseName);
	const first = orchestratorFixture(firstStorage, { loseFirstFinalize: true });
	const session = await first.orchestrator.beginLiveSession({
		projectId: 'project-cycle', loopStartSample: 0, loopEndSample: 4,
	});
	const captures = await Promise.all(['track-a', 'track-b'].map((trackId) => session.beginLane({
		groupId: `group-${trackId}`,
		trackId, sequenceId: 'main-sequence', name: `${trackId} cycle`,
		sampleRate: 48_000, channelCount: 1, chunkFrames: 4,
	})));
	await Promise.all(captures.map((capture, index) => capture.append({
		startSample: 0, endSample: 4, channels: [index ? CHUNK_B : CHUNK_A],
	})));
	await Promise.all(captures.map((capture) => capture.seal()));
	await assert.rejects(session.finalize(), /simulated process loss/u);
	await firstStorage.close();

	const reopenedStorage = storageFixture('indexeddb', indexedDB, databaseName);
	const reopened = orchestratorFixture(reopenedStorage);
	const pending = await pendingRecovery(reopened.orchestrator);
	assert.equal(pending.publicationGeneration, 1);
	assert.equal(pending.draftCount, 2);
	const result = await reopened.orchestrator.recoverOnOpen({ pending, decision: 'recover' });
	assert.deepEqual(result.resumedLanes.map(({ groupId, status }) => ({ groupId, status })), [
		{ groupId: 'group-track-a', status: 'committed' },
		{ groupId: 'group-track-b', status: 'committed' },
	]);
	assert.deepEqual(await reopenedStorage.rawPcmSpools.list('project-cycle'), []);
	await reopenedStorage.close();
});

test('an already committed routed writer is adopted without duplicating PCM and reopens exactly', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueName('cycle-capture-adopt');
	const firstStorage = storageFixture('indexeddb', indexedDB, databaseName);
	const interrupted = orchestratorFixture(firstStorage, { loseFirstFinalize: true });
	const draftId = interrupted.orchestrator.createCaptureSpoolId();
	const writer = await firstStorage.sources.beginWrite(draftId, {
		name: 'track-a cycle', sampleRate: 48_000, channelCount: 1, chunkFrames: 4,
	});
	await writer.write([CHUNK_A]);
	await writer.write([CHUNK_B]);
	const committed = await writer.commit();
	const sourceToken = committed.sourceToken;
	await assert.rejects(interrupted.orchestrator.finalize({
		projectId: 'project-cycle',
		loopStartSample: 100, loopEndSample: 108,
		lanes: [committedLane('track-a', draftId, [
			{ startSample: 100, endSample: 104 }, { startSample: 104, endSample: 108 },
		])],
	}), /simulated process loss/u);
	assert.equal((await firstStorage.sources.getMetadata('envelope-1'))?.sourceToken, sourceToken);
	await firstStorage.close();

	const reopenedStorage = storageFixture('indexeddb', indexedDB, databaseName);
	const reopened = orchestratorFixture(reopenedStorage);
	const pending = await pendingRecovery(reopened.orchestrator);
	await reopened.orchestrator.recoverOnOpen({
		pending, decision: 'recover',
	});
	assert.deepEqual(reopened.reads.get('media-4'), [[...CHUNK_A], [...CHUNK_B]]);
	assert.equal(await reopenedStorage.sources.getMetadata('envelope-1'), null);
	await reopenedStorage.close();
});

test('oversized routed chunks fail closed before PCM can become a durable draft', async () => {
	const storage = storageFixture('memory');
	const fixture = orchestratorFixture(storage);
	const oversizedChannel = new Float32Array(32_769);
	await assert.rejects(fixture.orchestrator.finalize({
		projectId: 'project-cycle',
		loopStartSample: 0, loopEndSample: 32_769,
		lanes: [{
			groupId: 'group-track-a',
			trackId: 'track-a', sequenceId: 'main-sequence', name: 'Oversized cycle',
			sampleRate: 48_000, channelCount: 64, chunkFrames: 65_536,
			capture: { kind: 'stream', spans: spans([{ startSample: 0, channels: Array(64).fill(oversizedChannel) }]) },
		}],
	}), /strict memory bound/u);
	assert.equal(fixture.finalizations.length, 0);
	assert.equal(fixture.orchestrator.pendingCaptureCount, 0);
	assert.deepEqual(await storage.sources.list(), []);
});

test('a later routed lane spool failure exactly removes already prepared lane drafts', async () => {
	const storage = storageFixture('memory');
	const fixture = orchestratorFixture(storage);
	await assert.rejects(fixture.orchestrator.finalize({
		projectId: 'project-cycle',
		loopStartSample: 0, loopEndSample: 4,
		lanes: [
			capturedLane('track-a', [CHUNK_A], 0),
			{
				...capturedLane('track-b', [CHUNK_B], 0),
				capture: { kind: 'stream', spans: spans([{ startSample: 1, channels: [CHUNK_B] }]) },
			},
		],
	}), /positive.*contiguous/u);
	assert.equal(fixture.finalizations.length, 0);
	assert.equal(fixture.orchestrator.pendingCaptureCount, 0);
	assert.deepEqual(await storage.sources.list(), []);
});

test('open inspection surfaces an envelope as pending without silently choosing recovery', async () => {
	const storage = storageFixture('memory');
	const fixture = orchestratorFixture(storage, { recoveryEnvelopeGeneration: 7 });
	const pending = await pendingRecovery(fixture.orchestrator);
	assert.equal(pending.publicationGeneration, 7);
	assert.equal(pending.draftCount, 0);
	assert.match(pending.recoveryToken, /^take-cycle-open-recovery-v1:[a-f0-9]{64}$/u);
	assert.deepEqual(fixture.recoveries, [], 'inspection never makes the recover/discard choice');
});

test('open inspection rejects contradictory durable spool and envelope generations', async () => {
	const storage = storageFixture('memory');
	const fixture = orchestratorFixture(storage, { recoveryEnvelopeGeneration: 8 });
	const session = await fixture.orchestrator.beginLiveSession({
		projectId: 'project-cycle',
		loopStartSample: 0, loopEndSample: 4,
	});
	await session.beginLane({
		groupId: 'group-track-a',
			trackId: 'track-a', sequenceId: 'main-sequence', name: 'track-a cycle',
			sampleRate: 48_000, channelCount: 1, chunkFrames: 4,
	});
	await assert.rejects(
		fixture.orchestrator.inspectOpenRecovery({ projectId: 'project-cycle' }),
		/contradictory publication generations/u,
	);
});

test('a crash mid-write reopens the exact durable prefix as an interrupted recover-or-discard choice', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueName('cycle-capture-mid-write');
	const firstStorage = storageFixture('indexeddb', indexedDB, databaseName);
	const first = orchestratorFixture(firstStorage);
	await assert.rejects(first.orchestrator.finalize({
		projectId: 'project-cycle',
		loopStartSample: 100, loopEndSample: 108,
		lanes: [capturedLaneWithCrash('track-a', CHUNK_A)],
	}), /simulated capture crash/u);
	const prefix = await firstStorage.rawPcmSpools.list('project-cycle');
	assert.deepEqual(prefix.map(({ state, frameCount, chunkCount }) => ({ state, frameCount, chunkCount })), [{
		state: 'capturing', frameCount: 4, chunkCount: 1,
	}]);
	await firstStorage.close();

	const reopenedStorage = storageFixture('indexeddb', indexedDB, databaseName);
	const reopened = orchestratorFixture(reopenedStorage);
	const pending = await pendingRecovery(reopened.orchestrator);
	assert.equal(pending.publicationGeneration, 1);
	assert.equal(pending.draftCount, 1);
	await assert.rejects(reopened.orchestrator.recoverOnOpen({
		pending: Object.freeze({ ...pending, recoveryToken: `${pending.recoveryToken}-stale` }),
		decision: 'recover',
	}), /authority is stale/u);
	const recovered = await reopened.orchestrator.recoverOnOpen({
		pending, decision: 'recover',
	});
	assert.deepEqual(recovered.resumedLanes.map(({ status }) => status), ['committed']);
	assert.equal(reopened.finalizations[0]?.lanes[0]?.interrupted, true);
	const recoveredMediaId = reopened.finalizations[0]?.lanes[0]?.publications[0]?.mediaId;
	assert.ok(recoveredMediaId);
	assert.deepEqual(reopened.reads.get(recoveredMediaId), [[...CHUNK_A]]);
	assert.deepEqual(await reopenedStorage.rawPcmSpools.list('project-cycle'), []);
	await reopenedStorage.close();

	const discardedStorage = storageFixture('indexeddb', createInstrumentedIndexedDB(), uniqueName('cycle-discard'));
	const crashing = orchestratorFixture(discardedStorage);
	await assert.rejects(crashing.orchestrator.finalize({
		projectId: 'project-cycle',
		loopStartSample: 100, loopEndSample: 108,
		lanes: [capturedLaneWithCrash('track-a', CHUNK_A)],
	}), /simulated capture crash/u);
	const discarded = orchestratorFixture(discardedStorage);
	const discardPending = await pendingRecovery(discarded.orchestrator);
	const outcome = await discarded.orchestrator.recoverOnOpen({
		pending: discardPending, decision: 'discard',
	});
	assert.deepEqual(outcome.resumedLanes, []);
	assert.deepEqual(discarded.finalizations, []);
	assert.deepEqual(await discardedStorage.rawPcmSpools.list('project-cycle'), []);
	await discardedStorage.close();
});

test('incomplete envelope cleanup never reuses stale media bindings over the durable raw draft', async () => {
	const storage = storageFixture('memory'), first = orchestratorFixture(storage, { loseFirstFinalize: true });
	await assert.rejects(first.orchestrator.finalize({
		projectId: 'project-cycle', loopStartSample: 0, loopEndSample: 4, lanes: [capturedLane('track-a', [CHUNK_A], 0)],
	}), /simulated process loss/u);
	const draft = (await first.orchestrator.inspectOpenRecovery({ projectId: 'project-cycle' }))!, lane = ((await storage.rawPcmSpools.list('project-cycle'))[0]!.data as { readonly draft: { readonly lane: { readonly groupId: string; readonly laneId: string; readonly publications: readonly Readonly<{ readonly takeId: string; readonly mediaId: string; readonly byteLength: number; readonly sha256: string }>[] } } }).draft.lane, publication = lane.publications[0]!;
	const reopened = orchestratorFixture(storage, { recoveryEnvelopeGeneration: draft.publicationGeneration, recoveryDisposition: 'cleanup-incomplete', recoveredBindings: [Object.freeze({ generation: draft.publicationGeneration, groupId: lane.groupId, laneId: lane.laneId, ...publication })] });
	const pending = await pendingRecovery(reopened.orchestrator), outcome = await reopened.orchestrator.recoverOnOpen({ pending, decision: 'recover' });
	assert.equal(outcome.plan.disposition, 'cleanup-incomplete'); assert.deepEqual(outcome.resumedLanes.map(({ status }) => status), ['committed']);
	assert.equal(outcome.activatedMedia.length, 1); assert.equal(reopened.finalizations.length, 1);
	assert.deepEqual(await storage.rawPcmSpools.list('project-cycle'), []);
});

interface FixtureOptions {
	readonly failedLaneIds?: ReadonlySet<string>;
	readonly recoveryEnvelopeGeneration?: number;
	readonly loseFirstFinalize?: boolean;
	readonly recoveryDisposition?: 'clean' | 'cleanup-incomplete';
	readonly recoveredBindings?: readonly import('../src/common/editor/take-media-recovery-journal.ts').TakeMediaPublicationBinding[];
}

function orchestratorFixture(storage: ReturnType<typeof storageFixture>, options: FixtureOptions = {}) {
	const { sources } = storage;
	const ids: string[] = [];
	let identity = 0;
	let lost = false;
	const finalizations: TakeCycleFinalizationRequest[] = [];
	const recoveries: TakeCycleRecoveryRequest[] = [];
	const activated: Array<{ laneId: string; takeId: string; mediaId: string }> = [];
	const targets: Array<{ trackId: string; sequenceId: string }> = [];
	const descriptions: Array<{ frameCount: number }> = [];
	const reads = new Map<string, number[][]>();
	const holder: { orchestrator?: ReturnType<typeof createTakeCycleCaptureOrchestrator> } = {};
	const service = {
		async finalize(request: TakeCycleFinalizationRequest): Promise<TakeCycleFinalizationResult> {
			finalizations.push(request);
			if (options.loseFirstFinalize && !lost) {
				lost = true;
				throw new Error('simulated process loss');
			}
			for (const lane of request.lanes) {
				const orchestrator = holder.orchestrator;
				if (!orchestrator) throw new Error('Test orchestrator is unavailable.');
				targets.push(orchestrator.resolveLaneTarget(lane.laneId));
				for (const publication of lane.publications) {
					descriptions.push(orchestrator.describeSource(publication.mediaId));
					const captured: number[][] = [];
					for await (const chunk of orchestrator.readPassChunks(publication.mediaId)) {
						captured.push([...chunk[0]!]);
					}
					reads.set(publication.mediaId, captured);
				}
			}
			return finalizationResult(request, options.failedLaneIds ?? new Set());
		},
		async recover(request: TakeCycleRecoveryRequest) {
			recoveries.push(request);
			return {
				kind: 'take-cycle-envelope-recovery' as const,
				disposition: options.recoveryDisposition ?? 'clean',
				envelopeId: null,
				generation: request.currentGeneration,
				actions: [],
			};
		},
		cancel() { /* test facade */ },
	};
	const orchestrator = createTakeCycleCaptureOrchestrator({
		service,
		spool: createTakeCycleCaptureSourceSpool(
			sources,
			createTakeCycleLiveCaptureSpool(storage.rawPcmSpools),
		),
		loadRecoveryEnvelope: (projectId) => options.recoveryEnvelopeGeneration == null
			? null
			: recoveryEnvelopeAuthority(projectId, options.recoveryEnvelopeGeneration),
		createId(prefix) { ids.push(prefix); identity += 1; return `${prefix}-${String(identity)}`; },
		async activateCommittedSource(media) { activated.push(media); },
		listRecoveredMedia: async () => options.recoveredBindings ?? [],
	});
	holder.orchestrator = orchestrator;
	return { orchestrator, ids, finalizations, recoveries, activated, targets, descriptions, reads };
}

function capturedLane(
	trackId: string,
	chunks: readonly Float32Array[],
	startSample: number,
): TakeCycleCapturedLane {
	return {
		groupId: `group-${trackId}`,
		trackId,
		sequenceId: 'main-sequence',
		name: `${trackId} cycle`,
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 4,
		capture: {
			kind: 'stream',
			spans: spans(chunks.map((channels, index) => ({
				startSample: startSample + index * 4,
				channels: [channels],
			}))),
		},
	};
}

function committedLane(
	trackId: string,
	draftId: string,
	captureSpans: readonly { readonly startSample: number; readonly endSample: number }[],
): TakeCycleCapturedLane {
	return {
		groupId: `group-${trackId}`,
		trackId,
		sequenceId: 'main-sequence',
		name: `${trackId} cycle`,
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 4,
		capture: { kind: 'committed', spool: { draftId, captureSpans } },
	};
}

function capturedLaneWithCrash(trackId: string, first: Float32Array): TakeCycleCapturedLane {
	return {
		...capturedLane(trackId, [first], 100),
		capture: {
			kind: 'stream',
			spans: (async function* () {
				yield { startSample: 100, endSample: 104, channels: [first] };
				throw new Error('simulated capture crash');
			})(),
		},
	};
}

async function* spans(values: readonly Readonly<{
	startSample: number;
	channels: readonly Float32Array[];
}>[]): AsyncGenerator<Readonly<{ startSample: number; endSample: number; channels: readonly Float32Array[] }>> {
	for (const value of values) {
		yield {
			...value,
			endSample: value.startSample + value.channels[0]!.length,
		};
	}
}

function finalizationResult(
	request: TakeCycleFinalizationRequest,
	failedLaneIds: ReadonlySet<string>,
): TakeCycleFinalizationResult {
	return {
		kind: 'take-cycle-finalization',
		generation: request.publicationGeneration,
		lanes: request.lanes.map((lane) => {
			const failed = failedLaneIds.has(lane.laneId);
			return {
				groupId: lane.groupId,
				laneId: lane.laneId,
				status: failed ? 'failed' as const : 'committed' as const,
				committedPasses: failed ? [] : lane.publications.map((publication) => ({
					generation: request.publicationGeneration,
					groupId: lane.groupId,
					laneId: publication.laneId,
					takeId: publication.takeId,
					mediaId: publication.mediaId,
					byteLength: publication.byteLength,
					sha256: publication.sha256,
				})),
				error: failed ? new Error('lane failed') : null,
			};
		}),
	};
}

function storageFixture(
	backend: 'memory' | 'indexeddb',
	indexedDB = createInstrumentedIndexedDB(),
	databaseName = uniqueName(`cycle-capture-${backend}`),
) {
	const store = createProjectStore({
		indexedDB: backend === 'indexeddb' ? indexedDB : null,
		preferOpfs: false,
		databaseName,
	});
	return {
		sources: store.sourceRepository as SourceRepository,
		rawPcmSpools: store.rawPcmSpoolRepository as RawPcmSpoolRepository,
		close: () => store.close(),
	};
}

async function pendingRecovery(
	orchestrator: ReturnType<typeof createTakeCycleCaptureOrchestrator>,
) {
	const pending = await orchestrator.inspectOpenRecovery({ projectId: 'project-cycle' });
	assert.ok(pending);
	return pending;
}

function recoveryEnvelopeAuthority(projectId: string, generation: number): TakeCycleRecoveryEnvelope {
	return {
		version: 1,
		envelopeId: 'recovery-envelope',
		state: 'staged',
		generation,
		captureRequest: {
			groupId: 'group-envelope', laneId: 'lane-envelope',
			laneIds: ['lane-envelope'],
			loopStartSample: 0, loopEndSample: 4,
			captureSpans: [{ startSample: 0, endSample: 4 }],
			takeIds: ['take-envelope'], interrupted: false,
		},
		entries: [],
		projectFence: {
			projectId, baseRevision: 0, baseSha256: '0'.repeat(64),
			targetRevision: 1, targetSha256: '1'.repeat(64),
		},
		targetProjectDocument: '{}',
	};
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
