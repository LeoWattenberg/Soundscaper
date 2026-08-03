/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	normalizeLinkedOriginalProvisionalRoot,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
} from '../src/common/editor/storage/linked-original-provisional-root.ts';
import type {
	LinkedAudioOriginalSource,
	LinkedOriginalPort,
} from '../src/common/editor/storage/linked-original-resolver.ts';
import { linkedOriginalBindingKey } from '../src/common/editor/storage/linked-original-schema.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROJECT_ID = 'linked-audio-relink-project';
const SOURCE_ID = 'linked-audio-relink-source';
const STORAGE_KEY = 'linked-audio-relink-storage';
const OLD_LOCATOR_ID = 'locator_audio_relink_original_01';
const OLD_LOCATOR_REVISION = 'revision_audio_relink_original_01';
const NEW_LOCATOR_ID = 'locator_audio_relink_selected_01';
const NEW_LOCATOR_REVISION = 'revision_audio_relink_selected_01';
const CONCURRENT_LOCATOR_ID = 'locator_audio_relink_concurrent_1';
const CONCURRENT_LOCATOR_REVISION = 'revision_audio_relink_concurrent_1';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`exact-content linked-PCM relink publishes one guarded binding/root pair in ${backend}`, async (context) => {
		const body = new Blob(['same linked PCM bytes'], { type: 'audio/wav' });
		const fixture = await relinkFixture(context, backend, body);
		fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(body, NEW_LOCATOR_REVISION));
		let admissions = 0;

		const rebound = await fixture.store.relinkLinkedAudioOriginal(
			PROJECT_ID,
			audioSource(),
			NEW_LOCATOR_ID,
			{
				expectedBindingToken: fixture.original.bindingToken,
				expectedLocatorRevision: NEW_LOCATOR_REVISION,
				expectedSnapshot: body,
				assertCanPublish: () => {
					admissions += 1;
					assert.equal(fixture.currentRoot().bindingToken, fixture.original.bindingToken);
				},
			},
		);

		assert.equal(admissions, 1);
		assert.equal(rebound.kind, 'audio');
		assert.equal(rebound.locatorId, NEW_LOCATOR_ID);
		assert.equal(rebound.locatorRevision, NEW_LOCATOR_REVISION);
		assert.equal(rebound.byteLength, fixture.original.byteLength);
		assert.equal(rebound.sha256, fixture.original.sha256);
		assert.notEqual(rebound.bindingToken, fixture.original.bindingToken);
		assert.deepEqual(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, SOURCE_ID), rebound);
		assert.equal(fixture.currentRoot().bindingToken, rebound.bindingToken);
		assert.deepEqual(fixture.loads.at(-1), {
			kind: 'audio',
			locatorId: NEW_LOCATOR_ID,
			expectedRevision: NEW_LOCATOR_REVISION,
		});
		assert.equal(await fixture.store.releaseLinkedOriginalLocator({
			kind: 'audio',
			locatorId: NEW_LOCATOR_ID,
			locatorRevision: NEW_LOCATOR_REVISION,
		}), false);
		assert.deepEqual(fixture.releases, []);
	});

	test(`linked-PCM relink publication admission aborts the binding/root CAS in ${backend}`, async (context) => {
		const body = new Blob(['guarded linked PCM bytes'], { type: 'audio/wav' });
		const fixture = await relinkFixture(context, backend, body);
		fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(body, NEW_LOCATOR_REVISION));
		const refusal = new Error('Project editing is blocked.');

		await assert.rejects(
			fixture.store.relinkLinkedAudioOriginal(PROJECT_ID, audioSource(), NEW_LOCATOR_ID, {
				expectedBindingToken: fixture.original.bindingToken,
				expectedLocatorRevision: NEW_LOCATOR_REVISION,
				expectedSnapshot: body,
				assertCanPublish: () => {
					assert.equal(fixture.currentRoot().bindingToken, fixture.original.bindingToken);
					throw refusal;
				},
			}),
			(error) => error === refusal,
		);

		assert.deepEqual(
			await fixture.store.getLinkedOriginalBinding(PROJECT_ID, SOURCE_ID),
			fixture.original,
		);
		assert.equal(fixture.currentRoot().bindingToken, fixture.original.bindingToken);
		assert.deepEqual(fixture.releases, []);
	});
}

