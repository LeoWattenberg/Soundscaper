/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTakeCycleCaptureSourceSpool } from '../src/common/editor/controller/take-cycle-capture-spool.ts';
import { beginTakeCycleLiveCaptureSession } from '../src/common/editor/controller/take-cycle-live-capture-session.ts';
import { createTakeCycleLiveCaptureSpool } from '../src/common/editor/controller/take-cycle-live-capture-spool.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import {
	RawPcmSpoolRepository,
	type RawPcmSpoolRecord,
} from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';

const PCM = Float32Array.of(0.25, -0.25, 0.5, -0.5);

test('take-cycle recovery ignores every foreign raw PCM spool without parsing or removal', async () => {
	const { repository } = rawFixture('cycle-foreign-spools');
	const framescaperOwner = Object.freeze({
		version: 1, kind: 'framescaper-capture-raw-pcm',
		sessionId: 'session-capture', streamId: 'microphone-stream',
		sourceId: 'microphone-source', role: 'microphone',
	});
	const empty = await repository.create({
		...rawRequest('framescaper-empty'), data: framescaperOwner,
	});
	let sealed = await repository.create({
		...rawRequest('framescaper-sealed'), data: framescaperOwner,
	});
	sealed = await repository.append(sealed, [PCM], framescaperOwner);
	sealed = await repository.seal(sealed, framescaperOwner);
	const unknown = await repository.create({
		...rawRequest('unknown-owner'), data: { kind: 'another-raw-pcm-owner' },
	});
	const spool = createTakeCycleLiveCaptureSpool(repository);

	assert.deepEqual(await spool.inspect('project-cycle'), {
		drafts: [], capturing: [], capturingCount: 0,
	});
	assert.deepEqual(await spool.resolve('project-cycle', 'recover', passIdentities), []);
	assert.deepEqual(await spool.resolve('project-cycle', 'discard', passIdentities), []);
	assert.deepEqual(await repository.load('project-cycle', empty.spoolId), empty);
	assert.deepEqual(await repository.load('project-cycle', sealed.spoolId), sealed);
	assert.deepEqual(await repository.load('project-cycle', unknown.spoolId), unknown);
});

test('malformed take-cycle-owned intent and draft spools fail closed before discard', async () => {
	for (const kind of ['take-cycle-live-capture-intent-v1', 'take-cycle-live-capture-draft-v1']) {
		const { repository } = rawFixture(`cycle-malformed-${kind}`);
		const owned = await repository.create({
			...rawRequest(`malformed-${kind}`), data: { kind },
		});
		const spool = createTakeCycleLiveCaptureSpool(repository);

		await assert.rejects(spool.inspect('project-cycle'), /take cycle|live capture/iu, kind);
		await assert.rejects(
			spool.resolve('project-cycle', 'recover', passIdentities),
			/take cycle|live capture/iu,
			kind,
		);
		await assert.rejects(
			spool.resolve('project-cycle', 'discard', passIdentities),
			/take cycle|live capture/iu,
			kind,
		);
		assert.deepEqual(await repository.load('project-cycle', owned.spoolId), owned, kind);
	}
});

test('raw spool discard durably settles exact ownership before PCM reclamation and is idempotent', async () => {
	const memory = getMemoryDatabase(uniqueName('cycle-discard-order'));
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const chunks = new SourceRecordRepository(port);
	const owner: { repository?: RawPcmSpoolRepository } = {};
	const observation: { settledBeforeDelete: RawPcmSpoolRecord | null } = { settledBeforeDelete: null };
	const repository = new RawPcmSpoolRepository(values, {
		writeChunk: chunks.writeChunk.bind(chunks),
		chunk: chunks.chunk.bind(chunks),
		async deleteChunks(sourceToken) {
			observation.settledBeforeDelete = await owner.repository!.load('project-cycle', 'lane-envelope');
			await chunks.deleteChunks(sourceToken);
		},
	});
	owner.repository = repository;
	let capture = await repository.create(rawRequest('lane-envelope'));
	capture = await repository.append(capture, [PCM], { phase: 'capturing', spanCount: 1 });
	const outcome = Object.freeze({ kind: 'take-cycle-live-capture-discard-v1', generation: 7 });

	assert.equal(await repository.discard(capture, outcome), true);
	assert.equal(observation.settledBeforeDelete?.state, 'discarded');
	assert.deepEqual(observation.settledBeforeDelete?.data, outcome);
	assert.equal(await repository.load('project-cycle', 'lane-envelope'), null);
	assert.equal(memory.sourceChunks.size, 0);
	assert.equal(await repository.discard(capture, outcome), true, 'settled exact ownership is idempotent');
});

