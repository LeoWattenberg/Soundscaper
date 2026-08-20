/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoClip,
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';
import {
	desktopSharedLinkedVideoGroupMatches,
	desktopSharedLinkedVideoTrustedSourceIds,
	overlayDesktopSharedLinkedVideoOriginals,
	resolveDesktopSharedProjectLinkedVideoOriginals,
	type DesktopSharedLinkedVideoOriginalSession,
} from '../src/common/editor/storage/desktop-shared-project-linked-video-originals.ts';
import { LinkedVideoOriginalRepository } from '../src/common/editor/storage/linked-video-original-repository.ts';
import {
	LinkedVideoOriginalResolver,
	type LinkedVideoOriginalPort,
} from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

const PROJECT_ID = 'linked-video-session-project';
const LOCATOR_ID = 'locator_session_00000001';
const LOCATOR_REVISION = 'snapshot_session_00000001';

test('an opaque linked-video session verifies one shared alias body and overlays only exact reads', async () => {
	const body = new Blob(['shared linked alias body'], { type: 'video/mp4' });
	const reads: Array<Readonly<{ locatorId: string; expectedRevision: string | null }>> = [];
	const port: LinkedVideoOriginalPort = {
		load(locatorId, { expectedRevision }) {
			reads.push({ locatorId, expectedRevision });
			return { blob: body, locatorRevision: LOCATOR_REVISION };
		},
	};
	const { repository, resolver } = resolverFixture(port);
	const sources = [videoSource('video-a'), videoSource('video-b')];
	const project = videoProject(sources);
	for (const source of sources) await resolver.bind(PROJECT_ID, source, LOCATOR_ID);
	reads.length = 0;

	const session = await resolveDesktopSharedProjectLinkedVideoOriginals(project, resolver);
	assert.deepEqual([...desktopSharedLinkedVideoTrustedSourceIds(session)].sort(), ['video-a', 'video-b']);
	assert.deepEqual(reads, [], 'group inspection must not read a body before aggregate preflight');
	const firstBinding = await repository.get(PROJECT_ID, sources[0].id);
	assert.ok(firstBinding);
	const fallbackCalls: string[] = [];
	const overlay = overlayDesktopSharedLinkedVideoOriginals(session, {
		getMediaAssetMetadata(storageKey: string) {
			fallbackCalls.push(`metadata:${storageKey}`);
			return null;
		},
		loadMediaAsset(storageKey: string) {
			fallbackCalls.push(`body:${storageKey}`);
			return null;
		},
	});
	const metadata = await overlay.getMediaAssetMetadata(sources[0].storageKey);
	assert.deepEqual(reads, []);
	assert.deepEqual(metadata, {
		sourceId: sources[0].storageKey,
		storage: 'linked-video-original-v1',
		path: null,
		committedAt: firstBinding.boundAt,
		mimeType: sources[0].mimeType,
		size: body.size,
		sha256: firstBinding.sha256,
	});
	const loaded = await overlay.loadMediaAsset(sources[0].storageKey);
	assert.ok(loaded instanceof Blob);
	assert.equal(await loaded.text(), await body.text());
	assert.deepEqual(reads, [{ locatorId: LOCATOR_ID, expectedRevision: LOCATOR_REVISION }]);
	assert.equal(desktopSharedLinkedVideoGroupMatches(session, sources, metadata), true);
	assert.equal(desktopSharedLinkedVideoGroupMatches(
		session,
		[{ ...sources[0], width: 640 }, sources[1]],
		metadata,
	), false);
	assert.deepEqual(fallbackCalls, []);
	assert.equal(await overlay.getMediaAssetMetadata('unlinked-storage'), null);
	assert.deepEqual(fallbackCalls, ['metadata:unlinked-storage']);
});

