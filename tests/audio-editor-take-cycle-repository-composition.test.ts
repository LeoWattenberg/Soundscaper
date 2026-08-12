/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createTakeCycleCaptureOrchestrator,
	type TakeCycleCapturedLane,
} from '../src/common/editor/controller/take-cycle-capture-orchestrator.ts';
import { createTakeCycleCaptureSourceSpool } from '../src/common/editor/controller/take-cycle-capture-spool.ts';
import { createTakeCycleLiveCaptureSpool } from '../src/common/editor/controller/take-cycle-live-capture-spool.ts';
import {
	createTakeCycleRecordingRepositoryComposition,
	type TakeCyclePublishedProject,
} from '../src/common/editor/controller/take-cycle-recording-repository-composition.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import type { TakeCycleFinalizationRequest } from '../src/common/editor/controller/take-cycle-recording-service.ts';
import { createEditorHistory, executeEditorCommand } from '../src/common/editor/history.js';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV17, type AudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createScapeDigest, scapeHex } from '../src/common/editor/scape-archive-media.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import type { TakeCycleRecoveryEnvelope } from '../src/common/editor/take-cycle-recovery-envelope.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { ProjectRepositoryPort } from '../src/common/editor/storage/project-repository.ts';
import type { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import type { SourceRepository } from '../src/common/editor/storage/source-repository.ts';
import { TakeCycleRecoveryEnvelopeRepository } from '../src/common/editor/storage/take-cycle-recovery-envelope-repository.ts';
import { packPlanarFloat32 } from '../src/common/editor/wavpack/pcm.js';

const NOW = '2026-08-12T12:00:00.000Z';
const FIRST = Object.freeze([Float32Array.from({ length: 4 }, (_, index) => index / 8)]);
const SECOND = Object.freeze([Float32Array.from({ length: 4 }, (_, index) => (index + 4) / 8)]);

test('repository composition publishes receipt-owned PCM and one real V17 history command', async () => {
	const fixture = await compositionFixture();
	const result = await fixture.composition.finalize(request());

	assert.equal(result.lanes[0]?.status, 'committed');
	assert.equal(await fixture.recovery.load('project-cycle'), null);
	const persisted = await fixture.projects.load('project-cycle') as AudioEditorProjectV17;
	assert.equal(persisted.revision, fixture.base.revision + 1);
	assert.deepEqual(persisted.takeGroups, [{
		id: 'group-cycle', sequenceId: 'main-sequence', trackId: 'track-a',
		startSample: 100, endSample: 108,
		laneOrder: ['lane-a'], lanes: [{ id: 'lane-a' }],
		takes: [{
			id: 'take-a', laneId: 'lane-a', sourceId: 'media-a',
			startSample: 100, endSample: 108, sourceStartSample: 0,
		}],
		compRegions: [{ id: 'region-lane-a', takeId: 'take-a', startSample: 100, endSample: 108 }],
	}]);
	assert.equal(persisted.sources.some(({ id }) => id === 'media-a'), true);
	const metadata = await fixture.sources.getMetadata('media-a');
	assert.equal(metadata?.sourceToken, fixture.stageTokens[0]);
	assert.equal(metadata?.pendingProjectUntil, undefined, 'project CAS publishes source retention atomically');
	assert.equal(fixture.publications.length, 1);
	assert.equal(fixture.publications[0]?.reason, 'finalize');
	assert.equal(fixture.history.undoStack.length, 1);
	assert.equal(serializeScapeProjectDocument(fixture.history.present), serializeScapeProjectDocument(persisted));

	const reopened = await fixture.projects.load('project-cycle');
	assert.deepEqual(reopened, persisted);
});

test('two complete passes publish as deterministic independently auditionable lanes', async () => {
	const fixture = await compositionFixture();
	const evidence = pcmEvidence([FIRST, SECOND]);
	const result = await fixture.composition.finalize({
		publicationGeneration: 7,
		lanes: [{
			envelopeId: 'envelope-multipass', groupId: 'group-cycle', laneId: 'lane-pass-1',
			loopStartSample: 100, loopEndSample: 108,
			captureSpans: [{ startSample: 100, endSample: 116 }], interrupted: false,
			publications: [
				{ journalId: 'journal-pass-1', laneId: 'lane-pass-1', takeId: 'take-pass-1', mediaId: 'media-pass-1', ...evidence },
				{ journalId: 'journal-pass-2', laneId: 'lane-pass-2', takeId: 'take-pass-2', mediaId: 'media-pass-2', ...evidence },
			],
		}],
	});

	assert.equal(result.lanes[0]?.status, 'committed');
	assert.deepEqual(result.lanes[0]?.committedPasses.map(({ laneId }) => laneId), [
		'lane-pass-1', 'lane-pass-2',
	]);
	const persisted = await fixture.projects.load('project-cycle') as AudioEditorProjectV17;
	assert.deepEqual(persisted.takeGroups[0]?.laneOrder, ['lane-pass-1', 'lane-pass-2']);
	assert.deepEqual(persisted.takeGroups[0]?.takes.map(({ id, laneId }) => ({ id, laneId })), [
		{ id: 'take-pass-1', laneId: 'lane-pass-1' },
		{ id: 'take-pass-2', laneId: 'lane-pass-2' },
	]);
	assert.equal(fixture.history.undoStack.length, 1);
	assert.deepEqual(await fixture.projects.load('project-cycle'), persisted);
});

test('a second exact-loop recording appends ordered lanes to the existing group and remains undoable', async () => {
	const fixture = await compositionFixture();
	await fixture.composition.finalize(request());
	await fixture.composition.finalize(request({
		envelopeId: 'envelope-b', laneId: 'lane-b', takeId: 'take-b',
		mediaId: 'media-b', journalId: 'journal-b',
	}));

	const persisted = await fixture.projects.load('project-cycle') as AudioEditorProjectV17;
	assert.deepEqual(persisted.takeGroups[0]?.laneOrder, ['lane-a', 'lane-b']);
	assert.deepEqual(persisted.takeGroups[0]?.takes.map(({ id, laneId }) => ({ id, laneId })), [
		{ id: 'take-a', laneId: 'lane-a' },
		{ id: 'take-b', laneId: 'lane-b' },
	]);
	assert.equal(fixture.history.undoStack.length, 2);
	const undone = fixture.history.undoStack.at(-1)?.project as AudioEditorProjectV17 | undefined;
	assert.deepEqual(undone?.takeGroups[0]?.laneOrder, ['lane-a']);
	assert.deepEqual(await fixture.projects.load('project-cycle'), persisted);
});

test('routed capture publishes two tracks as separate groups in real V17 command history', async () => {
	const fixture = await compositionFixture();
	const routedCapture: { current?: ReturnType<typeof createTakeCycleCaptureOrchestrator> } = {};
	const composition = createComposition(fixture, {
		resolveLaneTarget: ({ plan }: { readonly plan: { readonly laneId: string } }) => (
			routedCapture.current!.resolveLaneTarget(plan.laneId)
		),
		describeSource: ({ publication }: { readonly publication: { readonly mediaId: string } }) => (
			routedCapture.current!.describeSource(publication.mediaId)
		),
		readPassChunks: ({ envelope, entryIndex }: {
			readonly envelope: TakeCycleRecoveryEnvelope;
			readonly entryIndex: number;
		}) => (
			routedCapture.current!.readPassChunks(envelope.entries[entryIndex]!.journal.binding.mediaId)
		),
	});
	let identity = 0;
	const orchestrator = createTakeCycleCaptureOrchestrator({
		service: composition,
		spool: createTakeCycleCaptureSourceSpool(
			fixture.sources,
			createTakeCycleLiveCaptureSpool(fixture.rawPcmSpools),
		),
		loadRecoveryEnvelope: (projectId) => fixture.recovery.load(projectId),
		createId(prefix) { identity += 1; return `${prefix}-${String(identity)}`; },
		activateCommittedSource() { /* real source metadata is already committed */ },
		listRecoveredMedia: async () => [],
	});
	routedCapture.current = orchestrator;
	const result = await orchestrator.finalize({
		projectId: fixture.base.id,
		loopStartSample: 100,
		loopEndSample: 108,
		lanes: [
			routedLane('group-a', 'track-a', [FIRST, SECOND]),
			routedLane('group-b', 'track-b', [SECOND, FIRST]),
		],
	});

	assert.deepEqual(result.lanes.map(({ status }) => status), ['committed', 'committed']);
	const persisted = await fixture.projects.load(fixture.base.id) as AudioEditorProjectV17;
	assert.equal(persisted.revision, fixture.base.revision + 2);
	assert.deepEqual(persisted.takeGroups.map(({ id, trackId }) => ({ id, trackId })), [
		{ id: 'group-a', trackId: 'track-a' },
		{ id: 'group-b', trackId: 'track-b' },
	]);
	assert.equal(fixture.history.undoStack.length, 2);
	assert.deepEqual((await fixture.sources.list()).map(({ id }) => id).sort(), ['media-4', 'media-9']);
	assert.deepEqual(await fixture.rawPcmSpools.list(fixture.base.id), []);
});

test('restart recovery replays an exact published lane through project CAS', async () => {
	const fixture = await compositionFixture();
	const abort = new AbortController();
	let refused = false;
	const interrupted = createComposition(fixture, {
		projects: {
			...repositoryMethods(fixture.projects),
			async saveIfCurrent() {
				refused = true;
				abort.abort(new DOMException('simulated process loss', 'AbortError'));
				throw abort.signal.reason;
			},
		},
	});
	await assert.rejects(interrupted.finalize(request(), { signal: abort.signal }), /simulated process loss/u);
	assert.equal(refused, true);
	const envelope = await fixture.recovery.load('project-cycle');
	assert.equal(envelope?.state, 'published');
	assert.deepEqual((await fixture.projects.load('project-cycle'))?.takeGroups, []);
	assert.ok(await fixture.sources.getMetadata('media-a'));

	const restartedLifetime = new EditorControllerLifetime();
	restartedLifetime.markReady();
	const restartedGeneration = new EditorProjectGeneration();
	restartedGeneration.activate('project-cycle');
	const restarted = createTakeCycleRecordingRepositoryComposition({
		lifetime: restartedLifetime,
		recoveryRepository: fixture.recovery,
		projects: fixture.projects,
		sources: fixture.sources,
		captureProject: () => restartedGeneration.capture(),
		assertProject: (token) => restartedGeneration.assertCurrent(token),
		resolveLaneTarget: () => ({ sequenceId: 'main-sequence', trackId: 'track-a' }),
		describeSource: () => sourceDescription(),
		readPassChunks: () => { throw new Error('restart replay must not request capture PCM'); },
		createCompRegionId: ({ plan }) => `region-${plan.laneId}`,
		now: () => NOW,
	});
	const plan = await restarted.recover({ currentGeneration: 7, decision: 'recover' });
	assert.equal(plan.disposition, 'replay-published');
	assert.equal(await fixture.recovery.load('project-cycle'), null);
	const recovered = await fixture.projects.load('project-cycle') as AudioEditorProjectV17;
	assert.deepEqual(recovered.takeGroups.map(({ id }) => id), ['group-cycle']);
	assert.ok(await fixture.sources.getMetadata('media-a'));
});

test('an exact-document conflict cannot overwrite a same-revision competing project', async () => {
	const fixture = await compositionFixture();
	let competed = false;
	const composition = createComposition(fixture, {
		readPassChunks: async function* () {
			yield FIRST;
			yield SECOND;
			if (!competed) {
				competed = true;
				await fixture.projects.save(applyEditorCommand(
					fixture.base,
					{ type: 'project/rename', title: 'Competing publication' },
					{ now: NOW },
				));
			}
		},
	});
	await assert.rejects(
		composition.finalize(request()),
		(error: unknown) => error instanceof AggregateError
			&& error.errors.some((cause) => /does not match the exact base or target publication fence/u.test(String(cause))),
	);
	assert.equal((await fixture.projects.load('project-cycle'))?.title, 'Competing publication');
	assert.ok(await fixture.recovery.load('project-cycle'), 'ambiguous conflict retains recovery ownership');
});

interface Fixture {
	readonly base: AudioEditorProjectV17;
	readonly projects: ProjectRepositoryPort;
	readonly sources: SourceRepository;
	readonly rawPcmSpools: RawPcmSpoolRepository;
	readonly recovery: TakeCycleRecoveryEnvelopeRepository;
	readonly lifetime: EditorControllerLifetime;
	readonly generation: EditorProjectGeneration;
	readonly publications: TakeCyclePublishedProject[];
	readonly stageTokens: string[];
	history: ReturnType<typeof createEditorHistory>;
	readonly composition: ReturnType<typeof createTakeCycleRecordingRepositoryComposition>;
}

async function compositionFixture(): Promise<Fixture> {
	const store = createProjectStore({
		indexedDB: null, preferOpfs: false, databaseName: uniqueName('cycle-composition'),
	});
	const projects = store.projectRepository as ProjectRepositoryPort;
	const sources = store.sourceRepository as SourceRepository;
	const rawPcmSpools = store.rawPcmSpoolRepository as RawPcmSpoolRepository;
	const recovery = new TakeCycleRecoveryEnvelopeRepository(store.analysisRepository);
	const base = createAudioEditorProjectV17({
		id: 'project-cycle', title: 'Cycle project', now: NOW,
		tracks: [
			createAudioTrackV10({ id: 'track-a', name: 'Vocal', clipIds: [] }),
			createAudioTrackV10({ id: 'track-b', name: 'Guitar', clipIds: [] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['track-a', 'track-b'] }],
		primarySequenceId: 'main-sequence',
	});
	await projects.save(base);
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(base.id);
	const fixture = {
		base, projects, sources, rawPcmSpools, recovery, lifetime, generation,
		publications: [] as TakeCyclePublishedProject[],
		stageTokens: [] as string[],
		history: createEditorHistory(base),
	} as Fixture;
	Object.defineProperty(fixture, 'composition', { value: createComposition(fixture) });
	return fixture;
}

function createComposition(
	fixture: Fixture,
	overrides: Readonly<Record<string, unknown>> = {},
): ReturnType<typeof createTakeCycleRecordingRepositoryComposition> {
	return createTakeCycleRecordingRepositoryComposition({
		lifetime: fixture.lifetime,
		recoveryRepository: fixture.recovery,
		projects: fixture.projects,
		sources: fixture.sources,
		captureProject: () => fixture.generation.capture(),
		assertProject: (token) => fixture.generation.assertCurrent(token),
		resolveLaneTarget: () => ({ sequenceId: 'main-sequence', trackId: 'track-a' }),
		describeSource: () => sourceDescription(),
		readPassChunks: async function* () { yield FIRST; yield SECOND; },
		createCompRegionId: ({ plan }) => `region-${plan.laneId}`,
		now: () => NOW,
		onStageReceipt: (receipt) => { fixture.stageTokens.push(receipt.sourceToken); },
		publishCurrentProject(publication) {
			fixture.publications.push(publication);
			if (!publication.command) {
				fixture.history = createEditorHistory(publication.target);
				return;
			}
			assert.equal(
				serializeScapeProjectDocument(fixture.history.present),
				serializeScapeProjectDocument(publication.base),
			);
			fixture.history = executeEditorCommand(
				fixture.history,
				publication.command as AudioEditorCommand,
				{ now: NOW },
			);
		},
		...overrides,
	});
}

function sourceDescription() {
	return {
		name: 'Cycle take', sampleRate: 48_000, channelCount: 1,
		chunkFrames: 4, frameCount: 8,
	};
}

function routedLane(
	groupId: string,
	trackId: string,
	chunks: readonly (readonly Float32Array[])[],
): TakeCycleCapturedLane {
	return {
		groupId,
		trackId,
		sequenceId: 'main-sequence',
		name: `${trackId} cycle`,
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 4,
		capture: {
			kind: 'stream',
			spans: (async function* () {
				let startSample = 100;
				for (const channels of chunks) {
					yield {
						startSample,
						endSample: startSample + channels[0]!.length,
						channels,
					};
					startSample += channels[0]!.length;
				}
			})(),
		},
	};
}

function request(overrides: Readonly<Partial<{
	readonly envelopeId: string;
	readonly laneId: string;
	readonly takeId: string;
	readonly mediaId: string;
	readonly journalId: string;
}>> = {}): TakeCycleFinalizationRequest {
	const evidence = pcmEvidence([FIRST, SECOND]);
	const envelopeId = overrides.envelopeId ?? 'envelope-a';
	const laneId = overrides.laneId ?? 'lane-a';
	const takeId = overrides.takeId ?? 'take-a';
	const mediaId = overrides.mediaId ?? 'media-a';
	const journalId = overrides.journalId ?? 'journal-a';
	return {
		publicationGeneration: 7,
		lanes: [{
			envelopeId, groupId: 'group-cycle', laneId,
			loopStartSample: 100, loopEndSample: 108,
			captureSpans: [{ startSample: 100, endSample: 108 }], interrupted: false,
			publications: [{
				journalId, laneId, takeId, mediaId, ...evidence,
			}],
		}],
	};
}

function pcmEvidence(chunks: readonly (readonly Float32Array[])[]) {
	const digest = createScapeDigest();
	let byteLength = 0;
	for (const channels of chunks) {
		const header = new Uint8Array(4);
		new DataView(header.buffer).setUint32(0, channels[0]!.length, true);
		const payload = new Uint8Array(packPlanarFloat32(channels));
		for (const bytes of [header, payload]) { digest.update(bytes); byteLength += bytes.byteLength; }
	}
	return { byteLength, sha256: scapeHex(digest.digest()) };
}

function repositoryMethods(projects: ProjectRepositoryPort): ProjectRepositoryPort {
	return {
		createIfAbsent: projects.createIfAbsent?.bind(projects),
		save: projects.save.bind(projects),
		saveIfCurrent: projects.saveIfCurrent?.bind(projects),
		maintainCurrentProject: projects.maintainCurrentProject?.bind(projects),
		load: projects.load.bind(projects), list: projects.list.bind(projects),
		listRevisions: projects.listRevisions.bind(projects),
		deleteIfCurrent: projects.deleteIfCurrent?.bind(projects), delete: projects.delete.bind(projects),
	};
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
