/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import type {
	LinkedVideoOriginalPort,
	LinkedVideoOriginalSource,
} from '../src/common/editor/storage/linked-video-original-resolver.ts';

const PROJECT_ID = 'linked-video-composition-project';
const LOCATOR_ID = 'locator_composition_000001';
const LOCATOR_REVISION = 'revision_composition_0001';

test('project storage composes pathless linked-video binding and resolution separately from media assets', async (context) => {
	const body = new Blob(['linked video composition'], { type: 'video/mp4' });
	const reads: Array<Readonly<{ locatorId: string; expectedRevision: string | null }>> = [];
	const releases: unknown[] = [];
	let playbackReleases = 0;
	let reconciliations = 0;
	const port: LinkedVideoOriginalPort = {
		load(locatorId, { expectedRevision }) {
			reads.push({ locatorId, expectedRevision });
			return Promise.resolve({ blob: body, locatorRevision: LOCATOR_REVISION });
		},
		leasePlayback: () => ({
			locatorRevision: LOCATOR_REVISION,
			mediaUrl: 'soundscaper-app://bundle/_desktop/read/linked-video-range-v1/composition/video.mp4',
			byteLength: body.size,
			mimeType: body.type,
			async readRange({ offset, length }) {
				return new Uint8Array(await body.slice(offset, offset + length).arrayBuffer());
			},
			async release() { playbackReleases += 1; },
		}),
		release(reference) {
			releases.push(reference);
			return true;
		},
		reconcile() { reconciliations += 1; return 0; },
	};
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `linked-video-composition-${Date.now()}-${Math.random()}`,
		linkedVideoOriginalPort: port,
	});
	context.after(async () => { await store.close(); });
	const source = videoSource();
	let projectLists = 0;
	store.projectRepository.list = async () => { projectLists += 1; return []; };
	assert.equal(await store.reconcileLinkedVideoOriginalLocators(), false);
	assert.equal(await store.reconcileLinkedOriginalLocators(), false);
	assert.equal(reconciliations, 0, 'ephemeral memory bindings never authorize main-process pruning');
	assert.equal(projectLists, 0, 'ephemeral memory never requests an authoritative project catalog');

	const binding = await store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID);
	assert.equal(binding.projectId, PROJECT_ID);
	assert.equal(binding.sourceId, source.id);
	assert.equal(binding.storageKey, source.storageKey);
	assert.equal(binding.locatorId, LOCATOR_ID);
	assert.equal(binding.locatorRevision, LOCATOR_REVISION);
	assert.equal(binding.byteLength, body.size);
	assert.deepEqual(reads, [{ locatorId: LOCATOR_ID, expectedRevision: null }]);

	assert.deepEqual(
		await store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id),
		binding,
	);
	assert.deepEqual(await store.getLinkedVideoOriginalMetadata(PROJECT_ID, source), {
		sourceId: source.storageKey,
		storage: 'linked-video-original-v1',
		path: null,
		committedAt: binding.boundAt,
		mimeType: source.mimeType,
		size: body.size,
		sha256: binding.sha256,
	});
	assert.equal(await store.getMediaAssetMetadata(source.storageKey), null);
	const poster = new Blob(['linked poster'], { type: 'image/webp' });
	await assert.rejects(
		store.saveVideoDerivative(source.storageKey, ({
			type: 'poster',
			blob: poster,
			original: {
				sha256: binding.sha256,
				mediaContentToken: `media-content-${'a'.repeat(64)}`,
			},
		}) as never),
		/verified original media/iu,
		'the renderer-facing retained API must not accept caller-supplied provenance',
	);
	const derivative = await store.saveLinkedVideoDerivative(PROJECT_ID, source, binding, {
		type: 'poster',
		timestamp: 0,
		blob: poster,
		metadata: { width: 320, height: 180, mimeType: poster.type },
	});
	assert.equal(derivative.originalSha256, binding.sha256);
	assert.deepEqual(await store.listVideoDerivatives(source.storageKey), []);
	assert.deepEqual(
		(await store.listLinkedVideoDerivatives(PROJECT_ID, source, binding))
			.map(({ type, timestamp }) => ({ type, timestamp })),
		[{ type: 'poster', timestamp: 0 }],
	);
	const loadedPoster = await store.loadLinkedVideoDerivative(PROJECT_ID, source, binding, {
		type: 'poster', timestamp: 0,
	});
	assert.ok(loadedPoster);
	assert.equal(new TextDecoder().decode(await loadedPoster.arrayBuffer()), 'linked poster');
	assert.equal(await store.getMediaAssetMetadata(source.storageKey), null);

	const resolved = await store.resolveLinkedVideoOriginal(PROJECT_ID, source);
	assert.ok(resolved);
	assert.equal(await resolved.blob.text(), await body.text());
	assert.deepEqual(reads.at(-1), {
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
	});
	assert.equal(await store.getMediaAssetMetadata(source.storageKey), null);
	const playback = await store.leaseLinkedVideoOriginalPlayback(PROJECT_ID, source);
	assert.ok(playback);
	assert.match(playback.mediaUrl, /linked-video-range-v1/u);
	await playback.release();
	assert.equal(playbackReleases, 1);

	assert.equal(await store.unlinkLinkedVideoOriginal(
		PROJECT_ID,
		source.id,
		'binding_stale_token_0001',
	), false);
	assert.equal(await store.unlinkLinkedVideoOriginal(
		PROJECT_ID,
		source.id,
		binding.bindingToken,
	), true);
	assert.equal(await store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id), null);
	await assert.rejects(
		store.listLinkedVideoDerivatives(PROJECT_ID, source, binding),
		/binding.*changed|changed.*binding/iu,
	);
	assert.equal(await store.releaseLinkedVideoOriginalLocator({
		locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
	}), true);
	assert.deepEqual(releases, [{ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION }]);
});

