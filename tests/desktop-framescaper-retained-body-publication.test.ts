/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	createFramescaperDesktopProjectLibraryHandshake,
	createFramescaperDesktopProjectLibraryPaths,
} from '../desktop/framescaper-project-library-contract.ts';
import { FramescaperDesktopProjectLibraryMain } from
	'../desktop/framescaper-project-library-main.ts';
import { framescaperDesktopExactMediaPath } from
	'../desktop/project-library-exact-generation-storage.ts';
import { createVideoClip, createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { connectFramescaperDesktopProjectLibraryRenderer } from
	'../src/framescaper/desktop-project-library-renderer.ts';
import { createFramescaperDesktopProjectStoreAdapter } from
	'../src/framescaper/desktop-project-library-store-adapter.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperProject, type FramescaperProject } from '../src/framescaper/editor-project.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PUBLICATION_ID = 'ab'.repeat(24);

test('main admits an unchanged verified body without receiving its bytes again', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-retained-body-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const handshake = createFramescaperDesktopProjectLibraryHandshake();
	const main = await FramescaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'framescaper', processId: 973, instanceId: 'retained-body' },
		handshake, onLeaseLost: () => undefined, testControl: null,
	});
	context.after(() => main.close());
	const session = main.openSession(handshake);
	context.after(() => session.close());

	const bytes = new TextEncoder().encode('retained desktop video body');
	const bodySha256 = createHash('sha256').update(bytes).digest('hex');
	const storageKey = `media-sha256:${bodySha256}`;
	const source = createVideoSource({
		id: 'video-source', name: 'video.mp4', storageKey, mimeType: 'video/mp4',
		contentSha256: bodySha256, sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30, den: 1 }, width: 640, height: 360, videoCodec: 'h264',
	});
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'retained-body-project', title: 'Retained body',
		now: '2026-08-31T10:00:00.000Z', sources: [source],
	});
	const body = Object.freeze({
		kind: 'video-original', encoding: 'framescaper-video-original-v1',
		sourceId: storageKey, storageKey, mimeType: 'video/mp4',
		byteLength: bytes.byteLength, sha256: bodySha256,
	});
	const paths = createFramescaperDesktopProjectLibraryPaths(root);
	const path = framescaperDesktopExactMediaPath(paths, body);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, bytes);

	const admission = await session.beginPublication({
		publicationId: PUBLICATION_ID,
		expectedMetadataRevision: 0,
		expectedProject: null,
		project,
		bodies: [body],
	});
	assert.deepEqual(admission, {
		publicationId: PUBLICATION_ID,
		maximumChunkBytes: 4 * 1024 * 1024,
		bodyCount: 1,
		requiredBodyIndexes: [],
	});
	const result = await session.finishPublication({ publicationId: PUBLICATION_ID }) as {
		readonly bodies: readonly unknown[];
	};
	assert.deepEqual(result.bodies, [body]);
});

test('renderer neither reloads nor uploads a body retained by main', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-retained-renderer-body-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const handshake = createFramescaperDesktopProjectLibraryHandshake();
	const main = await FramescaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'framescaper', processId: 974, instanceId: 'retained-renderer-body' },
		handshake, onLeaseLost: () => undefined, testControl: null,
	});
	context.after(() => main.close());
	const session = main.openSession(handshake);
	context.after(() => session.close());
	const store = createFramescaperProjectStore(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		indexedDB: createInstrumentedIndexedDB(), preferOpfs: false,
		storageManager: persistentStorage(),
	});
	await store.ready();
	context.after(() => store.close());
	let loadCount = 0;
	const loadMediaAsset = store.loadMediaAsset.bind(store);
	Object.defineProperty(store, 'loadMediaAsset', {
		configurable: true, enumerable: true,
		value: (...args: Parameters<typeof store.loadMediaAsset>) => {
			loadCount += 1;
			return loadMediaAsset(...args);
		},
	});

	const bytes = new TextEncoder().encode('renderer retained desktop body');
	const bodySha256 = createHash('sha256').update(bytes).digest('hex');
	const storageKey = `media-sha256:${bodySha256}`;
	const writer = await store.beginMediaAssetWrite(storageKey, { mimeType: 'video/mp4' }, {
		expectedBytes: bytes.byteLength, expectedSha256: bodySha256,
	});
	await writer.write(bytes);
	await writer.commitOwned();
	const source = createVideoSource({
		id: 'video-source', name: 'video.mp4', storageKey, mimeType: 'video/mp4',
		contentSha256: bodySha256, sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30, den: 1 }, width: 640, height: 360, videoCodec: 'h264',
	});
	const binClip = createVideoClip({
		id: 'bin-video', sourceId: source.id, title: 'video.mp4',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 30,
		sourceInFrame: 0, sourceFrameCount: 30,
	}, {
		projectSampleRate: 48_000,
		sequence: { id: 'main-sequence', rate: { num: 30, den: 1 } },
		source,
	});
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'retained-renderer-project', title: 'Initial',
		now: '2026-08-31T10:00:00.000Z', sources: [source], projectBin: { clips: [binClip] },
	});
	let uploadCount = 0;
	const bridge = Object.freeze({
		connect: async () => handshake,
		handshakeState: () => 'admitted',
		listProjects: () => session.listProjects(),
		readProjectBundle: (projectId: string) => session.readProjectBundle(projectId),
		readBodyChunk: (request: unknown) => session.readBodyChunk(request),
		beginPublication: (request: unknown) => session.beginPublication(request),
		writePublicationChunk: (request: unknown) => {
			uploadCount += 1;
			return session.writePublicationChunk(request);
		},
		finishPublication: (request: unknown) => session.finishPublication(request),
		abortPublication: (request: unknown) => session.abortPublication(request),
		deleteProject: (request: unknown) => session.deleteProject(request),
		duplicateProject: (request: unknown) => session.duplicateProject(request),
	});
	const priorDesktop = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	Object.defineProperty(globalThis, 'framescaperDesktop', {
		configurable: true, enumerable: true,
		value: Object.freeze({ v1: Object.freeze({ projectLibrary: bridge }) }),
	});
	context.after(() => {
		if (priorDesktop) Object.defineProperty(globalThis, 'framescaperDesktop', priorDesktop);
		else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
	});
	const renderer = await connectFramescaperDesktopProjectLibraryRenderer(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE, store,
	);
	assert.ok(renderer);
	const adapter = createFramescaperDesktopProjectStoreAdapter(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		{ localStore: store, desktopProjectLibrary: renderer },
	);
	assert.deepEqual(await adapter.createProjectIfAbsent(project), project);
	assert.ok(uploadCount > 0, 'the initial publication transferred the new body');
	assert.ok(loadCount > 0, 'the initial publication verified the body renderer had to transfer');

	uploadCount = 0;
	loadCount = 0;
	const advanced = Object.freeze({
		...project, revision: 1, title: 'Metadata only', updatedAt: '2026-08-31T10:01:00.000Z',
	}) as FramescaperProject;
	assert.deepEqual(await adapter.saveProjectIfCurrent(project, advanced), advanced);
	assert.equal(uploadCount, 0, 'main retained the body, so renderer sent no chunks');
	assert.equal(loadCount, 0, 'main retained the body, so renderer did not rehash its local blob');
});

function persistentStorage(): StorageManager {
	return {
		estimate: async () => ({ usage: 0, quota: 1024 * 1024 * 1024 }),
		persisted: async () => true,
		persist: async () => true,
	} as unknown as StorageManager;
}
