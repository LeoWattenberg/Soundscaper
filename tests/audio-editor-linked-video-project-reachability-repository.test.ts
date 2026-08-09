/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject, type AudioEditorProjectCurrent } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
} from '../src/common/editor/project-v9.ts';
import { LINKED_ORIGINAL_BINDING_SCHEMA_VERSION } from '../src/common/editor/storage/linked-original-binding.ts';
import { LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME } from '../src/common/editor/storage/linked-original-provisional-root.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import type { LinkedVideoOriginalBindingInput } from '../src/common/editor/storage/linked-video-original-binding.ts';
import {
	LinkedVideoOriginalProjectReachabilityRepository,
	MAX_LINKED_VIDEO_ORIGINAL_PROJECT_REACHABILITY_ROOTS,
} from '../src/common/editor/storage/linked-video-original-project-reachability-repository.ts';
import { LinkedVideoOriginalRepository } from '../src/common/editor/storage/linked-video-original-repository.ts';
import {
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
	linkedVideoOriginalBindingKey,
} from '../src/common/editor/storage/linked-video-original-schema.ts';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase, type EditorMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';
import { createStorageRepositories } from '../src/common/editor/storage/repositories.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-02T12:00:00.000Z';
const PROJECT_ID = 'reachability-project';
const LOCATOR_REVISION = 'locator_revision_00000001';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} retains timeline, Project Bin, fallback, and retained-revision video roots`, async (context) => {
		const fixture = await reachabilityFixture(context, backend, { revisionLimit: 2 });
		const timeline = videoSource('timeline-video');
		const bin = videoSource('bin-video');
		const fallback = videoSource('fallback-video');
		const stale = videoSource('stale-video');
		await fixture.projects.save(rootedProject(1, { timeline, bin, fallback }));
		for (const [index, source] of [timeline, bin, fallback, stale].entries()) {
			await seedBinding(fixture, PROJECT_ID, source, `locator_000000000000000${String(index + 1)}`);
		}

		const result = await fixture.reachability.pruneProjectBindings(PROJECT_ID, []);

		assert.ok(result);
		assert.equal(Object.isFrozen(result), true);
		assert.equal(Object.isFrozen(result.durableVideoSourceIds), true);
		assert.equal(Object.isFrozen(result.removedLocatorReferences), true);
		assert.deepEqual(result.durableVideoSourceIds, ['bin-video', 'fallback-video', 'timeline-video']);
		assert.deepEqual(result.removedLocatorReferences, [{
			locatorId: 'locator_0000000000000004',
			locatorRevision: LOCATOR_REVISION,
		}]);
		for (const source of [timeline, bin, fallback]) {
			assert.ok(await fixture.bindings.get(PROJECT_ID, source.id));
		}
		assert.equal(await fixture.bindings.get(PROJECT_ID, stale.id), null);

		await fixture.projects.save(rootedProject(2, {}));
		const retained = await fixture.reachability.pruneProjectBindings(PROJECT_ID, []);
		assert.deepEqual(retained?.durableVideoSourceIds, ['bin-video', 'fallback-video', 'timeline-video']);

		await fixture.projects.save(rootedProject(3, {}));
		const aged = await fixture.reachability.pruneProjectBindings(PROJECT_ID, []);
		assert.deepEqual(aged?.durableVideoSourceIds, []);
		for (const source of [timeline, bin, fallback]) {
			assert.equal(await fixture.bindings.get(PROJECT_ID, source.id), null);
		}
	});

	test(`${backend} video reachability scans preserve generic audio bindings`, async (context) => {
		const fixture = await reachabilityFixture(context, backend);
		await fixture.projects.save(rootedProject(1, {}));
		const generic = new LinkedOriginalRepository(fixture.port, {
			now: () => new Date(NOW),
			createBindingToken: () => 'audio_binding_00000001',
		});
		assert.ok(await generic.putIfCurrent({
			schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
			kind: 'audio',
			projectId: PROJECT_ID,
			sourceId: 'audio-source',
			storageKey: 'audio-storage',
			locatorId: 'audio_locator_0000000001',
			locatorRevision: 'audio_snapshot_000000001',
			mimeType: 'audio/wav',
			byteLength: 1_024,
			sha256: 'ab'.repeat(32),
			sourceShape: {
				frameCount: 120,
				channelCount: 2,
				sampleRate: 48_000,
				originalSampleRate: 48_000,
				sampleFormat: 'float32',
				chunkFrames: 65_536,
			},
		}, null));
		const stale = videoSource('stale-video');
		await seedBinding(fixture, PROJECT_ID, stale, 'video_locator_0000000001');

		assert.deepEqual(
			(await fixture.reachability.pruneProjectBindings(PROJECT_ID, []))?.removedLocatorReferences,
			[{ locatorId: 'video_locator_0000000001', locatorRevision: LOCATOR_REVISION }],
		);
		assert.ok(await generic.get(PROJECT_ID, 'audio-source'));
		assert.equal(await fixture.bindings.get(PROJECT_ID, stale.id), null);
	});
}

test('caller roots preserve live-history bindings without becoming durable roots', async (context) => {
	const fixture = await reachabilityFixture(context, 'memory');
	const source = videoSource('undo-video');
	await fixture.projects.save(rootedProject(1, {}));
	await seedBinding(fixture, PROJECT_ID, source, 'locator_undo_000000000001');

	const protectedResult = await fixture.reachability.pruneProjectBindings(PROJECT_ID, [source.id]);
	assert.deepEqual(protectedResult?.durableVideoSourceIds, []);
	assert.deepEqual(protectedResult?.removedLocatorReferences, []);
	assert.ok(await fixture.bindings.get(PROJECT_ID, source.id));

	const removed = await fixture.reachability.pruneProjectBindings(PROJECT_ID, []);
	assert.deepEqual(removed?.removedLocatorReferences, [{
		locatorId: 'locator_undo_000000000001',
		locatorRevision: LOCATOR_REVISION,
	}]);
	assert.equal(await fixture.bindings.get(PROJECT_ID, source.id), null);
});

test('removed exact references are sorted and deduplicated while other-project aliases survive', async (context) => {
	const fixture = await reachabilityFixture(context, 'memory');
	await fixture.projects.save(rootedProject(1, {}));
	const first = videoSource('stale-a');
	const second = videoSource('stale-b');
	const alias = videoSource('alias-source');
	await seedBinding(fixture, PROJECT_ID, first, 'locator_shared_0000000001');
	await seedBinding(fixture, PROJECT_ID, second, 'locator_shared_0000000001');
	await seedBinding(fixture, 'alias-project', alias, 'locator_shared_0000000001');

	const result = await fixture.reachability.pruneProjectBindings(PROJECT_ID, []);

	assert.deepEqual(result?.removedLocatorReferences, [{
		locatorId: 'locator_shared_0000000001',
		locatorRevision: LOCATOR_REVISION,
	}]);
	assert.ok(await fixture.bindings.get('alias-project', alias.id));
});

test('unknown current and retained projects suppress cleanup before the binding cursor', async (context) => {
	const fixture = await reachabilityFixture(context, 'indexeddb');
	const valid = rootedProject(1, {});
	await fixture.projects.save(valid);
	const source = videoSource('suppressed-video');
	await seedBinding(fixture, PROJECT_ID, source, 'locator_suppressed_000001');
	const bindingCursorCount = () => fixture.indexedDB?.stats.cursorRequests.filter(
		({ store }) => store === LINKED_VIDEO_ORIGINAL_STORE_NAME,
	).length ?? 0;

	fixture.indexedDB?.seedRecord(fixture.databaseName, 'projects', { ...valid, schemaVersion: 13 });
	assert.equal(await fixture.reachability.pruneProjectBindings(PROJECT_ID, []), null);
	assert.equal(bindingCursorCount(), 0);

	fixture.indexedDB?.seedRecord(fixture.databaseName, 'projects', valid);
	const [revision] = fixture.indexedDB?.records(fixture.databaseName, 'revisions') ?? [];
	assert.ok(revision);
	fixture.indexedDB?.seedRecord(fixture.databaseName, 'revisions', {
		...revision,
		project: { ...valid, schemaVersion: 8 },
	});
	assert.equal(await fixture.reachability.pruneProjectBindings(PROJECT_ID, []), null);
	assert.equal(bindingCursorCount(), 0);
	assert.ok(await fixture.bindings.get(PROJECT_ID, source.id));
});

test('a current project without one exact matching revision suppresses cleanup', async (context) => {
	const fixture = await reachabilityFixture(context, 'indexeddb');
	await fixture.projects.save(rootedProject(1, {}));
	fixture.indexedDB?.seedRecord(fixture.databaseName, 'projects', rootedProject(2, {}));

	assert.equal(await fixture.reachability.pruneProjectBindings(PROJECT_ID, []), null);
	assert.equal(fixture.indexedDB?.stats.cursorRequests.some(
		({ store }) => store === LINKED_VIDEO_ORIGINAL_STORE_NAME,
	), false);
});

test('same-revision divergence conservatively unions both validated source graphs', async (context) => {
	const fixture = await reachabilityFixture(context, 'memory');
	const revisionSource = videoSource('revision-graph-video');
	const currentSource = videoSource('current-graph-video');
	const stale = videoSource('divergent-stale-video');
	await fixture.projects.save(rootedProject(1, { timeline: revisionSource }));
	fixture.memory.projects.set(PROJECT_ID, rootedProject(1, { timeline: currentSource }));
	await seedBinding(fixture, PROJECT_ID, revisionSource, 'locator_revision_graph_0001');
	await seedBinding(fixture, PROJECT_ID, currentSource, 'locator_current_graph_0001');
	await seedBinding(fixture, PROJECT_ID, stale, 'locator_divergent_stale_01');

	const result = await fixture.reachability.pruneProjectBindings(PROJECT_ID, []);

	assert.deepEqual(result?.durableVideoSourceIds, ['current-graph-video', 'revision-graph-video']);
	assert.ok(await fixture.bindings.get(PROJECT_ID, revisionSource.id));
	assert.ok(await fixture.bindings.get(PROJECT_ID, currentSource.id));
	assert.equal(await fixture.bindings.get(PROJECT_ID, stale.id), null);
});

test('noncanonical, duplicate, and over-bound caller roots suppress cleanup before binding access', async (context) => {
	const fixture = await reachabilityFixture(context, 'indexeddb');
	await fixture.projects.save(rootedProject(1, {}));
	const bindingCursorCount = () => fixture.indexedDB?.stats.cursorRequests.filter(
		({ store }) => store === LINKED_VIDEO_ORIGINAL_STORE_NAME,
	).length ?? 0;

	assert.equal(await fixture.reachability.pruneProjectBindings(PROJECT_ID, [' duplicate']), null);
	assert.equal(await fixture.reachability.pruneProjectBindings(PROJECT_ID, ['duplicate', 'duplicate']), null);
	assert.equal(await fixture.reachability.pruneProjectBindings(
		PROJECT_ID,
		Array.from(
			{ length: MAX_LINKED_VIDEO_ORIGINAL_PROJECT_REACHABILITY_ROOTS + 1 },
			(_, index) => `protected-${String(index)}`,
		),
	), null);
	assert.equal(bindingCursorCount(), 0);
});

test('a malformed unrelated binding rejects the complete inventory before any deletion', async (context) => {
	const fixture = await reachabilityFixture(context, 'memory');
	await fixture.projects.save(rootedProject(1, {}));
	const stale = videoSource('stale-valid');
	const unrelated = videoSource('unrelated-malformed');
	await seedBinding(fixture, PROJECT_ID, stale, 'locator_stale_0000000001');
	await seedBinding(fixture, 'unrelated-project', unrelated, 'locator_other_0000000001');
	const key = linkedVideoOriginalBindingKey('unrelated-project', unrelated.id);
	const record = fixture.memory.linkedVideoOriginalBindings.get(key) as Record<string, unknown>;
	fixture.memory.linkedVideoOriginalBindings.set(key, { ...record, path: '/private/video.mp4' });

	await assert.rejects(
		fixture.reachability.pruneProjectBindings(PROJECT_ID, []),
		/unsupported field|stored binding record/iu,
	);
	assert.ok(await fixture.bindings.get(PROJECT_ID, stale.id));
});

test('an IndexedDB delete failure rolls the complete binding batch back', async (context) => {
	const fixture = await reachabilityFixture(context, 'indexeddb');
	await fixture.projects.save(rootedProject(1, {}));
	const first = videoSource('rollback-a');
	const second = videoSource('rollback-b');
	await seedBinding(fixture, PROJECT_ID, first, 'locator_rollback_0000001');
	await seedBinding(fixture, PROJECT_ID, second, 'locator_rollback_0000002');
	const failure = new Error('planned reachability delete failure');
	fixture.indexedDB?.failNextDeleteForStore(LINKED_VIDEO_ORIGINAL_STORE_NAME, failure);

	await assert.rejects(
		fixture.reachability.pruneProjectBindings(PROJECT_ID, []),
		(error) => error === failure,
	);
	assert.ok(await fixture.bindings.get(PROJECT_ID, first.id));
	assert.ok(await fixture.bindings.get(PROJECT_ID, second.id));
});

test('revision, root, binding-row, and exact-reference bounds fail closed', async (context) => {
	const revisions = await reachabilityFixture(context, 'memory', {
		revisionLimit: 3,
		maximumRetainedRevisions: 2,
	});
	for (let revision = 1; revision <= 3; revision += 1) {
		await revisions.projects.save(rootedProject(revision, {}));
	}
	assert.equal(await revisions.reachability.pruneProjectBindings(PROJECT_ID, []), null);

	const roots = await reachabilityFixture(context, 'memory', { maximumRoots: 2 });
	await roots.projects.save(rootedProject(1, {}));
	assert.equal(await roots.reachability.pruneProjectBindings(PROJECT_ID, ['a', 'b', 'c']), null);

	const rows = await reachabilityFixture(context, 'memory', { maximumInventoryRecords: 1 });
	await rows.projects.save(rootedProject(1, {}));
	await seedBinding(rows, PROJECT_ID, videoSource('row-a'), 'locator_row_000000000001');
	await seedBinding(rows, PROJECT_ID, videoSource('row-b'), 'locator_row_000000000002');
	await assert.rejects(
		rows.reachability.pruneProjectBindings(PROJECT_ID, []),
		/inventory.*record limit/iu,
	);

	const references = await reachabilityFixture(context, 'memory', { maximumInventoryReferences: 1 });
	await references.projects.save(rootedProject(1, {}));
	await seedBinding(references, PROJECT_ID, videoSource('ref-a'), 'locator_ref_000000000001');
	await seedBinding(references, PROJECT_ID, videoSource('ref-b'), 'locator_ref_000000000002');
	await assert.rejects(
		references.reachability.pruneProjectBindings(PROJECT_ID, []),
		/inventory.*reference limit/iu,
	);
});

test('storage composition exposes project binding reachability with production limits', async (context) => {
	const fixture = await reachabilityFixture(context, 'memory');
	const repositories = createStorageRepositories(fixture.port, {
		revisionLimit: 20,
		preferOpfs: false,
		migrateLegacyPcmOnAccess: false,
		estimateStorage: async () => ({ usage: null, quota: null }),
		isMemoryBackend: () => true,
	});
	assert.ok(
		repositories.linkedVideoOriginalProjectReachability
			instanceof LinkedVideoOriginalProjectReachabilityRepository,
	);
	assert.ok(repositories.linkedOriginalBindings instanceof LinkedOriginalRepository);
});

interface ReachabilityOptions {
	readonly revisionLimit?: number;
	readonly maximumRetainedRevisions?: number;
	readonly maximumRoots?: number;
	readonly maximumInventoryRecords?: number;
	readonly maximumInventoryReferences?: number;
}

interface ReachabilityFixture {
	readonly port: StorageRepositoryPort;
	readonly projects: ProjectRepository;
	readonly reachability: LinkedVideoOriginalProjectReachabilityRepository;
	readonly bindings: LinkedVideoOriginalRepository;
	readonly memory: EditorMemoryDatabase;
	readonly indexedDB: ReturnType<typeof createInstrumentedIndexedDB> | null;
	readonly databaseName: string;
}

interface TestVideoSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly videoCodec: string;
	readonly audioCodec: string | null;
	readonly hasAudio: boolean;
}

async function reachabilityFixture(
	context: TestContext,
	backend: 'memory' | 'indexeddb',
	options: ReachabilityOptions = {},
): Promise<ReachabilityFixture> {
	const databaseName = `linked-reachability-${backend}-${Date.now()}-${Math.random()}`;
	const memory = getMemoryDatabase(databaseName);
	const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
	const database = indexedDB
		? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
		: null;
	context.after(() => { database?.close(); });
	const port: StorageRepositoryPort = { memory, database: async () => database };
	let token = 0;
	return {
		port,
		projects: new ProjectRepository(port, options.revisionLimit ?? 20),
		reachability: new LinkedVideoOriginalProjectReachabilityRepository(port, options),
		bindings: new LinkedVideoOriginalRepository(port, {
			now: () => new Date(NOW),
			createBindingToken: () => {
				token += 1;
				return `reachability_binding_${String(token).padStart(8, '0')}`;
			},
		}),
		memory,
		indexedDB,
		databaseName,
	};
}

async function seedBinding(
	fixture: ReachabilityFixture,
	projectId: string,
	source: TestVideoSource,
	locatorId: string,
): Promise<void> {
	const binding = await fixture.bindings.putIfCurrent(
		bindingInput(projectId, source, locatorId),
		null,
	);
	assert.ok(binding);
	const key = linkedVideoOriginalBindingKey(binding.projectId, binding.sourceId);
	const database = await fixture.port.database();
	if (!database) fixture.memory.linkedOriginalProvisionalRoots.delete(key);
	else await transact(
		database,
		LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		'readwrite',
		(stores) => request(stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].delete(key)),
	);
}

function bindingInput(
	projectId: string,
	source: TestVideoSource,
	locatorId: string,
): LinkedVideoOriginalBindingInput {
	return {
		schemaVersion: 1,
		projectId,
		sourceId: String(source.id),
		storageKey: String(source.storageKey),
		locatorId,
		locatorRevision: LOCATOR_REVISION,
		mimeType: String(source.mimeType),
		byteLength: 65_536,
		sha256: 'ab'.repeat(32),
		sourceShape: {
			frameCount: Number(source.frameCount),
			sampleRate: Number(source.sampleRate),
			width: Number(source.width),
			height: Number(source.height),
			frameRate: Number(source.frameRate),
			videoCodec: String(source.videoCodec),
			audioCodec: source.audioCodec === null ? null : String(source.audioCodec),
			hasAudio: Boolean(source.hasAudio),
		},
	};
}

function rootedProject(
	revision: number,
	roots: Readonly<{
		timeline?: TestVideoSource;
		bin?: TestVideoSource;
		fallback?: TestVideoSource;
	}>,
): AudioEditorProjectCurrent {
	const sources = [roots.timeline, roots.bin, roots.fallback].filter(
		(source): source is TestVideoSource => source !== undefined,
	);
	const timelineClip = roots.timeline ? createVideoClipV9({
		id: 'timeline-clip',
		sourceId: roots.timeline.id,
		durationFrames: roots.timeline.frameCount,
		sourceDurationFrames: roots.timeline.frameCount,
	}) : null;
	const binClip = roots.bin ? createVideoClipV9({
		id: 'bin-clip',
		binItemId: 'bin-item',
		sourceId: roots.bin.id,
		durationFrames: roots.bin.frameCount,
		sourceDurationFrames: roots.bin.frameCount,
	}) : null;
	return createCurrentAudioEditorProject({
		id: PROJECT_ID,
		title: 'Reachability fixture',
		revision,
		now: NOW,
		sources,
		clips: timelineClip ? [timelineClip] : [],
		tracks: timelineClip ? [createVideoTrackV9({
			id: 'timeline-track',
			name: 'Timeline video',
			clipIds: [timelineClip.id],
		})] : [],
		projectBin: { clips: binClip ? [binClip] : [] },
		featureRequirements: {
			schemaVersion: 1,
			requirements: roots.fallback ? [{
				id: 'publisher-video-fallback',
				featureId: 'publisher.example.video',
				displayName: 'Publisher video fallback',
				disposition: 'rendered-fallback',
				fallback: {
					kind: 'video',
					sourceId: roots.fallback.id,
					sha256: 'cd'.repeat(32),
				},
			}] : [],
		},
	});
}

function videoSource(id: string): TestVideoSource {
	return createVideoSourceV9({
		id,
		storageKey: `${id}-storage`,
		name: `${id}.mp4`,
		mimeType: 'video/mp4',
		frameCount: 90,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
	}) as TestVideoSource;
}