test('linked-video resolver injection is optional and facade operations fail before platform access when absent', async (context) => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `linked-video-composition-absent-${Date.now()}-${Math.random()}`,
	});
	context.after(async () => { await store.close(); });
	const source = videoSource();

	assert.equal(await store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id), null);
	await assert.rejects(
		store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID),
		/resolution is unavailable/iu,
	);
	await assert.rejects(
		store.resolveLinkedVideoOriginal(PROJECT_ID, source),
		/resolution is unavailable/iu,
	);
	assert.equal(await store.leaseLinkedVideoOriginalPlayback(PROJECT_ID, source), null);
	await assert.rejects(
		store.getLinkedVideoOriginalMetadata(PROJECT_ID, source),
		/resolution is unavailable/iu,
	);
	await assert.rejects(
		store.releaseLinkedVideoOriginalLocator({
			locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
		}),
		/resolution is unavailable/iu,
	);
	assert.equal(await store.reconcileLinkedVideoOriginalLocators(), false);
});

for (const mode of ['legacy-only', 'generic-reconcile-unavailable'] as const) {
	test(`generic startup hook falls back to legacy video reconciliation (${mode})`, async (context) => {
		const indexedDB = createInstrumentedIndexedDB();
		const databaseName = `linked-video-shared-catalog-${mode}-${Date.now()}-${Math.random()}`;
		const body = new Blob(['stale shadow linked video'], { type: 'video/mp4' });
		const submitted: unknown[] = [];
		let sharedCatalogReads = 0;
		const store = createProjectStore({
			indexedDB,
			memoryFallback: false,
			preferOpfs: false,
			databaseName,
			...(mode === 'generic-reconcile-unavailable' ? {
				linkedOriginalPort: {
					load() { throw new Error('generic reconciliation must not load media'); },
				},
			} : {}),
			desktopProjectBridge: {
				async listSharedProjects() { sharedCatalogReads += 1; return []; },
				async readSharedProject() { return null; },
				async commitSharedProject(document: string) { return document; },
				async deleteSharedProject() { return true; },
			},
			linkedVideoOriginalPort: {
				load: () => ({ blob: body, locatorRevision: LOCATOR_REVISION }),
				reconcile(references: readonly unknown[]) { submitted.push(references); return 1; },
			},
		});
		context.after(async () => { await store.close(); });
		await store.ready();
		indexedDB.seedRecord(databaseName, 'projects', { id: PROJECT_ID });
		const source = videoSource();
		assert.ok(await store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID));

		assert.equal(await store.reconcileLinkedOriginalLocators(), true);
		assert.equal(sharedCatalogReads, 1);
		assert.deepEqual(submitted, [[]]);
		assert.equal(await store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id), null);
	});
}

