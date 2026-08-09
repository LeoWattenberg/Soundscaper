/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10, type AudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
} from '../src/common/editor/project-v9.ts';
import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	type LinkedOriginalBindingInput,
} from '../src/common/editor/storage/linked-original-binding.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import { LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME } from '../src/common/editor/storage/linked-original-provisional-root.ts';
import { LinkedOriginalStartupReconciliationRepository } from '../src/common/editor/storage/linked-original-startup-reconciliation-repository.ts';
import {
	LINKED_ORIGINAL_STORE_NAME,
	linkedOriginalBindingKey,
} from '../src/common/editor/storage/linked-original-schema.ts';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { ProjectRepository } from '../src/common/editor/storage/project-repository.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-03T12:00:00.000Z';
const LOCATOR_REVISION = 'locator_revision_00000001';

test('startup reconciliation unions exact current/history roots and preserves surviving aliases', async (context) => {
	const fixture = await createFixture(context);
	const projectId = 'startup-exact-project';
	const historical = audioSource('historical-source');
	const current = videoSource('current-source');
	const stale = audioSource('stale-source');
	const absent = videoSource('absent-source');
	await fixture.projects.save(project(projectId, 1, historical));
	await fixture.projects.save(project(projectId, 2, current));
	await Promise.all([
		seedBinding(fixture, projectId, historical, 'locator_historical_0001'),
		seedBinding(fixture, projectId, current, 'locator_current_0000001'),
		seedBinding(fixture, projectId, stale, 'locator_aliased_0000001'),
		seedBinding(fixture, 'startup-missing-shadow', stale, 'locator_aliased_0000001'),
		seedBinding(fixture, 'startup-absent-project', absent, 'locator_absent_0000001'),
	]);

	const references = await fixture.startup.reconcileDurableLocatorReferences([
		{ id: projectId, revision: 2 },
		{ id: 'startup-missing-shadow', revision: 4 },
	]);

	assert.deepEqual(references, [
		{ kind: 'audio', locatorId: 'locator_aliased_0000001', locatorRevision: LOCATOR_REVISION },
		{ kind: 'audio', locatorId: 'locator_historical_0001', locatorRevision: LOCATOR_REVISION },
		{ kind: 'video', locatorId: 'locator_current_0000001', locatorRevision: LOCATOR_REVISION },
	]);
	assert.ok(await fixture.bindings.get(projectId, historical.id), 'retained revisions remain roots');
	assert.ok(await fixture.bindings.get(projectId, current.id), 'the exact current graph remains a root');
	assert.equal(await fixture.bindings.get(projectId, stale.id), null, 'an unreachable exact-live row is pruned');
	assert.ok(await fixture.bindings.get('startup-missing-shadow', stale.id), 'a surviving alias retains its locator');
	assert.equal(await fixture.bindings.get('startup-absent-project', absent.id), null);
});

test('catalog-live missing, stale, future, legacy, and malformed local graphs retain bindings', async (context) => {
	const fixture = await createFixture(context);
	const exact = audioSource('exact-stale-source');
	const cases = [
		{ id: 'startup-missing-local', local: null, catalogRevision: 2 },
		{ id: 'startup-stale-local', local: project('startup-stale-local', 1), catalogRevision: 2 },
		{ id: 'startup-future-local', local: project('startup-future-local', 3), catalogRevision: 2 },
	] as const;
	for (const candidate of cases) {
		if (candidate.local) await fixture.projects.save(candidate.local);
		await seedBinding(fixture, candidate.id, exact, 'locator_conservative_00001');
	}
	await putMalformedProject(fixture.database, 'startup-legacy-local', 2, 8);
	await putMalformedProject(fixture.database, 'startup-malformed-local', 2, 9, true);
	await seedBinding(fixture, 'startup-legacy-local', exact, 'locator_conservative_00001');
	await seedBinding(fixture, 'startup-malformed-local', exact, 'locator_conservative_00001');
	const historyId = 'startup-malformed-history';
	await fixture.projects.save(project(historyId, 1));
	await fixture.projects.save(project(historyId, 2));
	await corruptRevision(fixture.database, historyId, 1);
	await seedBinding(fixture, historyId, exact, 'locator_conservative_00001');
	const exactId = 'startup-independent-exact';
	await fixture.projects.save(project(exactId, 2));
	await seedBinding(fixture, exactId, exact, 'locator_conservative_00001');

	const summaries = [
		...cases.map(({ id, catalogRevision: revision }) => ({ id, revision })),
		{ id: 'startup-legacy-local', revision: 2 },
		{ id: 'startup-malformed-local', revision: 2 },
		{ id: historyId, revision: 2 },
		{ id: exactId, revision: 2 },
	];
	await fixture.startup.reconcileDurableLocatorReferences(summaries);

	for (const { id } of summaries.slice(0, -1)) {
		assert.ok(await fixture.bindings.get(id, exact.id), `${id} must be retained conservatively`);
	}
	assert.equal(await fixture.bindings.get(exactId, exact.id), null, 'one bad owner does not block exact peers');
});

