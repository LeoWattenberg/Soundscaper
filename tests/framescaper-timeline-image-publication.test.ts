/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { applyFramescaperProjectCommandTimelineImage as applyCommand } from '../src/framescaper/editor-project-timeline-image-commands.ts';
import { createFramescaperProjectTimelineImage } from '../src/framescaper/editor-project-timeline-image.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_TIMELINE_IMAGE as BODY_ENCODING,
	FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_TIMELINE_IMAGE as BODY_KIND,
	FramescaperTimelineImagePublicationRepositoryTimelineImage as Repository,
	FramescaperTimelineImagePublisherTimelineImage as Publisher,
} from '../src/framescaper/editor-timeline-image-publication-timeline-image.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Data = Record<string, unknown>;

const NOW = '2026-09-05T12:00:00.000Z';
const LATER = '2026-09-06T12:00:00.000Z';
const BASE_TIME = '2026-08-13T12:00:00.000Z';
const COMMITTED_AT = '2026-09-05T11:00:00.000Z';
const PENDING_UNTIL = '2026-09-05T11:30:00.000Z';
const MEDIA_TOKEN = 'media-content-0123456789abcdef';

const FIXTURE = createFramescaperBaselineImageFixture({ sourceId: 'image-source', imageOnly: true });
const SOURCE = FIXTURE.source as unknown as Data;
const EXPECTED = createFramescaperProjectTimelineImage(PROFILE, framescaperV20Options() as never) as unknown as Data;
const TARGET = applyCommand(PROFILE, EXPECTED, {
	type: 'batch',
	commands: [{
		type: 'image-source/set', sourceId: 'image-source', expectedSource: null, source: SOURCE,
	}, {
		type: 'image-clip/set', clipId: 'image-clip', expectedClip: null, expectedPlacement: null,
		clip: {
			schemaVersion: 1, kind: 'image', id: 'image-clip', sourceId: 'image-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 20, sequenceFrameCount: 10, sourceStartTicks: '0',
		},
		placement: { scope: 'timeline', trackId: 'video-track' },
	}],
}, { now: NOW }) as unknown as Data;
const TRANSITION: Data = { expected: EXPECTED, project: TARGET };
const NEXT_KEY = revisionKey(EXPECTED.id, Number(TARGET.revision));

function revisionKey(projectId: unknown, revision: number): string {
	return `${String(projectId)}:${String(revision).padStart(12, '0')}`;
}

function stagedRow(overrides: Data = {}): Data {
	return {
		sourceId: SOURCE.storageKey, kind: BODY_KIND, encoding: BODY_ENCODING, mimeType: SOURCE.mimeType,
		size: SOURCE.assetByteLength, committedAt: COMMITTED_AT, pendingProjectUntil: PENDING_UNTIL,
		path: 'bodies/image-source', mediaContentDigestVersion: 1, mediaContentToken: MEDIA_TOKEN, sha256: SOURCE.contentSha256, ...overrides,
	};
}

interface Memory { readonly projects: Map<string, unknown>; readonly revisions: Map<string, unknown>; readonly mediaAssets: Map<string, unknown> }

function emptyMemory(): Memory {
	return { projects: new Map(), revisions: new Map(), mediaAssets: new Map() };
}

/** A memory port seeded with the exact base state; an explicit `undefined` seeds no row at all. */
function seededPort(overrides: Readonly<{
	project?: unknown; revision?: unknown; body?: unknown;
}> = {}): Readonly<{ memory: Memory; port: unknown }> {
	const memory = emptyMemory();
	const projectId = String(EXPECTED.id);
	const baseKey = revisionKey(projectId, Number(EXPECTED.revision));
	const seed = (map: Map<string, unknown>, key: string, field: string, fallback: unknown): void => {
		const value = Object.hasOwn(overrides, field) ? (overrides as Data)[field] : fallback;
		if (value !== undefined) map.set(key, value);
	};
	seed(memory.projects, projectId, 'project', structuredClone(EXPECTED));
	seed(memory.revisions, baseKey, 'revision', {
		key: baseKey, projectId, revision: Number(EXPECTED.revision), project: structuredClone(EXPECTED),
	});
	seed(memory.mediaAssets, String(SOURCE.storageKey), 'body', stagedRow());
	return { memory, port: { memory, database: async () => null } };
}

