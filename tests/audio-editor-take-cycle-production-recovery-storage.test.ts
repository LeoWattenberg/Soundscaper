/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTakeCycleProductionComposition,
	type TakeCycleProductionCompositionDependencies,
} from '../src/common/editor/controller/take-cycle-production-composition.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording-transaction-types.ts';
import type { TakeCycleRoutedCaptureProject } from '../src/common/editor/controller/take-cycle-routed-capture-types.ts';
import {
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17, type AudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import type { TakeCycleRecoveryEnvelope } from '../src/common/editor/take-cycle-recovery-envelope.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { ProjectRepositoryPort } from '../src/common/editor/storage/project-repository.ts';
import type { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import type { SourceRepository } from '../src/common/editor/storage/source-repository.ts';
import {
	TakeCycleRecoveryEnvelopeRepository,
	type TakeCycleRecoveryEnvelopeKeyValuePort,
} from '../src/common/editor/storage/take-cycle-recovery-envelope-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-12T12:00:00.000Z';
const PROJECT_ID = 'project-cycle-mixed';
const FIRST = Float32Array.of(0.125, 0.25, 0.375, 0.5);
const SECOND = Float32Array.of(-0.125, -0.25, -0.375, -0.5);

test('production recovery cleans a mixed envelope and re-finalizes its exact raw draft', async () => {
	const crashed = await createMixedCrash('recover');
	const reopened = await openProcess(crashed.indexedDB, crashed.databaseName, crashed.base);
	const activated: Array<Readonly<{ mediaId: string; sourceToken: string }>> = [];
	const composition = productionComposition(reopened, {
		activateCommittedSource: async (mediaId) => {
			const metadata = await reopened.sources.getMetadata(mediaId);
			assert.ok(metadata?.sourceToken);
			activated.push({ mediaId, sourceToken: metadata.sourceToken });
		},
	});
	const pending = await composition.inspectOpenRecovery(PROJECT_ID);
	assert.ok(pending);
	assert.equal(pending.draftCount, 1);
	await composition.recoverOnOpen(pending, 'recover');

	const persisted = await reopened.projects.load(PROJECT_ID) as AudioEditorProjectV17;
	validateAudioEditorProjectV17(persisted);
	assert.equal(serializeScapeProjectDocument(persisted), crashed.targetProjectDocument);
	assert.deepEqual(persisted.takeGroups[0]?.laneOrder, crashed.laneIds);
	assert.deepEqual(persisted.takeGroups[0]?.takes.map(({ sourceId }) => sourceId), crashed.mediaIds);
	assert.deepEqual(await readPcm(reopened.sources, crashed.mediaIds[0]!), [[...FIRST]]);
	assert.deepEqual(await readPcm(reopened.sources, crashed.mediaIds[1]!), [[...SECOND]]);
	assert.deepEqual(activated.map(({ mediaId }) => mediaId), crashed.mediaIds);
	assert.equal(activated.some(({ sourceToken }) => sourceToken === crashed.publishedSourceToken), false,
		'stale mixed-envelope media is never activated');
	await assertTerminalRoots(reopened, crashed.initialChunkTokens, 2);
	await reopened.store.close();
});

test('production discard removes mixed media, its raw draft, and every recovery root', async () => {
	const crashed = await createMixedCrash('discard');
	const reopened = await openProcess(crashed.indexedDB, crashed.databaseName, crashed.base);
	const activated: string[] = [];
	const composition = productionComposition(reopened, {
		activateCommittedSource: (mediaId) => { activated.push(mediaId); },
	});
	const pending = await composition.inspectOpenRecovery(PROJECT_ID);
	assert.ok(pending);
	await composition.recoverOnOpen(pending, 'discard');

	assert.deepEqual(activated, []);
	assert.deepEqual(await reopened.sources.list(), []);
	assert.deepEqual(await reopened.rawPcmSpools.list(PROJECT_ID), []);
	assert.equal(await reopened.recovery.load(PROJECT_ID), null);
	assert.equal(await composition.inspectOpenRecovery(PROJECT_ID), null);
	assert.equal(
		serializeScapeProjectDocument(await reopened.projects.load(PROJECT_ID)),
		serializeScapeProjectDocument(crashed.base),
	);
	assert.deepEqual(chunkTokens(crashed.indexedDB, crashed.databaseName), []);
	await reopened.store.close();
});

test('a failed production stop settles and can retry project synchronization', async () => {
	const fixture = await openProcess(
		createInstrumentedIndexedDB(),
		uniqueName('cycle-stop-retry'),
	);
	let synchronizationAttempts = 0;
	const composition = productionComposition(fixture, {
		synchronizeActivatedProject: () => {
			synchronizationAttempts += 1;
			if (synchronizationAttempts === 1) throw new Error('project synchronization failed');
		},
	});
	const controller = await composition.start(recordingScope(fixture));

	await assert.rejects(controller.stop(), /project synchronization failed/u);
	assert.equal(controller.state, 'stopped');
	await controller.stop();
	assert.equal(controller.state, 'stopped');
	assert.equal(synchronizationAttempts, 2);
	await fixture.store.close();
});

interface ProcessFixture {
	readonly indexedDB: ReturnType<typeof createInstrumentedIndexedDB>;
	readonly databaseName: string;
	readonly store: ReturnType<typeof createProjectStore>;
	readonly projects: ProjectRepositoryPort;
	readonly sources: SourceRepository;
	readonly rawPcmSpools: RawPcmSpoolRepository;
	readonly recovery: TakeCycleRecoveryEnvelopeRepository;
	readonly lifetime: EditorControllerLifetime;
	readonly generation: EditorProjectGeneration;
	readonly base: AudioEditorProjectV17;
}

interface MixedCrash {
	readonly indexedDB: ReturnType<typeof createInstrumentedIndexedDB>;
	readonly databaseName: string;
	readonly base: AudioEditorProjectV17;
	readonly targetProjectDocument: string;
	readonly laneIds: readonly string[];
	readonly mediaIds: readonly string[];
	readonly publishedSourceToken: string;
	readonly initialChunkTokens: readonly string[];
}

async function createMixedCrash(label: string): Promise<MixedCrash> {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueName(`cycle-mixed-${label}`);
	const fixture = await openProcess(indexedDB, databaseName);
	const faulting = new CrashAfterMediaPrefixRepository(
		fixture.store.analysisRepository as TakeCycleRecoveryEnvelopeKeyValuePort,
		fixture.lifetime,
	);
	const recorder: { current?: RecordingControllerFactoryOptions } = {};
	const composition = productionComposition(fixture, { recoveryRepository: faulting, recorder });
	await composition.routed.start({ kind: 'take-cycle-routed-capture' }, recordingScope(fixture));
	assert.ok(recorder.current);
	await recorder.current.onChunk({ frameStart: 0, frames: 4, channels: [FIRST] });
	await recorder.current.onChunk({ frameStart: 4, frames: 4, channels: [SECOND] });
	await assert.rejects(composition.routed.stop(), /disposed|simulated process loss/iu);

	const envelope = await fixture.recovery.load(PROJECT_ID);
	assert.ok(envelope);
	assert.equal(envelope.state, 'staged');
	assert.deepEqual(envelope.entries.map(({ journal }) => journal.state), ['published', 'staged']);
	assert.deepEqual((await fixture.rawPcmSpools.list(PROJECT_ID)).map(({ state, frameCount }) => ({
		state, frameCount,
	})), [{ state: 'sealed', frameCount: 8 }]);
	assert.deepEqual((await fixture.sources.list()).map(({ id }) => id), [envelope.entries[0]!.journal.binding.mediaId]);
	assert.deepEqual((await fixture.projects.load(PROJECT_ID))?.takeGroups, []);
	const published = await fixture.sources.getMetadata(envelope.entries[0]!.journal.binding.mediaId);
	assert.ok(published?.sourceToken);
	const initialChunkTokens = chunkTokens(indexedDB, databaseName);
	assert.equal(initialChunkTokens.length, 3, 'raw, published, and staged PCM roots survive process loss');
	const result = {
		indexedDB,
		databaseName,
		base: fixture.base,
		targetProjectDocument: envelope.targetProjectDocument,
		laneIds: envelope.captureRequest.laneIds,
		mediaIds: envelope.entries.map(({ journal }) => journal.binding.mediaId),
		publishedSourceToken: published.sourceToken,
		initialChunkTokens,
	};
	await fixture.store.close();
	return result;
}

async function openProcess(
	indexedDB: ReturnType<typeof createInstrumentedIndexedDB>,
	databaseName: string,
	baseValue?: AudioEditorProjectV17,
): Promise<ProcessFixture> {
	const store = createProjectStore({ indexedDB, preferOpfs: false, databaseName });
	await store.ready();
	const projects = store.projectRepository as ProjectRepositoryPort;
	const sources = store.sourceRepository as SourceRepository;
	const rawPcmSpools = store.rawPcmSpoolRepository as RawPcmSpoolRepository;
	const recovery = store.takeCycleRecoveryEnvelopeRepository as TakeCycleRecoveryEnvelopeRepository;
	const base = baseValue ?? createAudioEditorProjectV17({
		id: PROJECT_ID, title: 'Mixed recovery', now: NOW,
		tracks: [createAudioTrack({ id: 'track-a', name: 'Vocal', clipIds: [], armed: true })],
		sequences: [{ id: 'main-sequence', trackIds: ['track-a'] }],
		primarySequenceId: 'main-sequence',
		loop: { enabled: true, startFrame: 0, endFrame: 4 },
	});
	if (!baseValue) await projects.save(base);
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const generation = new EditorProjectGeneration();
	generation.activate(PROJECT_ID);
	return {
		indexedDB, databaseName, store, projects, sources, rawPcmSpools,
		recovery, lifetime, generation, base,
	};
}

function productionComposition(
	fixture: ProcessFixture,
	overrides: Readonly<{
		recoveryRepository?: TakeCycleRecoveryEnvelopeRepository;
		recorder?: { current?: RecordingControllerFactoryOptions };
		activateCommittedSource?(mediaId: string): PromiseLike<void> | void;
		synchronizeActivatedProject?(): PromiseLike<void> | void;
	}> = {},
) {
	const ids = new Map<string, number>();
	const stream = {
		getAudioTracks: () => [{ readyState: 'live', getSettings: () => ({ channelCount: 1 }) }],
		getTracks: () => [],
	};
	const dependencies: TakeCycleProductionCompositionDependencies = {
		lifetime: fixture.lifetime,
		projects: fixture.projects,
		sources: fixture.sources,
		rawPcmSpools: fixture.rawPcmSpools,
		recoveryRepository: overrides.recoveryRepository ?? fixture.recovery,
		captureProject: () => fixture.generation.capture(),
		assertProject: (token) => fixture.generation.assertCurrent(token),
		createId(prefix) {
			const next = (ids.get(prefix) ?? 0) + 1;
			ids.set(prefix, next);
			return `${prefix}-${String(next)}`;
		},
		publishCurrentProject() {},
		activateCommittedSource: overrides.activateCommittedSource ?? (() => {}),
		synchronizeActivatedProject: overrides.synchronizeActivatedProject ?? (() => {}),
		now: () => NOW,
		routed: {
			capturePool: {
				acquireHardware: async () => stream,
				acquireDisplay: async () => stream,
			},
			engine: {
				getAudioContext: async () => ({ sampleRate: 48_000, currentTime: 1, resume: async () => {} }),
				setLoop() {}, seek() {}, playAt: async () => {}, pause() {},
			},
			sourceChunkFrames: 4,
			getProject: () => fixture.base as unknown as TakeCycleRoutedCaptureProject,
			getRoutes: () => ({
				'track-a': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
			}),
			activeSelection: () => null,
			soundActivationEnabled: () => false,
			recordingRouteSourceKey: ({ deviceId }) => `device:${deviceId}`,
			streamAudioChannelCount: () => 1,
			recordingStreamIsLive: () => true,
			createRecorder: async (options) => {
				if (overrides.recorder) overrides.recorder.current = options;
				return {
					start() {}, pause: () => false, resume: () => false,
					stop: async () => {}, dispose: async () => {},
					setMonitoring() {}, setInputGain() {},
				};
			},
			createGroupId: () => 'group-cycle',
			createRecordingName: () => 'Cycle take',
			preflightStorage: async () => {},
			beginPlaybackCachePreparation: async () => {},
			handleError() {},
		},
	};
	return createTakeCycleProductionComposition(dependencies);
}

function recordingScope(fixture: ProcessFixture) {
	return Object.freeze({
		generation: 1, projectId: PROJECT_ID,
		assertCurrent: () => fixture.generation.assertCurrent(fixture.generation.capture()),
	});
}

class CrashAfterMediaPrefixRepository extends TakeCycleRecoveryEnvelopeRepository {
	readonly #lifetime: EditorControllerLifetime;
	#crashed = false;

	constructor(values: TakeCycleRecoveryEnvelopeKeyValuePort, lifetime: EditorControllerLifetime) {
		super(values);
		this.#lifetime = lifetime;
	}

	override async replace(expected: unknown, next: unknown): Promise<TakeCycleRecoveryEnvelope> {
		const persisted = await super.replace(expected, next);
		if (!this.#crashed
			&& persisted.entries[0]?.journal.state === 'published'
			&& persisted.entries[1]?.journal.state === 'staged') {
			this.#crashed = true;
			this.#lifetime.beginDisposal();
			throw new Error('simulated process loss after exact media-prefix CAS');
		}
		return persisted;
	}
}

async function assertTerminalRoots(
	fixture: ProcessFixture,
	initialChunkTokens: readonly string[],
	expectedSources: number,
): Promise<void> {
	assert.equal(await fixture.recovery.load(PROJECT_ID), null);
	assert.deepEqual(await fixture.rawPcmSpools.list(PROJECT_ID), []);
	assert.equal((await fixture.sources.list()).length, expectedSources);
	const remaining = chunkTokens(fixture.indexedDB, fixture.databaseName);
	assert.equal(initialChunkTokens.some((token) => remaining.includes(token)), false);
}

async function readPcm(sources: SourceRepository, mediaId: string): Promise<number[][]> {
	const result: number[][] = [];
	for await (const chunk of sources.chunks(mediaId)) result.push([...chunk.channels[0]!]);
	return result;
}

function chunkTokens(
	indexedDB: ReturnType<typeof createInstrumentedIndexedDB>,
	databaseName: string,
): string[] {
	return [...new Set(indexedDB.records(databaseName, 'sourceChunks')
		.map((record: { readonly sourceToken: string }) => record.sourceToken))].sort();
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