test('video-only startup reconciliation preserves audio rows and deletes only planned video rows atomically', async (context) => {
	const fixture = await createFixture(context);
	const projectId = 'startup-video-facade';
	const liveVideo = videoSource('live-video');
	const staleVideo = videoSource('stale-video');
	const audio = audioSource('unmanaged-audio');
	await fixture.projects.save(project(projectId, 1, liveVideo));
	await Promise.all([
		seedBinding(fixture, projectId, liveVideo, 'locator_live_video_000001'),
		seedBinding(fixture, projectId, staleVideo, 'locator_stale_video_00001'),
		seedBinding(fixture, 'startup-absent-video', staleVideo, 'locator_stale_video_00001'),
		seedBinding(fixture, 'startup-absent-audio', audio, 'locator_absent_audio_0001'),
	]);

	const references = await fixture.startup.reconcileDurableVideoLocatorReferences([
		{ id: projectId, revision: 1 },
	]);

	assert.deepEqual(references, [{
		locatorId: 'locator_live_video_000001', locatorRevision: LOCATOR_REVISION,
	}]);
	assert.equal(await fixture.bindings.get(projectId, staleVideo.id), null);
	assert.equal(await fixture.bindings.get('startup-absent-video', staleVideo.id), null);
	assert.ok(await fixture.bindings.get('startup-absent-audio', audio.id));
});

test('matching-current proof requires its retained row and unions divergent same-revision graphs', async (context) => {
	const fixture = await createFixture(context);
	const missingRevisionId = 'startup-missing-current-revision';
	const missingRevisionSource = audioSource('missing-revision-stale');
	await fixture.projects.save(project(missingRevisionId, 2));
	await deleteRevision(fixture.database, missingRevisionId, 2);
	await seedBinding(fixture, missingRevisionId, missingRevisionSource, 'locator_missing_revision_01');

	const divergentId = 'startup-divergent-same-revision';
	const retainedSource = audioSource('divergent-retained-source');
	const currentSource = videoSource('divergent-current-source');
	const staleSource = audioSource('divergent-stale-source');
	await fixture.projects.save(project(divergentId, 3, retainedSource));
	await putCurrentProject(fixture.database, project(divergentId, 3, currentSource));
	await Promise.all([
		seedBinding(fixture, divergentId, retainedSource, 'locator_divergent_retained1'),
		seedBinding(fixture, divergentId, currentSource, 'locator_divergent_current01'),
		seedBinding(fixture, divergentId, staleSource, 'locator_divergent_stale001'),
	]);

	await fixture.startup.reconcileDurableLocatorReferences([
		{ id: missingRevisionId, revision: 2 },
		{ id: divergentId, revision: 3 },
	]);

	assert.ok(await fixture.bindings.get(missingRevisionId, missingRevisionSource.id));
	assert.ok(await fixture.bindings.get(divergentId, retainedSource.id));
	assert.ok(await fixture.bindings.get(divergentId, currentSource.id));
	assert.equal(await fixture.bindings.get(divergentId, staleSource.id), null);
});