test('a fresh image source, clip and placement publish the exact next revision into memory storage', async () => {
	const { memory, port } = seededPort();

	const published = await new Repository(PROFILE, port).publishIfCurrent(TRANSITION) as unknown as Data;

	assert.notEqual(published, TARGET, 'the caller receives an independent clone, not the argument');
	assert.deepEqual(published, TARGET);
	assert.deepEqual(memory.projects.get(String(EXPECTED.id)), TARGET);
	assert.deepEqual(memory.revisions.get(NEXT_KEY), {
		key: NEXT_KEY, projectId: String(EXPECTED.id), revision: Number(TARGET.revision), project: TARGET,
	});
	const body = memory.mediaAssets.get(String(SOURCE.storageKey)) as Data;
	assert.equal(Object.hasOwn(body, 'pendingProjectUntil'), false, 'rooting the body ends its staged pending window');
	assert.equal(body.path, 'bodies/image-source', 'every other staged body field survives publication');
});

test('a project that moved out from under the transition answers null and writes nothing', async () => {
	const { memory, port } = seededPort({ project: structuredClone(TARGET) });
	assert.equal(await new Repository(PROFILE, port).publishIfCurrent(TRANSITION), null);
	assert.deepEqual(memory.projects.get(String(EXPECTED.id)), TARGET);
	assert.equal(memory.revisions.size, 1);
	assert.equal(Object.hasOwn(memory.mediaAssets.get('image-source') as Data, 'pendingProjectUntil'), true);
});

test('the exact base revision row must still hold the expected project', async () => {
	const projectId = String(EXPECTED.id);
	const key = revisionKey(projectId, Number(EXPECTED.revision));
	const row = { key, projectId, revision: Number(EXPECTED.revision), project: structuredClone(EXPECTED) };
	for (const revision of [
		undefined, { ...row, key: 'other' }, { ...row, projectId: 'other' },
		{ ...row, revision: Number(EXPECTED.revision) + 1 }, { ...row, project: structuredClone(TARGET) },
	]) {
		const port = seededPort({ revision }).port;
		await assert.rejects(
			() => new Repository(PROFILE, port).publishIfCurrent(TRANSITION),
			/base revision is missing or changed|base revision must be an object/u,
		);
	}
});

test('an occupied next revision refuses the publication rather than overwriting it', async () => {
	const { memory, port } = seededPort();
	memory.revisions.set(NEXT_KEY, { key: 'squatter' });
	await assert.rejects(() => new Repository(PROFILE, port).publishIfCurrent(TRANSITION), /next revision is occupied/u);
	assert.deepEqual(memory.projects.get(String(EXPECTED.id)), EXPECTED, 'the refusal leaves the current project rooted');
});

test('a staged body that drifted from its immutable source authority refuses the publication', async () => {
	for (const overrides of [
		{ sha256: 'ab'.repeat(32) }, { mediaContentDigestVersion: 0 }, { mediaContentToken: 'not-a-token' },
		{ size: 3 }, { mimeType: 'image/png' }, { kind: 'video' }, { encoding: 'other-encoding' },
		{ sourceId: 'other-body' }, { pendingProjectUntil: COMMITTED_AT },
	]) {
		const port = seededPort({ body: stagedRow(overrides) }).port;
		await assert.rejects(
			() => new Repository(PROFILE, port).publishIfCurrent(TRANSITION),
			/does not match its immutable source authority/u,
			`staged body override ${JSON.stringify(overrides)} must be refused`,
		);
	}
	const uncanonical = seededPort({ body: stagedRow({ committedAt: '2026-09-05T11:00:00Z' }) }).port;
	await assert.rejects(() => new Repository(PROFILE, uncanonical).publishIfCurrent(TRANSITION), /body committedAt must be canonical/u);
	const missing = seededPort({ body: undefined }).port;
	await assert.rejects(() => new Repository(PROFILE, missing).publishIfCurrent(TRANSITION), /staged image body must be an object/u);
});

