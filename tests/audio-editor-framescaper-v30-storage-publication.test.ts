/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	ProjectDocument,
	ProjectRepositoryPort,
} from '../src/common/editor/storage/project-repository.ts';
import { applyFramescaperProjectCommandV30 } from '../src/framescaper/editor-project-v30-commands.ts';
import { FramescaperProjectRepositoryV30 } from '../src/framescaper/editor-project-repository-v30.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import {
	createFramescaperProjectStoreV30,
	framescaperProjectStoreAuthorityV30,
} from '../src/framescaper/editor-project-store-v30.ts';
import { createFramescaperProjectV30 } from '../src/framescaper/editor-project-v30.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import {
	addFramescaperV30BoundaryImage,
	framescaperV30BoundaryImage,
} from './helpers/framescaper-v30-boundary-fixture.ts';

const PROFILE = FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE;

test('generic V30 repository saves preserve but never introduce or replace image-body authority', async () => {
	const base = createFramescaperProjectV30(PROFILE, framescaperV20Options());
	const image = addFramescaperV30BoundaryImage(base).project;
	const delegate = memoryDelegate(base as unknown as ProjectDocument);
	const repository = new FramescaperProjectRepositoryV30(PROFILE, delegate.port);

	await assert.rejects(
		repository.saveIfCurrent(base as unknown as ProjectDocument, image as unknown as ProjectDocument),
		/atomic.*timeline.image|timeline.image.*publication/iu,
	);
	delegate.set(image as unknown as ProjectDocument);
	const renamed = structuredClone(image) as unknown as Record<string, unknown>;
	renamed.title = 'Renamed without body replacement';
	renamed.revision = Number(image.revision) + 1;
	renamed.updatedAt = '2026-08-25T12:01:00.000Z';
	assert.equal((await repository.saveIfCurrent(
		image as unknown as ProjectDocument,
		renamed as ProjectDocument,
	))?.title, renamed.title);

	const changed = structuredClone(renamed) as unknown as Record<string, unknown>;
	const source = records(changed.sources).find(({ kind }) => kind === 'image')!;
	source.contentSha256 = 'ff'.repeat(32);
	await assert.rejects(
		repository.saveIfCurrent(renamed as ProjectDocument, changed as ProjectDocument),
		/immutable.*image|image.*authority/iu,
	);
});

test('authenticated store authority publishes one verified image body and exact project revision together', async () => {
	const projectId = uniqueId('publish');
	const store = createFramescaperProjectStoreV30(PROFILE);
	await store.ready();
	const base = createFramescaperProjectV30(PROFILE, {
		...framescaperV20Options(), id: projectId,
	});
	assert.ok(await store.createProjectIfAbsent(base));
	const fixture = addFramescaperV30BoundaryImage(base, projectId);
	const authority = framescaperProjectStoreAuthorityV30(PROFILE, store);
	const published = await authority.timelineImages.publishIfCurrent({
		expected: base,
		project: fixture.project,
		bytes: fixture.bytes,
	});
	assert.deepEqual(published, fixture.project);
	assert.deepEqual(await store.loadProject(projectId), fixture.project);
	const metadata = await store.getMediaAssetMetadata(fixture.source.storageKey);
	assert.equal(metadata?.sha256, fixture.source.contentSha256);
	assert.equal(metadata?.size, fixture.source.assetByteLength);
	assert.equal(Object.hasOwn(metadata ?? {}, 'pendingProjectUntil'), false);
	assert.deepEqual(
		new Uint8Array(await (await store.loadMediaAsset(fixture.source.storageKey))!.arrayBuffer()),
		fixture.bytes,
	);
});