test('over-limit retained history is conservative while Project Bin and fallback sources are exact roots', async (context) => {
	const fixture = await createFixture(context);
	const overLimitId = 'startup-over-limit-history';
	const overLimitSource = audioSource('over-limit-stale-source');
	await fixture.projects.save(project(overLimitId, 64));
	await putRevisionRange(fixture.database, overLimitId, 0, 63);
	await seedBinding(fixture, overLimitId, overLimitSource, 'locator_over_limit_history1');

	const rootsId = 'startup-bin-fallback-roots';
	const bin = videoSource('startup-bin-source');
	const fallback = audioSource('startup-fallback-source');
	const stale = audioSource('startup-nonroot-source');
	await fixture.projects.save(projectWithBinAndFallback(rootsId, 1, bin, fallback));
	await Promise.all([
		seedBinding(fixture, rootsId, bin, 'locator_bin_root_00000001'),
		seedBinding(fixture, rootsId, fallback, 'locator_fallback_root_0001'),
		seedBinding(fixture, rootsId, stale, 'locator_nonroot_000000001'),
	]);

	await fixture.startup.reconcileDurableLocatorReferences([
		{ id: overLimitId, revision: 64 },
		{ id: rootsId, revision: 1 },
	]);

	assert.ok(await fixture.bindings.get(overLimitId, overLimitSource.id));
	assert.ok(await fixture.bindings.get(rootsId, bin.id));
	assert.ok(await fixture.bindings.get(rootsId, fallback.id));
	assert.equal(await fixture.bindings.get(rootsId, stale.id), null);
});

test('full locator-reference bounds reject before deleting catalog-absent rows', async (context) => {
	const fixture = await createFixture(context);
	const first = audioSource('bounded-absent-first');
	const second = videoSource('bounded-absent-second');
	await Promise.all([
		seedBinding(fixture, 'bounded-absent-project-one', first, 'locator_bounded_absent_01'),
		seedBinding(fixture, 'bounded-absent-project-two', second, 'locator_bounded_absent_02'),
	]);
	const bounded = new LinkedOriginalStartupReconciliationRepository(fixture.port, {
		maximumInventoryReferences: 1,
	});
	const exoticSummary = Object.assign(Object.create({ inherited: true }) as object, {
		id: 'bounded-absent-project-one', revision: 1,
	});
	await assert.rejects(
		fixture.startup.reconcileDurableLocatorReferences([exoticSummary] as never),
		/plain object/iu,
	);

	await assert.rejects(
		bounded.reconcileDurableLocatorReferences([]),
		/locator-reference limit|reference.*limit/iu,
	);
	assert.ok(await fixture.bindings.get('bounded-absent-project-one', first.id));
	assert.ok(await fixture.bindings.get('bounded-absent-project-two', second.id));
});

test('aggregate root overflow disables source pruning but preserves authoritative absent deletion', async (context) => {
	const fixture = await createFixture(context);
	const firstRoot = audioSource('aggregate-first-root');
	const firstStale = audioSource('aggregate-first-stale');
	const secondRoot = videoSource('aggregate-second-root');
	const secondStale = videoSource('aggregate-second-stale');
	const absent = audioSource('aggregate-absent');
	await fixture.projects.save(project('aggregate-first-project', 1, firstRoot));
	await fixture.projects.save(project('aggregate-second-project', 1, secondRoot));
	await Promise.all([
		seedBinding(fixture, 'aggregate-first-project', firstStale, 'locator_aggregate_first_stale'),
		seedBinding(fixture, 'aggregate-second-project', secondStale, 'locator_aggregate_second_stale'),
		seedBinding(fixture, 'aggregate-absent-project', absent, 'locator_aggregate_absent_001'),
	]);
	const bounded = new LinkedOriginalStartupReconciliationRepository(fixture.port, { maximumRoots: 1 });

	await bounded.reconcileDurableLocatorReferences([
		{ id: 'aggregate-first-project', revision: 1 },
		{ id: 'aggregate-second-project', revision: 1 },
	]);

	assert.ok(await fixture.bindings.get('aggregate-first-project', firstStale.id));
	assert.ok(await fixture.bindings.get('aggregate-second-project', secondStale.id));
	assert.equal(await fixture.bindings.get('aggregate-absent-project', absent.id), null);
});