test('an indexeddb-backed publication roots project, revision and body, or aborts writing nothing', async () => {
	const { database, port, memory } = await indexedPort();
	try {
		const published = await new Repository(PROFILE, port).publishIfCurrent(TRANSITION) as unknown as Data;

		assert.deepEqual(published, TARGET);
		assert.deepEqual(await read(database, 'projects', String(EXPECTED.id)), TARGET);
		assert.equal((await read(database, 'revisions', NEXT_KEY) as Data).revision, Number(TARGET.revision));
		assert.equal(Object.hasOwn(await read(database, 'mediaAssets', 'image-source') as Data, 'pendingProjectUntil'), false);
		assert.equal(memory.projects.size, 0, 'the indexeddb path never touches the degraded memory backend');
	} finally { database.close(); }

	const occupied = await indexedPort();
	try {
		await transact(occupied.database, 'revisions', 'readwrite', ({ revisions }) => (
			request(revisions.put({ key: NEXT_KEY, projectId: String(EXPECTED.id) }))
		));

		await assert.rejects(
			() => new Repository(PROFILE, occupied.port).publishIfCurrent(TRANSITION),
			/next revision is occupied/u,
		);
		assert.deepEqual(await read(occupied.database, 'projects', String(EXPECTED.id)), EXPECTED);
	} finally { occupied.database.close(); }
});

interface CodecStub {
	readonly commands: Data[]; readonly nows: unknown[]; readonly codec: unknown;
	authenticated: number; reconstruct: unknown;
}

/** The injectable codec seam, used to drive structural refusals past project validation. */
function codecStub(): CodecStub {
	const stub = {
		commands: [] as Data[], nows: [] as unknown[], authenticated: 0,
		reconstruct: undefined as unknown, codec: undefined as unknown,
	};
	stub.codec = {
		authenticate: () => { stub.authenticated += 1; },
		clone: (_profile: unknown, value: unknown) => structuredClone(value),
		apply: (_profile: unknown, _project: unknown, command: Data, options: Data) => {
			stub.commands.push(command); stub.nows.push(options.now); return stub.reconstruct;
		},
	};
	return stub;
}

function base(overrides: Data = {}): Data {
	return {
		id: 'project', revision: 0, updatedAt: BASE_TIME, sources: [], clips: [], projectBin: { clips: [] },
		tracks: [{ id: 'video-track', type: 'video', clipIds: [], locked: false }],
		sequences: [{ id: 'main', trackIds: ['video-track'] }], primarySequenceId: 'main', ...overrides,
	};
}

function next(overrides: Data = {}): Data {
	return base({
		revision: 1, updatedAt: LATER,
		sources: [{ id: 'image-source', kind: 'image' }],
		clips: [{ id: 'image-clip', kind: 'image', sourceId: 'image-source' }],
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['image-clip'], locked: false }],
		...overrides,
	});
}

/** Prepare one structural transition; it resolves to null because the stub port stores nothing. */
async function prepare(expected: Data, project: Data, reconstruct?: unknown): Promise<CodecStub> {
	const stub = codecStub();
	stub.reconstruct = reconstruct === undefined ? structuredClone(project) : reconstruct;
	await new Repository(PROFILE, { memory: emptyMemory(), database: async () => null }, stub.codec as never)
		.publishIfCurrent({ expected, project });
	return stub;
}