test('first image publication may atomically create its one fresh Images track', async () => {
	const projectId = uniqueId('fresh-track');
	const store = createFramescaperProjectStoreV30(PROFILE);
	await store.ready();
	const base = createFramescaperProjectV30(PROFILE, {
		...framescaperV20Options(), id: projectId,
	});
	assert.ok(await store.createProjectIfAbsent(base));
	const fixture = framescaperV30BoundaryImage(base, projectId);
	const trackId = `${projectId}-images`;
	const track = {
		type: 'video', id: trackId, name: 'Images', laneGroupId: null, clipIds: [],
		mute: false, solo: false, hidden: false, collapsed: false, height: 120,
		opaqueExtensions: {},
	};
	const project = applyFramescaperProjectCommandV30(PROFILE, base, {
		type: 'batch',
		commands: [{ type: 'track/add', track, index: base.tracks.length }, {
			type: 'image-source/set', sourceId: fixture.source.id,
			expectedSource: null, source: fixture.source,
		}, {
			type: 'image-clip/set', clipId: fixture.clip.id,
			expectedClip: null, expectedPlacement: null, clip: fixture.clip,
			placement: { scope: 'timeline', trackId },
		}],
	}, { now: '2026-08-25T12:00:00.000Z' });
	const published = await framescaperProjectStoreAuthorityV30(PROFILE, store)
		.timelineImages.publishIfCurrent({ expected: base, project, bytes: fixture.bytes });
	assert.deepEqual(published, project);
	assert.deepEqual(published?.tracks.find(({ id }) => id === trackId)?.clipIds, [fixture.clip.id]);
	assert.equal((await store.getMediaAssetMetadata(fixture.source.id))?.pendingProjectUntil, undefined);
});

test('stale image publication removes its owned staged body and leaves the current project untouched', async () => {
	const projectId = uniqueId('stale');
	const store = createFramescaperProjectStoreV30(PROFILE);
	await store.ready();
	const base = createFramescaperProjectV30(PROFILE, {
		...framescaperV20Options(), id: projectId,
	});
	assert.ok(await store.createProjectIfAbsent(base));
	const current = structuredClone(base) as unknown as Record<string, unknown>;
	current.title = 'Concurrent edit';
	current.revision = Number(base.revision) + 1;
	current.updatedAt = '2026-08-25T12:01:00.000Z';
	await store.saveProject(current);
	const fixture = addFramescaperV30BoundaryImage(base, `${projectId}-stale`);
	const result = await framescaperProjectStoreAuthorityV30(PROFILE, store)
		.timelineImages.publishIfCurrent({ expected: base, project: fixture.project, bytes: fixture.bytes });
	assert.equal(result, null);
	assert.equal(await store.getMediaAssetMetadata(fixture.source.storageKey), null);
	assert.deepEqual(await store.loadProject(projectId), current);
});

test('invalid or tampered image publication fails before leaving a body or project reference', async () => {
	const projectId = uniqueId('invalid');
	const store = createFramescaperProjectStoreV30(PROFILE);
	await store.ready();
	const base = createFramescaperProjectV30(PROFILE, {
		...framescaperV20Options(), id: projectId,
	});
	assert.ok(await store.createProjectIfAbsent(base));
	const fixture = addFramescaperV30BoundaryImage(base, projectId);
	const tampered = fixture.bytes.slice();
	tampered[0] ^= 0xff;
	await assert.rejects(
		framescaperProjectStoreAuthorityV30(PROFILE, store).timelineImages.publishIfCurrent({
			expected: base, project: fixture.project, bytes: tampered,
		}),
		/digest|frame.pack/iu,
	);
	assert.equal(await store.getMediaAssetMetadata(fixture.source.storageKey), null);
	assert.deepEqual(await store.loadProject(projectId), base);

	const detached = framescaperV30BoundaryImage(base, `${projectId}-detached`);
	await assert.rejects(
		framescaperProjectStoreAuthorityV30(PROFILE, store).timelineImages.publishIfCurrent({
			expected: base, project: fixture.project, bytes: detached.bytes,
		}),
		/digest|source|body|asset length/iu,
	);
	assert.equal(await store.getMediaAssetMetadata(detached.source.storageKey), null);
});

interface MemoryDelegate {
	readonly port: ProjectRepositoryPort;
	set(project: ProjectDocument): void;
}

function memoryDelegate(initial: ProjectDocument): MemoryDelegate {
	let current = structuredClone(initial);
	const port: ProjectRepositoryPort = {
		async createIfAbsent(project) { current = structuredClone(project); return structuredClone(project); },
		async createForScapeImportIfAbsent(project) { current = structuredClone(project); return structuredClone(project); },
		async save(project) { current = structuredClone(project); return structuredClone(project); },
		async saveIfCurrent(expected, project) {
			if (JSON.stringify(current) !== JSON.stringify(expected)) return null;
			current = structuredClone(project);
			return structuredClone(project);
		},
		async load() { return structuredClone(current); },
		async list() { return [structuredClone(current)]; },
		async listRevisions() { return []; },
		async delete() { /* no-op test delegate */ },
	};
	return { port, set(project) { current = structuredClone(project); } };
}

function records(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError('Expected an array.');
	return value as Record<string, unknown>[];
}

function uniqueId(prefix: string): string {
	return `v30-image-${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