test('binding deletion failure aborts the complete startup transaction and a retry succeeds', async (context) => {
	const fixture = await createFixture(context);
	const projectId = 'startup-delete-rollback';
	const stale = audioSource('startup-delete-rollback-stale');
	const absent = videoSource('startup-delete-rollback-absent');
	await fixture.projects.save(project(projectId, 1));
	await Promise.all([
		seedBinding(fixture, projectId, stale, 'locator_delete_rollback_stale'),
		seedBinding(fixture, 'startup-delete-rollback-absent', absent, 'locator_delete_rollback_absent'),
	]);
	const failure = new Error('planned startup binding deletion failure');
	fixture.indexedDB.failNextDeleteForStore(LINKED_ORIGINAL_STORE_NAME, failure);

	await assert.rejects(
		fixture.startup.reconcileDurableLocatorReferences([{ id: projectId, revision: 1 }]),
		(error) => error === failure,
	);
	assert.ok(await fixture.bindings.get(projectId, stale.id));
	assert.ok(await fixture.bindings.get('startup-delete-rollback-absent', absent.id));
	assert.deepEqual(
		await fixture.startup.reconcileDurableLocatorReferences([{ id: projectId, revision: 1 }]),
		[],
	);
	assert.equal(await fixture.bindings.get(projectId, stale.id), null);
	assert.equal(await fixture.bindings.get('startup-delete-rollback-absent', absent.id), null);
});

interface TestSource extends Readonly<Record<string, unknown>> {
	readonly kind: 'audio' | 'video';
	readonly id: string;
}

interface Fixture {
	readonly database: IDBDatabase;
	readonly indexedDB: ReturnType<typeof createInstrumentedIndexedDB>;
	readonly port: StorageRepositoryPort;
	readonly projects: ProjectRepository;
	readonly bindings: LinkedOriginalRepository;
	readonly startup: LinkedOriginalStartupReconciliationRepository;
}

async function createFixture(context: TestContext): Promise<Fixture> {
	const databaseName = `linked-original-startup-${Date.now()}-${Math.random()}`;
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const port: StorageRepositoryPort = {
		memory: getMemoryDatabase(databaseName),
		database: async () => database,
	};
	let token = 0;
	return {
		database,
		indexedDB,
		port,
		projects: new ProjectRepository(port, 20),
		bindings: new LinkedOriginalRepository(port, {
			now: () => new Date(NOW),
			createBindingToken: () => `startup_binding_${String(++token).padStart(16, '0')}`,
		}),
		startup: new LinkedOriginalStartupReconciliationRepository(port),
	};
}

async function seedBinding(
	fixture: Fixture,
	projectId: string,
	source: TestSource,
	locatorId: string,
): Promise<void> {
	const binding = await fixture.bindings.putIfCurrent(bindingInput(projectId, source, locatorId), null);
	assert.ok(binding);
	await transact(
		fixture.database,
		LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		'readwrite',
		(stores) => request(
			stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].delete(
				linkedOriginalBindingKey(binding.projectId, binding.sourceId),
			),
		),
	);
}

function bindingInput(projectId: string, source: TestSource, locatorId: string): LinkedOriginalBindingInput {
	const shared = {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		projectId, sourceId: source.id, storageKey: String(source.storageKey), locatorId,
		locatorRevision: LOCATOR_REVISION, mimeType: String(source.mimeType),
		byteLength: 65_536, sha256: 'ab'.repeat(32),
	};
	return source.kind === 'audio' ? {
		...shared, kind: 'audio', sourceShape: {
			frameCount: Number(source.frameCount), channelCount: Number(source.channelCount),
			sampleRate: Number(source.sampleRate), originalSampleRate: Number(source.originalSampleRate),
			sampleFormat: 'float32', chunkFrames: Number(source.chunkFrames),
		},
	} : {
		...shared, kind: 'video', sourceShape: {
			frameCount: Number(source.frameCount), sampleRate: Number(source.sampleRate),
			width: Number(source.width), height: Number(source.height), frameRate: Number(source.frameRate),
			videoCodec: String(source.videoCodec), audioCodec: source.audioCodec === null ? null : String(source.audioCodec),
			hasAudio: Boolean(source.hasAudio),
		},
	};
}