test('a publication may not change project identity, revision distance or timestamp order', async () => {
	await assert.rejects(() => prepare(base(), next({ id: 'other' })), /cannot change project identity/u);
	await assert.rejects(() => prepare(base({ revision: 1.5 }), next()), RangeError);
	await assert.rejects(() => prepare(base({ revision: -1 }), next()), /base revision must be a non-negative safe integer/u);
	const ceiling = Number.MAX_SAFE_INTEGER;
	await assert.rejects(() => prepare(base({ revision: ceiling }), next({ revision: ceiling })), /revision cannot increment safely/u);
	await assert.rejects(() => prepare(base(), next({ revision: 3 })), /must publish exactly the next revision/u);
	await assert.rejects(() => prepare(base(), next({ updatedAt: BASE_TIME })), /requires one fresh updatedAt timestamp/u);
	await assert.rejects(() => prepare(base(), next({ updatedAt: '2026-09-06T12:00:00Z' })), /updatedAt must be canonical/u);
	await assert.rejects(() => prepare(base(), next({ updatedAt: 7 })), /updatedAt must be a timestamp/u);
});

test('a publication adds exactly one fresh image source owning exactly one fresh image clip', async () => {
	const twoClips = {
		clips: [{ id: 'image-clip', kind: 'image', sourceId: 'image-source' }, { id: 'image-clip-2', kind: 'image', sourceId: 'image-source' }],
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['image-clip', 'image-clip-2'], locked: false }],
	};
	for (const [project, message] of [
		[next({ sources: [] }), /requires one fresh image source/u],
		[next({ sources: [{ id: 'image-source', kind: 'image' }, { id: 'second', kind: 'image' }] }),
			/requires one fresh image source/u],
		[next({ sources: [{ id: 'video-source', kind: 'video' }] }), /requires one fresh image source/u],
		[next({ clips: [] }), /requires one fresh image clip/u],
		[next(twoClips), /requires one fresh image clip/u],
		[next({ clips: [{ id: 'image-clip', kind: 'image', sourceId: 'other' }] }),
			/fresh timelineImage image clip must own its fresh source/u],
	] as readonly (readonly [Data, RegExp])[]) {
		await assert.rejects(() => prepare(base(), project), message);
	}
	const stub = await prepare(base(), next({
		sources: [{ id: 'video-source', kind: 'video' }, { id: 'image-source', kind: 'image' }],
	}));
	assert.equal((stub.commands[0]?.commands as Data[]).length, 2, 'a foreign fresh source is not the fresh image');
});

test('the fresh image clip requires exactly one placement owned by exactly one video track', async () => {
	const owned = { id: 'video-track', type: 'video', clipIds: ['image-clip'], locked: false };
	const audio = { id: 'audio-track', type: 'audio', clipIds: ['image-clip'], locked: false };
	for (const [project, message] of [
		[next({ projectBin: { clips: [{ id: 'image-clip', kind: 'image', sourceId: 'image-source' }] } }),
			/requires one fresh image clip/u],
		[next({ tracks: [] }), /requires one video-track owner/u],
		[next({ tracks: [owned, { ...owned, id: 'second' }], sequences: [{ id: 'main', trackIds: ['video-track', 'second'] }] }),
			/requires one video-track owner/u],
		[next({ tracks: [audio], sequences: [{ id: 'main', trackIds: ['audio-track'] }] }), /requires one video-track owner/u],
	] as readonly (readonly [Data, RegExp])[]) {
		await assert.rejects(() => prepare(base(), project), message);
	}
});