test('raw spool discard refuses stale, sealed, and contradictory ownership', async () => {
	const { repository } = rawFixture('cycle-discard-refusal');
	const stale = await repository.create(rawRequest('stale-envelope'));
	const current = await repository.append(stale, [PCM], { phase: 'capturing', spanCount: 1 });
	assert.equal(await repository.discard(stale, { outcome: 'failed' }), false);
	assert.deepEqual(await repository.load('project-cycle', 'stale-envelope'), current);

	let sealed = await repository.create(rawRequest('sealed-envelope'));
	sealed = await repository.append(sealed, [PCM], { phase: 'capturing', spanCount: 1 });
	sealed = await repository.seal(sealed, { phase: 'sealed' });
	assert.equal(await repository.discard(sealed, { outcome: 'failed' }), false);
	assert.equal((await repository.load('project-cycle', 'sealed-envelope'))?.state, 'sealed');

	const firstOutcome = { kind: 'take-cycle-live-capture-discard-v1', generation: 3 };
	const memory = getMemoryDatabase(uniqueName('cycle-discard-crash'));
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const chunks = new SourceRecordRepository(port);
	const crashRepository = new RawPcmSpoolRepository(values, {
		writeChunk: chunks.writeChunk.bind(chunks),
		chunk: chunks.chunk.bind(chunks),
		deleteChunks: async () => { throw new Error('simulated reclamation crash'); },
	});
	let crashCapture = await crashRepository.create(rawRequest('crash-envelope'));
	crashCapture = await crashRepository.append(crashCapture, [PCM], { phase: 'capturing', spanCount: 1 });
	await assert.rejects(crashRepository.discard(crashCapture, firstOutcome), /reclamation crash/u);
	const durableOutcome = await crashRepository.load('project-cycle', 'crash-envelope');
	assert.equal(durableOutcome?.state, 'discarded');
	assert.deepEqual(durableOutcome?.data, firstOutcome);
	assert.equal(await crashRepository.discard(crashCapture, { ...firstOutcome, generation: 4 }), false);
	const reopened = new RawPcmSpoolRepository(values, chunks);
	assert.deepEqual(await createTakeCycleLiveCaptureSpool(reopened).inspect('project-cycle'), {
		drafts: [], capturing: [], capturingCount: 0,
	});
	assert.equal(await reopened.load('project-cycle', 'crash-envelope'), null);
});

test('live lane discard is session-owned, restart-invisible, and refuses a sealed lane', async () => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: uniqueName('live-discard') });
	const raw = store.rawPcmSpoolRepository as RawPcmSpoolRepository;
	const spool = createTakeCycleCaptureSourceSpool(
		store.sourceRepository,
		createTakeCycleLiveCaptureSpool(raw),
	);
	let identity = 0;
	const session = await beginTakeCycleLiveCaptureSession({
		projectId: 'project-cycle', loopStartSample: 100, loopEndSample: 108,
	}, {
		spool,
		createId: (prefix) => `${prefix}-${String(++identity)}`,
		onDraft() {},
		finalizeDrafts: async () => { throw new Error('not reached'); },
	});
	const failed = await session.beginLane(lane('group-a', 'track-a'));
	await failed.append({ startSample: 100, endSample: 104, channels: [PCM] });
	await failed.discard();
	await failed.discard();
	assert.equal(session.pendingLaneCount, 0);
	assert.deepEqual(await spool.inspect('project-cycle'), {
		drafts: [], capturing: [], capturingCount: 0,
	});

	const sealed = await session.beginLane(lane('group-b', 'track-b'));
	await sealed.append({ startSample: 100, endSample: 104, channels: [PCM] });
	await sealed.seal();
	await assert.rejects(sealed.discard(), /sealed/u);
	await store.close();
});