test('an incomplete alias group cannot inherit trust from a matching storage key', async () => {
	const body = new Blob(['partially linked body'], { type: 'video/mp4' });
	let reads = 0;
	const { resolver } = resolverFixture({
		load() {
			reads += 1;
			return { blob: body, locatorRevision: LOCATOR_REVISION };
		},
	});
	const sources = [videoSource('video-a'), videoSource('video-b')];
	const project = videoProject(sources);
	await resolver.bind(PROJECT_ID, sources[0], LOCATOR_ID);
	reads = 0;

	const session = await resolveDesktopSharedProjectLinkedVideoOriginals(project, resolver);

	assert.equal(desktopSharedLinkedVideoTrustedSourceIds(session).size, 0);
	assert.equal(reads, 0);
	assert.equal(desktopSharedLinkedVideoGroupMatches(session, sources, null), false);
});

test('a sibling alias replacement during the shared body read invalidates the session', async () => {
	const body = new Blob(['raced shared alias body'], { type: 'video/mp4' });
	const state: { repository: LinkedVideoOriginalRepository | null } = { repository: null };
	const fixture = resolverFixture({
		async load(_locatorId, { expectedRevision }) {
			if (expectedRevision) {
				const repository = state.repository;
				assert.ok(repository);
				const current = await repository.get(PROJECT_ID, 'video-b');
				assert.ok(current);
				const { bindingToken: _bindingToken, boundAt: _boundAt, ...input } = current;
				assert.ok(await repository.putIfCurrent({
					...input,
					locatorId: 'locator_session_00000002',
					locatorRevision: 'snapshot_session_00000002',
				}, current.bindingToken));
			}
			return { blob: body, locatorRevision: expectedRevision ?? LOCATOR_REVISION };
		},
	});
	state.repository = fixture.repository;
	const sources = [videoSource('video-a'), videoSource('video-b')];
	for (const source of sources) await fixture.resolver.bind(PROJECT_ID, source, LOCATOR_ID);

	const session = await resolveDesktopSharedProjectLinkedVideoOriginals(
		videoProject(sources),
		fixture.resolver,
	);
	const overlay = overlayDesktopSharedLinkedVideoOriginals(session, {
		getMediaAssetMetadata: () => null,
		loadMediaAsset: () => null,
	});
	await assert.rejects(
		overlay.loadMediaAsset(sources[0].storageKey),
		/binding.*changed|changed.*binding/iu,
	);
});

test('linked-video session access rejects a structurally forged proof', () => {
	const forged = Object.freeze(Object.create(null)) as DesktopSharedLinkedVideoOriginalSession;
	assert.throws(
		() => desktopSharedLinkedVideoTrustedSourceIds(forged),
		/not authentic/iu,
	);
});

function resolverFixture(port: LinkedVideoOriginalPort) {
	let token = 0;
	const memory = getMemoryDatabase(`linked-video-session-${Date.now()}-${Math.random()}`);
	const repository = new LinkedVideoOriginalRepository({ memory, database: async () => null }, {
		now: () => new Date('2026-08-02T10:11:12.345Z'),
		createBindingToken: () => `binding_session_${String(++token).padStart(8, '0')}`,
	});
	return { repository, resolver: new LinkedVideoOriginalResolver(repository, port) };
}

function videoSource(id: string) {
	return createVideoSource({
		id,
		storageKey: 'physical/shared-linked-video',
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
	});
}

function videoProject(sources: readonly ReturnType<typeof videoSource>[]) {
	return createCurrentAudioEditorProject({
		id: PROJECT_ID,
		title: 'Linked alias project',
		revision: 2,
		now: '2026-08-02T10:11:12.345Z',
		sources,
		projectBin: {
			clips: sources.map((source, index) => createVideoClip({
				id: `clip-${String(index)}`,
				sourceId: source.id,
				durationFrames: source.sampleFrameCount,
				sourceDurationFrames: source.sampleFrameCount,
				binItemId: `bin-${String(index)}`,
			})),
		},
	});
}