test('a project-bin placement reconstructs from the source and clip commands alone', async () => {
	const stub = await prepare(base(), next({
		clips: [], tracks: [{ id: 'video-track', type: 'video', clipIds: [], locked: false }],
		projectBin: { clips: [{ id: 'image-clip', kind: 'image', sourceId: 'image-source' }] },
	}));
	const commands = stub.commands[0]?.commands as Data[];
	assert.deepEqual(commands.map(({ type }) => type), ['image-source/set', 'image-clip/set']);
	assert.deepEqual(commands[1]?.placement, { scope: 'project-bin' });
	assert.deepEqual(commands[1]?.expectedClip, null, 'the clip is reconstructed as a fresh one, never a replacement');
	assert.deepEqual(stub.nows, [LATER], 'the reconstruction is dated by the published project itself');
});

test('a fresh timeline track is reconstructed as an empty track added at its exact index', async () => {
	const audioTrack = { id: 'audio-track', type: 'audio', clipIds: [], locked: false };
	const stub = await prepare(
		base({ tracks: [audioTrack], sequences: [{ id: 'main', trackIds: ['audio-track'] }] }),
		next({
			tracks: [{ id: 'video-track', type: 'video', clipIds: ['image-clip'], locked: false }, audioTrack],
			sequences: [{ id: 'main', trackIds: ['audio-track', 'video-track'] }],
		}),
	);
	const commands = stub.commands[0]?.commands as Data[];
	assert.deepEqual(commands.map(({ type }) => type), ['track/add', 'image-source/set', 'image-clip/set']);
	assert.deepEqual(commands[0], {
		type: 'track/add', index: 0, track: { id: 'video-track', type: 'video', clipIds: [], locked: false },
	});
});

test('a fresh timeline track must be single, unlocked, primary-sequenced and own only the fresh clip', async () => {
	const expected = base({ tracks: [], sequences: [{ id: 'main', trackIds: [] }] });
	const owned = { id: 'video-track', type: 'video', clipIds: ['image-clip'], locked: false };
	for (const [project, message] of [
		[next({
			tracks: [owned, { ...owned, id: 'video-track-2', clipIds: [] }],
			sequences: [{ id: 'main', trackIds: ['video-track', 'video-track-2'] }],
		}), /at most one timeline video track/u],
		[next({ clips: [], projectBin: { clips: [{ id: 'image-clip', kind: 'image', sourceId: 'image-source' }] } }),
			/at most one timeline video track/u],
		[next({ tracks: [{ ...owned, locked: true }] }), /must be unlocked and own only the fresh image clip/u],
		[next({
			clips: [{ id: 'image-clip', kind: 'image', sourceId: 'image-source' }, { id: 'kept', kind: 'video', sourceId: 'image-source' }],
			tracks: [{ ...owned, clipIds: ['image-clip', 'kept'] }],
		}), /must be unlocked and own only the fresh image clip/u],
		[next({ sequences: [{ id: 'main', trackIds: [] }, { id: 'second', trackIds: ['video-track'] }] }),
			/must belong only to the primary sequence/u],
	] as readonly (readonly [Data, RegExp])[]) {
		await assert.rejects(() => prepare(expected, project), message);
	}
});

test('a publication that also creates the timeline video track it needs is rooted whole', async () => {
	const project = applyCommand(PROFILE, EXPECTED, { type: 'batch', commands: [
		{ type: 'track/add', sequenceId: 'main-sequence', track: { id: 'image-track', name: 'Images', type: 'video', clipIds: [] } },
		{ type: 'image-source/set', sourceId: 'image-source', expectedSource: null, source: SOURCE },
		{
			type: 'image-clip/set', clipId: 'image-clip', expectedClip: null, expectedPlacement: null,
			placement: { scope: 'timeline', trackId: 'image-track' },
			clip: {
				schemaVersion: 1, kind: 'image', id: 'image-clip', sourceId: 'image-source', sequenceId: 'main-sequence',
				sequenceStartFrame: 0, sequenceFrameCount: 10, sourceStartTicks: '0',
			},
		},
	] }, { now: NOW }) as unknown as Data;
	const { memory, port } = seededPort();
	const published = await new Repository(PROFILE, port).publishIfCurrent({ expected: EXPECTED, project }) as unknown as Data;
	assert.deepEqual(published, project);
	assert.deepEqual(memory.projects.get(String(EXPECTED.id)), project);
	assert.equal((published.tracks as Data[]).some(({ id }) => id === 'image-track'), true);
});