test('committed orphan cleanup retries locator reconciliation after a main rejection', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-video-reconcile-retry-${Date.now()}-${Math.random()}`;
	const body = new Blob(['retry linked video'], { type: 'video/mp4' });
	const failure = new Error('main locator reconciliation failed');
	const submitted: unknown[] = [];
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
		linkedVideoOriginalPort: {
			load: () => ({ blob: body, locatorRevision: LOCATOR_REVISION }),
			reconcile(references: readonly unknown[]) {
				submitted.push(references);
				if (submitted.length === 1) throw failure;
				return 1;
			},
		},
	});
	context.after(async () => { await store.close(); });
	await store.ready();
	const source = videoSource();
	assert.ok(await store.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID));

	await assert.rejects(
		store.reconcileLinkedVideoOriginalLocators(),
		(error) => error === failure,
	);
	assert.equal(await store.getLinkedVideoOriginalBinding(PROJECT_ID, source.id), null);
	assert.equal(await store.reconcileLinkedVideoOriginalLocators(), true);
	assert.deepEqual(submitted, [[], []]);
});

test('linked original bindings and disposable posters reopen through a fresh store composition', async (context) => {
	const body = new Blob(['persistent linked video'], { type: 'video/mp4' });
	const poster = new Blob(['persistent linked poster'], { type: 'image/webp' });
	const databaseName = `linked-video-composition-reopen-${Date.now()}-${Math.random()}`;
	const port: LinkedVideoOriginalPort = {
		load: async (_locatorId, { expectedRevision }) => ({
			blob: body,
			locatorRevision: expectedRevision ?? LOCATOR_REVISION,
		}),
	};
	const options = {
		indexedDB: null,
		preferOpfs: false,
		databaseName,
		linkedVideoOriginalPort: port,
	};
	const initialStore = createProjectStore(options);
	let reopenedStore: ReturnType<typeof createProjectStore> | null = null;
	context.after(async () => {
		await reopenedStore?.close();
		await initialStore.close();
	});
	const source = videoSource();
	const binding = await initialStore.bindLinkedVideoOriginal(PROJECT_ID, source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: body,
	});
	await initialStore.saveLinkedVideoDerivative(PROJECT_ID, source, binding, {
		type: 'poster', timestamp: 0, blob: poster,
		metadata: { width: 320, height: 180, mimeType: poster.type },
	});
	await initialStore.close();

	reopenedStore = createProjectStore(options);
	const resolved = await reopenedStore.resolveLinkedVideoOriginal(PROJECT_ID, source);
	assert.ok(resolved);
	assert.equal(await resolved.blob.text(), 'persistent linked video');
	const derivatives = await reopenedStore.listLinkedVideoDerivatives(
		PROJECT_ID, source, resolved.binding,
	);
	assert.deepEqual(derivatives.map(({ type, timestamp }) => ({ type, timestamp })), [
		{ type: 'poster', timestamp: 0 },
	]);
	const loaded = await reopenedStore.loadLinkedVideoDerivative(
		PROJECT_ID, source, resolved.binding, { type: 'poster', timestamp: 0 },
	);
	assert.ok(loaded);
	assert.equal(new TextDecoder().decode(await loaded.arrayBuffer()), 'persistent linked poster');
	assert.equal(await reopenedStore.getMediaAssetMetadata(source.storageKey), null);
});

function videoSource(): LinkedVideoOriginalSource {
	return Object.freeze({
		kind: 'video',
		id: 'linked-video-logical-source',
		storageKey: 'linked-video-physical-storage',
		mimeType: 'video/mp4',
		frameCount: 96_000,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 30,
		videoCodec: 'h264',
		audioCodec: null,
		hasAudio: false,
	});
}