test('linked-PCM relink rejects changed candidate bytes and leaves candidate cleanup to alias-aware release', async (context) => {
	const originalBody = new Blob(['same-size-original'], { type: 'audio/wav' });
	const changedBody = new Blob(['same-size-replaced'], { type: 'audio/wav' });
	assert.equal(changedBody.size, originalBody.size);
	const fixture = await relinkFixture(context, 'memory', originalBody);
	fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(changedBody, NEW_LOCATOR_REVISION));
	const loadCount = fixture.loads.length;

	await assert.rejects(
		fixture.store.relinkLinkedAudioOriginal(PROJECT_ID, audioSource(), NEW_LOCATOR_ID, {
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: changedBody,
		}),
		/content|SHA-256/iu,
	);

	assert.equal(fixture.loads.length, loadCount);
	assert.deepEqual(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, SOURCE_ID), fixture.original);
	assert.equal(await fixture.store.releaseLinkedOriginalLocator({
		kind: 'audio',
		locatorId: NEW_LOCATOR_ID,
		locatorRevision: NEW_LOCATOR_REVISION,
	}), true);
	assert.deepEqual(fixture.releases, [{
		kind: 'audio',
		locatorId: NEW_LOCATOR_ID,
		locatorRevision: NEW_LOCATOR_REVISION,
	}]);
});

test('linked-PCM relink rejects a stale binding token before candidate platform access', async (context) => {
	const body = new Blob(['stale-token linked PCM'], { type: 'audio/wav' });
	const fixture = await relinkFixture(context, 'memory', body);
	fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(body, NEW_LOCATOR_REVISION));
	const loadCount = fixture.loads.length;

	await assert.rejects(
		fixture.store.relinkLinkedAudioOriginal(PROJECT_ID, audioSource(), NEW_LOCATOR_ID, {
			expectedBindingToken: 'binding_stale_audio_relink_01',
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: body,
		}),
		/binding.*changed|changed.*binding/iu,
	);

	assert.equal(fixture.loads.length, loadCount);
	assert.deepEqual(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, SOURCE_ID), fixture.original);
	assert.equal(fixture.currentRoot().bindingToken, fixture.original.bindingToken);
	assert.deepEqual(fixture.releases, []);
});

test('a concurrent linked-PCM binding replacement wins the relink CAS', async (context) => {
	const body = new Blob(['concurrent linked PCM'], { type: 'audio/wav' });
	const fixture = await relinkFixture(context, 'memory', body);
	const candidateLoad = deferred<void>();
	const allowCandidate = deferred<void>();
	fixture.loadOverride = async (_kind, locatorId) => {
		if (locatorId !== NEW_LOCATOR_ID) return null;
		candidateLoad.resolve(undefined);
		await allowCandidate.promise;
		return snapshot(body, NEW_LOCATOR_REVISION);
	};
	const relink = fixture.store.relinkLinkedAudioOriginal(
		PROJECT_ID,
		audioSource(),
		NEW_LOCATOR_ID,
		{
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: body,
		},
	);
	await candidateLoad.promise;
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...originalInput } = fixture.original;
	const concurrent = await fixture.store.linkedOriginalBindingRepository.putIfCurrent({
		...originalInput,
		locatorId: CONCURRENT_LOCATOR_ID,
		locatorRevision: CONCURRENT_LOCATOR_REVISION,
	}, fixture.original.bindingToken);
	assert.ok(concurrent);
	allowCandidate.resolve(undefined);

	await assert.rejects(relink, /binding.*changed|changed.*binding/iu);
	assert.deepEqual(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, SOURCE_ID), concurrent);
	assert.equal(fixture.currentRoot().bindingToken, concurrent.bindingToken);
	assert.deepEqual(fixture.releases, []);
});