test('a publication transition is a closed record adding nothing beyond its source, clip and placement', async () => {
	const stub = codecStub();
	const repository = new Repository(PROFILE, { memory: emptyMemory(), database: async () => null }, stub.codec as never);

	await assert.rejects(() => repository.publishIfCurrent([EXPECTED, TARGET]), /publication must be a record/u);
	const accessor = Object.defineProperty({ project: TARGET }, 'expected', { enumerable: true, get: () => EXPECTED });
	await assert.rejects(() => repository.publishIfCurrent(accessor), /publication\.expected must be an enumerable data property/u);
	await assert.rejects(() => prepare(base({ sources: [{ kind: 'image' }] }), next()), /image identity must be non-empty/u);
	await assert.rejects(() => prepare(base({ sources: 'none' }), next()), /base sources must be an array/u);
	await assert.rejects(() => prepare(base(), next({ projectBin: null })), /project bin must be an object/u);
	await assert.rejects(() => prepare(base(), next({ title: 'Renamed' }), next()), /may add only one source, one clip, and its placement/u);
});

interface StoreHarness { readonly store: unknown; readonly log: string[]; readonly chunks: number[]; readonly begun: Data[] }

interface StoreOptions {
	readonly maximumChunkBytes?: number; readonly failWrite?: Error;
	readonly failAbort?: Error; readonly metadata?: Data | null; readonly onWrite?: () => void;
}

function ownedMetadata(overrides: Data = {}): Data {
	return {
		sha256: SOURCE.contentSha256, size: SOURCE.assetByteLength, mimeType: SOURCE.mimeType,
		kind: BODY_KIND, encoding: BODY_ENCODING, pendingProjectUntil: PENDING_UNTIL, ...overrides,
	};
}

function createStore(options: StoreOptions = {}): StoreHarness {
	const log: string[] = [];
	const chunks: number[] = [];
	const begun: Data[] = [];
	const store = {
		async beginMediaAssetWrite(sourceId: string, metadata: Data, writeOptions: Data) {
			log.push('begin');
			begun.push({ sourceId, metadata, options: writeOptions });
			return {
				maximumChunkBytes: options.maximumChunkBytes ?? 4_096, bytesWritten: 0,
				async write(value: Uint8Array) {
					chunks.push(value.byteLength);
					options.onWrite?.();
					if (options.failWrite) throw options.failWrite;
				},
				async commit() { log.push('commit'); return {}; },
				async abort() { log.push('abort'); if (options.failAbort) throw options.failAbort; },
			};
		},
		async getMediaAssetMetadata() {
			log.push('metadata');
			return options.metadata === undefined ? ownedMetadata() : options.metadata;
		},
		async deleteMediaAsset() { log.push('delete'); },
	};
	return { store, log, chunks, begun };
}

function publisherFor(harness: StoreHarness, port: unknown): Publisher {
	return new Publisher(PROFILE, { port, store: harness.store });
}

function publication(overrides: Data = {}): Data {
	return { expected: EXPECTED, project: TARGET, bytes: FIXTURE.bytes, ...overrides };
}