function project(id: string, revision: number, source?: TestSource): AudioEditorProjectV10 {
	const clip = source?.kind === 'audio'
		? createAudioClipV9({ id: `${id}-clip`, sourceId: source.id, durationFrames: 120, sourceDurationFrames: 120 })
		: source?.kind === 'video'
			? createVideoClipV9({ id: `${id}-clip`, sourceId: source.id, durationFrames: 120, sourceDurationFrames: 120 })
			: null;
	return createAudioEditorProjectV10({
		id, title: id, revision, now: NOW,
		sources: source ? [source] : [],
		clips: clip ? [clip] : [],
		tracks: clip ? [source?.kind === 'audio'
			? createAudioTrackV9({ id: `${id}-track`, clipIds: [clip.id] })
			: createVideoTrackV9({ id: `${id}-track`, clipIds: [clip.id] })] : [],
	});
}

function projectWithBinAndFallback(
	id: string,
	revision: number,
	bin: TestSource,
	fallback: TestSource,
): AudioEditorProjectV10 {
	const binClip = createVideoClipV9({
		id: `${id}-bin-clip`, binItemId: `${id}-bin-item`, sourceId: bin.id,
		durationFrames: 120, sourceDurationFrames: 120,
	});
	return createAudioEditorProjectV10({
		id, title: id, revision, now: NOW,
		sources: [bin, fallback],
		projectBin: { clips: [binClip] },
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: `${id}-feature`, featureId: 'publisher.example.startup',
			displayName: 'Startup fallback', disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: fallback.id, sha256: 'cd'.repeat(32) },
		}] },
	});
}

function audioSource(id: string): TestSource {
	return createAudioSourceV9({
		id, storageKey: `${id}-storage`, mimeType: 'audio/wav', frameCount: 120,
		channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	}) as TestSource;
}

function videoSource(id: string): TestSource {
	return createVideoSourceV9({
		id, storageKey: `${id}-storage`, mimeType: 'video/mp4', frameCount: 120,
		sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
		videoCodec: 'h264', audioCodec: 'aac', hasAudio: true,
	}) as TestSource;
}

async function putMalformedProject(
	database: IDBDatabase,
	projectId: string,
	revision: number,
	schemaVersion: number,
	malformed = false,
): Promise<void> {
	const value = malformed ? { id: projectId, revision, schemaVersion } : {
		...project(projectId, revision), schemaVersion,
	};
	await transact(database, ['projects', 'revisions'], 'readwrite', ({ projects, revisions }) => Promise.all([
		request(projects.put(value)),
		request(revisions.put({
			key: revisionKey(projectId, revision), projectId, revision, project: value,
		})),
	]));
}

async function corruptRevision(database: IDBDatabase, projectId: string, revision: number): Promise<void> {
	await transact(database, 'revisions', 'readwrite', ({ revisions }) => request(revisions.put({
		key: revisionKey(projectId, revision), projectId, revision,
		project: { id: projectId, revision, schemaVersion: 9 },
	})));
}

async function deleteRevision(database: IDBDatabase, projectId: string, revision: number): Promise<void> {
	await transact(database, 'revisions', 'readwrite', ({ revisions }) => request(
		revisions.delete(revisionKey(projectId, revision)),
	));
}

async function putCurrentProject(database: IDBDatabase, value: AudioEditorProjectV10): Promise<void> {
	await transact(database, 'projects', 'readwrite', ({ projects }) => request(projects.put(value)));
}

async function putRevisionRange(
	database: IDBDatabase,
	projectId: string,
	first: number,
	last: number,
): Promise<void> {
	await transact(database, 'revisions', 'readwrite', ({ revisions }) => Promise.all(
		Array.from({ length: last - first + 1 }, (_, offset) => first + offset).map((revision) => {
			const value = project(projectId, revision);
			return request(revisions.put({
				key: revisionKey(projectId, revision), projectId, revision, project: value,
			}));
		}),
	));
}

function revisionKey(projectId: string, revision: number): string {
	return `${projectId}:${String(revision).padStart(12, '0')}`;
}