test('cancelling linked-PCM relink before CAS preserves the old binding/root pair', async (context) => {
	const body = new Blob(['cancelled linked PCM'], { type: 'audio/wav' });
	const fixture = await relinkFixture(context, 'memory', body);
	const candidateLoad = deferred<void>();
	const allowCandidate = deferred<void>();
	fixture.loadOverride = async (_kind, locatorId) => {
		if (locatorId !== NEW_LOCATOR_ID) return null;
		candidateLoad.resolve(undefined);
		await allowCandidate.promise;
		return snapshot(body, NEW_LOCATOR_REVISION);
	};
	const controller = new AbortController();
	const cancellation = new Error('cancel exact-content linked PCM relink');
	const relink = fixture.store.relinkLinkedAudioOriginal(
		PROJECT_ID,
		audioSource(),
		NEW_LOCATOR_ID,
		{
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: body,
			signal: controller.signal,
		},
	);
	await candidateLoad.promise;
	controller.abort(cancellation);
	allowCandidate.resolve(undefined);

	await assert.rejects(relink, (error) => error === cancellation);
	assert.deepEqual(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, SOURCE_ID), fixture.original);
	assert.equal(fixture.currentRoot().bindingToken, fixture.original.bindingToken);
	assert.deepEqual(fixture.releases, []);
});

async function relinkFixture(
	context: TestContext,
	backend: 'memory' | 'indexeddb',
	originalBody: Blob,
) {
	const databaseName = `linked-audio-relink-${backend}-${Date.now()}-${Math.random()}`;
	const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
	const snapshots = new Map<string, Readonly<{ blob: Blob; locatorRevision: string }>>([
		[OLD_LOCATOR_ID, snapshot(originalBody, OLD_LOCATOR_REVISION)],
	]);
	const loads: Array<Readonly<{
		kind: 'audio' | 'video';
		locatorId: string;
		expectedRevision: string | null;
	}>> = [];
	const releases: unknown[] = [];
	const fixture: {
		loadOverride: ((
			kind: 'audio' | 'video',
			locatorId: string,
			expectedRevision: string | null,
		) => Promise<Readonly<{ blob: Blob; locatorRevision: string }> | null>) | null;
	} = { loadOverride: null };
	const port: LinkedOriginalPort = {
		async load(kind, locatorId, { expectedRevision }) {
			loads.push({ kind, locatorId, expectedRevision });
			if (fixture.loadOverride) return fixture.loadOverride(kind, locatorId, expectedRevision);
			const selected = snapshots.get(locatorId) ?? null;
			return expectedRevision !== null && selected?.locatorRevision !== expectedRevision
				? null
				: selected;
		},
		release(reference) { releases.push(reference); return true; },
	};
	const store = createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory | null,
		preferOpfs: false,
		databaseName,
		linkedOriginalPort: port,
	});
	await store.ready();
	context.after(async () => { await store.close(); });
	const original = await store.bindLinkedAudioOriginal(
		PROJECT_ID,
		audioSource(),
		OLD_LOCATOR_ID,
		{
			expectedLocatorRevision: OLD_LOCATOR_REVISION,
			expectedSnapshot: originalBody,
		},
	);
	const key = linkedOriginalBindingKey(PROJECT_ID, SOURCE_ID);
	return {
		loads,
		original,
		releases,
		snapshots,
		store,
		currentRoot: () => normalizeLinkedOriginalProvisionalRoot(indexedDB
			? indexedDB.records(databaseName, LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME)
				.find((record) => record.key === key)
			: getMemoryDatabase(databaseName).linkedOriginalProvisionalRoots.get(key)),
		get loadOverride() { return fixture.loadOverride; },
		set loadOverride(value) { fixture.loadOverride = value; },
	};
}

function snapshot(blob: Blob, locatorRevision: string) {
	return Object.freeze({ blob, locatorRevision });
}

function audioSource(): LinkedAudioOriginalSource {
	return Object.freeze({
		kind: 'audio',
		id: SOURCE_ID,
		storageKey: STORAGE_KEY,
		mimeType: 'audio/wav',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 2,
	});
}

function deferred<Value>() {
	let resolvePromise!: (value: Value | PromiseLike<Value>) => void;
	let rejectPromise!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, resolve: resolvePromise, reject: rejectPromise };
}