test('a publisher streams the staged body in writer-sized chunks and then publishes the revision', async () => {
	const { memory, port } = seededPort();
	const harness = createStore({ maximumChunkBytes: 128 });
	const published = await publisherFor(harness, port).publishIfCurrent(publication()) as unknown as Data;

	assert.deepEqual(published, TARGET);
	assert.deepEqual(harness.log, ['begin', 'commit'], 'a published revision never rolls the owned body back');
	assert.equal(harness.chunks.reduce((total, size) => total + size, 0), FIXTURE.bytes.byteLength);
	assert.ok(harness.chunks.length > 1 && harness.chunks.every((size) => size <= 128));
	assert.equal(harness.begun[0]?.sourceId, SOURCE.storageKey);
	assert.deepEqual(harness.begun[0]?.metadata, { name: SOURCE.name, kind: BODY_KIND, encoding: BODY_ENCODING, mimeType: SOURCE.mimeType });
	assert.deepEqual(harness.begun[0]?.options, { expectedBytes: SOURCE.assetByteLength, expectedSha256: SOURCE.contentSha256 });
	assert.equal(Object.hasOwn(memory.mediaAssets.get('image-source') as Data, 'pendingProjectUntil'), false);
});

test('a compare-and-set that does not root the body deletes the body the publisher owned', async () => {
	const superseded = seededPort({ project: structuredClone(TARGET) });
	const deleting = createStore();
	assert.equal(await publisherFor(deleting, superseded.port).publishIfCurrent(publication()), null);
	assert.deepEqual(deleting.log, ['begin', 'commit', 'metadata', 'delete']);

	const vanished = createStore({ metadata: null });
	assert.equal(await publisherFor(vanished, superseded.port).publishIfCurrent(publication()), null);
	assert.deepEqual(vanished.log, ['begin', 'commit', 'metadata'], 'a body that already vanished is not deleted again');

	const { memory, port } = seededPort();
	memory.revisions.set(NEXT_KEY, { key: 'squatter' });
	const failed = createStore();
	await assert.rejects(() => publisherFor(failed, port).publishIfCurrent(publication()), /next revision is occupied/u);
	assert.deepEqual(failed.log, ['begin', 'commit', 'metadata', 'delete']);
});

test('a superseded publication whose staged body was replaced refuses to delete what it no longer owns', async () => {
	const { port } = seededPort({ project: structuredClone(TARGET) });
	for (const metadata of [
		ownedMetadata({ sha256: 'ab'.repeat(32) }), ownedMetadata({ size: 3 }), ownedMetadata({ kind: 'video' }),
		ownedMetadata({ mimeType: 'image/png' }), ownedMetadata({ encoding: 'other' }),
		Object.fromEntries(Object.entries(ownedMetadata()).filter(([key]) => key !== 'pendingProjectUntil')),
	]) {
		const harness = createStore({ metadata });
		await assert.rejects(() => publisherFor(harness, port).publishIfCurrent(publication()), (error: Error) => {
			assert.ok(error instanceof AggregateError, 'the refused rollback is reported with the failure that caused it');
			assert.match(error.message, /publication and owned-body rollback both failed/u);
			assert.deepEqual(error.errors.map((cause: Error) => cause.message), [
				'The staged timelineImage image body lost cleanup ownership.',
				'The staged timelineImage image body lost cleanup ownership.',
			]);
			return true;
		});
		assert.equal(harness.log.includes('delete'), false, 'a disowned body is never deleted');
	}
});

test('a failed body write aborts the staged writer and rethrows, reporting a failed abort alongside it', async () => {
	const { port } = seededPort();
	const failWrite = new Error('The staged chunk could not be written.');
	const failAbort = new Error('The staged writer could not be aborted.');
	const harness = createStore({ failWrite });
	await assert.rejects(() => publisherFor(harness, port).publishIfCurrent(publication()), failWrite);
	assert.deepEqual(harness.log, ['begin', 'abort']);
	await assert.rejects(
		() => publisherFor(createStore({ failWrite, failAbort }), port).publishIfCurrent(publication()),
		(error: Error) => error instanceof AggregateError && error.errors.length === 2 && error.errors[1] === failAbort,
	);
});