test('a live seal that fails leaves its lane discardable so the surviving lane still finalizes', async () => {
	for (const failing of ['seal', 'replaceData'] as const) {
		const port = { memory: getMemoryDatabase(uniqueName(`cycle-${failing}-failure`)), database: async () => null };
		const repository = new SealFaultRepository(
			new KeyValueRepository(port, 'analysis'), new SourceRecordRepository(port), failing,
		);
		const live = createTakeCycleLiveCaptureSpool(repository);
		let identity = 0;
		const finalized: string[] = [];
		const session = await beginTakeCycleLiveCaptureSession({
			projectId: 'project-cycle', loopStartSample: 100, loopEndSample: 104,
		}, {
			spool: { allocateGeneration: live.allocateGeneration, beginLive: live.begin },
			createId: (prefix) => `${prefix}-${String(++identity)}`,
			onDraft() {},
			finalizeDrafts: async (drafts) => {
				finalized.push(...drafts.map(({ draftId }) => draftId));
				return { kind: 'take-cycle-finalization' } as never;
			},
		});
		const faulted = await session.beginLane(lane('group-a', 'track-a'));
		await faulted.append({ startSample: 100, endSample: 104, channels: [PCM] });
		const surviving = await session.beginLane(lane('group-b', 'track-b'));
		await surviving.append({ startSample: 100, endSample: 104, channels: [PCM] });

		await assert.rejects(faulted.seal(), /simulated failure/u, failing);
		await faulted.discard();
		await surviving.seal();
		await session.finalize();

		assert.deepEqual(finalized, [surviving.draftId], failing);
		assert.equal(session.pendingLaneCount, 1, failing);
		assert.equal(await repository.load('project-cycle', faulted.draftId), null, failing);
	}
});

class SealFaultRepository extends RawPcmSpoolRepository {
	readonly #failing: 'seal' | 'replaceData';

	constructor(
		values: ConstructorParameters<typeof RawPcmSpoolRepository>[0],
		chunks: ConstructorParameters<typeof RawPcmSpoolRepository>[1],
		failing: 'seal' | 'replaceData',
	) {
		super(values, chunks);
		this.#failing = failing;
	}

	override async seal(record: RawPcmSpoolRecord, data: unknown): Promise<RawPcmSpoolRecord> {
		if (this.#failing === 'seal' && record.spoolId === 'envelope-1') throw new Error('simulated failure before sealing');
		return super.seal(record, data);
	}

	override async replaceData(record: RawPcmSpoolRecord, data: unknown): Promise<RawPcmSpoolRecord> {
		if (this.#failing === 'replaceData' && record.spoolId === 'envelope-1') {
			throw new Error('simulated failure after sealing');
		}
		return super.replaceData(record, data);
	}
}

function rawFixture(prefix: string) {
	const memory = getMemoryDatabase(uniqueName(prefix));
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	return {
		memory,
		repository: new RawPcmSpoolRepository(values, new SourceRecordRepository(port)),
	};
}

function rawRequest(spoolId: string) {
	return {
		projectId: 'project-cycle', spoolId, sampleRate: 48_000, channelCount: 1, chunkFrames: 4,
		data: { phase: 'registered' },
	};
}

function lane(groupId: string, trackId: string) {
	return {
		groupId, trackId, sequenceId: 'main-sequence', name: `Take ${trackId}`,
		sampleRate: 48_000, channelCount: 1, chunkFrames: 4,
	};
}

function passIdentities(passIndex: number, firstLaneId: string) {
	return {
		laneId: passIndex ? `lane-${String(passIndex)}` : firstLaneId,
		takeId: `take-${String(passIndex)}`,
		mediaId: `media-${String(passIndex)}`,
		journalId: `journal-${String(passIndex)}`,
	};
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