test('publication bytes must match the exact asset length and its complete body digest', async () => {
	const { port } = seededPort();
	const harness = createStore();
	const publisher = publisherFor(harness, port);
	const corrupted = FIXTURE.bytes.slice();
	corrupted[corrupted.byteLength - 1] ^= 0xff;

	for (const bytes of [FIXTURE.bytes.slice(0, FIXTURE.bytes.byteLength - 1), FIXTURE.bytes.buffer, [1, 2, 3]]) {
		await assert.rejects(
			() => publisher.publishIfCurrent(publication({ bytes })),
			/publication bytes must match the exact asset length/u,
		);
	}
	await assert.rejects(() => publisher.publishIfCurrent(publication({ bytes: corrupted })), /fail their complete body digest binding/u);
	assert.deepEqual(harness.log, [], 'a rejected body never opens a staged write');
});

test('a cancelled publication rejects with the signal reason and stages nothing further', async () => {
	const { port } = seededPort();
	const harness = createStore();
	const reason = new Error('The image import was cancelled.');

	await assert.rejects(() => publisherFor(harness, port).publishIfCurrent(publication({ signal: AbortSignal.abort(reason) })), reason);
	assert.deepEqual(harness.log, []);
	await assert.rejects(
		() => publisherFor(harness, port).publishIfCurrent(publication({ signal: 'later' })),
		/publication signal must be an AbortSignal/u,
	);

	const controller = new AbortController();
	const streaming = createStore({ maximumChunkBytes: 128, onWrite: () => { controller.abort(); } });
	await assert.rejects(
		() => publisherFor(streaming, port).publishIfCurrent(publication({ signal: controller.signal })),
		(error: Error) => error.name === 'AbortError',
	);
	assert.deepEqual(streaming.log, ['begin', 'abort']);
	assert.equal(streaming.chunks.length, 1, 'cancellation stops the stream at its next chunk boundary');
});

test('a publisher requires a whole owned-body store and a whole project codec', async () => {
	const { port } = seededPort();
	const complete = createStore().store as Data;
	for (const method of ['beginMediaAssetWrite', 'getMediaAssetMetadata', 'deleteMediaAsset']) {
		assert.throws(
			() => new Publisher(PROFILE, { port, store: { ...complete, [method]: 'not a function' } }),
			new RegExp(`publication store requires ${method}`, 'u'),
		);
	}
	assert.throws(() => new Publisher(PROFILE, { port, store: null }), /publication store is required/u);
	const halfCodec = { authenticate: () => undefined, clone: () => undefined };
	assert.throws(() => new Publisher(PROFILE, { port, store: complete, projectCodec: halfCodec }), /codec requires apply/u);

	const stub = codecStub();
	const publisher = new Publisher(PROFILE, { port, store: complete, projectCodec: stub.codec });
	const authenticatedAtConstruction = stub.authenticated;
	await assert.rejects(() => publisher.publishIfCurrent({}), /publication request has unsupported, missing/u);
	assert.equal(stub.authenticated, authenticatedAtConstruction + 1, 'every request reauthenticates the profile');
});

async function indexedPort(): Promise<Readonly<{ database: IDBDatabase; port: unknown; memory: Memory }>> {
	const factory = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const database = await openDatabase(factory, `publication-${String(Math.random()).slice(2)}`);
	const projectId = String(EXPECTED.id);
	const revision = Number(EXPECTED.revision);
	await transact(database, ['projects', 'revisions', 'mediaAssets'], 'readwrite', async ({ projects, revisions, mediaAssets }) => {
		await request(projects.put(structuredClone(EXPECTED)));
		await request(revisions.put({ key: revisionKey(projectId, revision), projectId, revision, project: structuredClone(EXPECTED) }));
		await request(mediaAssets.put(stagedRow()));
	});
	const memory = emptyMemory();
	return { database, port: { memory, database: async () => database }, memory };
}

function read(database: IDBDatabase, storeName: string, key: string): Promise<unknown> {
	return transact(database, storeName, 'readonly', (stores) => request(stores[storeName]!.get(key)));
}
