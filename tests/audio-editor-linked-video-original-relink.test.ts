/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { normalizeLinkedOriginalProvisionalRoot } from '../src/common/editor/storage/linked-original-provisional-root.ts';
import { linkedOriginalBindingKey } from '../src/common/editor/storage/linked-original-schema.ts';
import type {
	LinkedVideoOriginalPort,
	LinkedVideoOriginalSource,
} from '../src/common/editor/storage/linked-video-original-resolver.ts';

const PROJECT_ID = 'linked-video-relink-project';
const SOURCE_ID = 'linked-video-relink-source';
const STORAGE_KEY = 'linked-video-relink-storage';
const OLD_LOCATOR_ID = 'locator_relink_original_0001';
const OLD_LOCATOR_REVISION = 'revision_relink_original_01';
const NEW_LOCATOR_ID = 'locator_relink_selected_0001';
const NEW_LOCATOR_REVISION = 'revision_relink_selected_01';
const CONCURRENT_LOCATOR_ID = 'locator_relink_concurrent_01';
const CONCURRENT_LOCATOR_REVISION = 'revision_relink_concurrent1';

test('exact-content retained-video relink CAS-publishes the selected locator without releasing the old locator', async (context) => {
	const body = new Blob(['same retained video bytes'], { type: 'video/mp4' });
	const fixture = await relinkFixture(context, body);
	fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(body, NEW_LOCATOR_REVISION));

	const rebound = await fixture.store.relinkLinkedVideoOriginal(
		PROJECT_ID,
		videoSource(),
		NEW_LOCATOR_ID,
		{
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: body,
		},
	);

	assert.equal(rebound.locatorId, NEW_LOCATOR_ID);
	assert.equal(rebound.locatorRevision, NEW_LOCATOR_REVISION);
	assert.equal(rebound.byteLength, fixture.original.byteLength);
	assert.equal(rebound.sha256, fixture.original.sha256);
	assert.notEqual(rebound.bindingToken, fixture.original.bindingToken);
	assert.deepEqual(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, SOURCE_ID), rebound);
	assert.deepEqual(fixture.loads.at(-1), {
		locatorId: NEW_LOCATOR_ID,
		expectedRevision: NEW_LOCATOR_REVISION,
	});
	assert.deepEqual(fixture.releases, []);
	assert.equal(currentRoot(fixture.databaseName).bindingToken, rebound.bindingToken);
});

test('retained-video relink rejects changed candidate bytes and preserves the old binding', async (context) => {
	const originalBody = new Blob(['same-size-original'], { type: 'video/mp4' });
	const changedBody = new Blob(['same-size-replaced'], { type: 'video/mp4' });
	assert.equal(changedBody.size, originalBody.size);
	const fixture = await relinkFixture(context, originalBody);
	fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(changedBody, NEW_LOCATOR_REVISION));

	await assert.rejects(
		fixture.store.relinkLinkedVideoOriginal(PROJECT_ID, videoSource(), NEW_LOCATOR_ID, {
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: changedBody,
		}),
		/content|SHA-256/iu,
	);

	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, SOURCE_ID),
		fixture.original,
	);
	assert.equal(currentRoot(fixture.databaseName).bindingToken, fixture.original.bindingToken);
	assert.deepEqual(fixture.releases, []);
});

test('retained-video relink rejects a stale old-binding token before platform access', async (context) => {
	const body = new Blob(['stale token retained video'], { type: 'video/mp4' });
	const fixture = await relinkFixture(context, body);
	fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(body, NEW_LOCATOR_REVISION));
	const loadCount = fixture.loads.length;

	await assert.rejects(
		fixture.store.relinkLinkedVideoOriginal(PROJECT_ID, videoSource(), NEW_LOCATOR_ID, {
			expectedBindingToken: 'binding_stale_relink_token_01',
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: body,
		}),
		/binding.*changed|changed.*binding/iu,
	);

	assert.equal(fixture.loads.length, loadCount);
	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, SOURCE_ID),
		fixture.original,
	);
	assert.equal(currentRoot(fixture.databaseName).bindingToken, fixture.original.bindingToken);
	assert.deepEqual(fixture.releases, []);
});

test('a concurrent retained-video binding replacement wins the relink CAS', async (context) => {
	const body = new Blob(['concurrent retained video'], { type: 'video/mp4' });
	const fixture = await relinkFixture(context, body);
	const candidateLoad = deferred<void>();
	const allowCandidate = deferred<void>();
	fixture.loadOverride = async (locatorId) => {
		if (locatorId !== NEW_LOCATOR_ID) return null;
		candidateLoad.resolve(undefined);
		await allowCandidate.promise;
		return snapshot(body, NEW_LOCATOR_REVISION);
	};
	const relink = fixture.store.relinkLinkedVideoOriginal(
		PROJECT_ID,
		videoSource(),
		NEW_LOCATOR_ID,
		{
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: body,
		},
	);
	await candidateLoad.promise;
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...originalInput } = fixture.original;
	const concurrent = await fixture.store.linkedVideoOriginalBindingRepository.putIfCurrent({
		...originalInput,
		locatorId: CONCURRENT_LOCATOR_ID,
		locatorRevision: CONCURRENT_LOCATOR_REVISION,
	}, fixture.original.bindingToken);
	assert.ok(concurrent);
	allowCandidate.resolve(undefined);

	await assert.rejects(relink, /binding.*changed|changed.*binding/iu);
	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, SOURCE_ID),
		concurrent,
	);
	assert.equal(currentRoot(fixture.databaseName).bindingToken, concurrent.bindingToken);
	assert.deepEqual(fixture.releases, []);
});

test('retained-video relink rechecks writable admission at the binding CAS', async (context) => {
	const body = new Blob(['writable retained video'], { type: 'video/mp4' });
	const fixture = await relinkFixture(context, body);
	const candidateLoad = deferred<void>();
	const allowCandidate = deferred<void>();
	fixture.loadOverride = async (locatorId) => {
		if (locatorId !== NEW_LOCATOR_ID) return null;
		candidateLoad.resolve(undefined);
		await allowCandidate.promise;
		return snapshot(body, NEW_LOCATOR_REVISION);
	};
	let writable = true;
	const relink = fixture.store.relinkLinkedVideoOriginal(
		PROJECT_ID,
		videoSource(),
		NEW_LOCATOR_ID,
		{
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: body,
			assertCanPublish: () => {
				if (!writable) throw new Error('Project editing is blocked.');
			},
		},
	);
	await candidateLoad.promise;
	writable = false;
	allowCandidate.resolve(undefined);

	await assert.rejects(relink, /editing is blocked/iu);
	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, SOURCE_ID),
		fixture.original,
	);
	assert.equal(currentRoot(fixture.databaseName).bindingToken, fixture.original.bindingToken);
	assert.deepEqual(fixture.releases, []);
});

test('cancelling retained-video relink before CAS preserves the old binding', async (context) => {
	const body = new Blob(['cancelled retained video'], { type: 'video/mp4' });
	const fixture = await relinkFixture(context, body);
	const candidateLoad = deferred<void>();
	const allowCandidate = deferred<void>();
	fixture.loadOverride = async (locatorId) => {
		if (locatorId !== NEW_LOCATOR_ID) return null;
		candidateLoad.resolve(undefined);
		await allowCandidate.promise;
		return snapshot(body, NEW_LOCATOR_REVISION);
	};
	const controller = new AbortController();
	const cancellation = new Error('cancel exact-content relink');
	const relink = fixture.store.relinkLinkedVideoOriginal(
		PROJECT_ID,
		videoSource(),
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
	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, SOURCE_ID),
		fixture.original,
	);
	assert.equal(currentRoot(fixture.databaseName).bindingToken, fixture.original.bindingToken);
	assert.deepEqual(fixture.releases, []);
});

test('changed-content relink admits a silent video with different bytes and publishes the measured digest', async (context) => {
	const originalBody = new Blob(['old silent retained bytes'], { type: 'video/mp4' });
	const changedBody = new Blob(['brand new silent retained replacement'], { type: 'video/mp4' });
	assert.notEqual(changedBody.size, originalBody.size);
	const fixture = await relinkFixture(context, originalBody);
	fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(changedBody, NEW_LOCATOR_REVISION));

	const rebound = await fixture.store.relinkLinkedVideoOriginal(
		PROJECT_ID,
		videoSource(),
		NEW_LOCATOR_ID,
		{
			admission: 'changed-content',
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: changedBody,
		},
	);

	assert.equal(rebound.locatorId, NEW_LOCATOR_ID);
	assert.equal(rebound.byteLength, changedBody.size);
	assert.notEqual(rebound.sha256, fixture.original.sha256);
	assert.equal(rebound.mimeType, fixture.original.mimeType);
	assert.deepEqual(rebound.sourceShape, fixture.original.sourceShape);
	assert.notEqual(rebound.bindingToken, fixture.original.bindingToken);
	assert.deepEqual(await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, SOURCE_ID), rebound);
	assert.equal(currentRoot(fixture.databaseName).bindingToken, rebound.bindingToken);
	assert.deepEqual(fixture.releases, []);
});

test('changed-content relink refuses a video source that retains extracted audio', async (context) => {
	const originalBody = new Blob(['audible original retained bytes'], { type: 'video/mp4' });
	const changedBody = new Blob(['audible replacement retained bytes!'], { type: 'video/mp4' });
	const source = Object.freeze({ ...videoSource(), audioCodec: 'aac', hasAudio: true });
	const fixture = await relinkFixture(context, originalBody, source);
	fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(changedBody, NEW_LOCATOR_REVISION));

	await assert.rejects(
		fixture.store.relinkLinkedVideoOriginal(PROJECT_ID, source, NEW_LOCATOR_ID, {
			admission: 'changed-content',
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: changedBody,
		}),
		/retains canonical extracted audio.*silent video source/iu,
	);

	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, SOURCE_ID),
		fixture.original,
	);
	assert.equal(currentRoot(fixture.databaseName).bindingToken, fixture.original.bindingToken);
});

test('changed-content relink refuses a MIME type change and keeps exact admission the default', async (context) => {
	const originalBody = new Blob(['typed silent retained bytes'], { type: 'video/mp4' });
	const retypedBody = new Blob(['typed silent replacement bytes'], { type: 'video/webm' });
	const resizedBody = new Blob(['resized silent replacement retained bytes'], { type: 'video/mp4' });
	const fixture = await relinkFixture(context, originalBody);

	fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(retypedBody, NEW_LOCATOR_REVISION));
	await assert.rejects(
		fixture.store.relinkLinkedVideoOriginal(PROJECT_ID, videoSource(), NEW_LOCATOR_ID, {
			admission: 'changed-content',
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: retypedBody,
		}),
		/does not match the current MIME type/iu,
	);

	fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(resizedBody, NEW_LOCATOR_REVISION));
	await assert.rejects(
		fixture.store.relinkLinkedVideoOriginal(PROJECT_ID, videoSource(), NEW_LOCATOR_ID, {
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: resizedBody,
		}),
		/does not match the current byte length/iu,
	);

	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, SOURCE_ID),
		fixture.original,
	);
});

test('changed-content relink still requires the selected and loaded bytes to match', async (context) => {
	const originalBody = new Blob(['drifting silent retained bytes'], { type: 'video/mp4' });
	const selectedBody = new Blob(['selected silent replacement bytes'], { type: 'video/mp4' });
	const driftedBody = new Blob(['drifted-on-disk replacement bytes'], { type: 'video/mp4' });
	assert.equal(driftedBody.size, selectedBody.size);
	const fixture = await relinkFixture(context, originalBody);
	fixture.snapshots.set(NEW_LOCATOR_ID, snapshot(driftedBody, NEW_LOCATOR_REVISION));

	await assert.rejects(
		fixture.store.relinkLinkedVideoOriginal(PROJECT_ID, videoSource(), NEW_LOCATOR_ID, {
			admission: 'changed-content',
			expectedBindingToken: fixture.original.bindingToken,
			expectedLocatorRevision: NEW_LOCATOR_REVISION,
			expectedSnapshot: selectedBody,
		}),
		/changed content after selection|changed byte length after selection/iu,
	);

	assert.deepEqual(
		await fixture.store.getLinkedVideoOriginalBinding(PROJECT_ID, SOURCE_ID),
		fixture.original,
	);
	assert.equal(currentRoot(fixture.databaseName).bindingToken, fixture.original.bindingToken);
});

async function relinkFixture(
	context: TestContext,
	originalBody: Blob,
	source: LinkedVideoOriginalSource = videoSource(),
) {
	const databaseName = `linked-video-relink-${Date.now()}-${Math.random()}`;
	const snapshots = new Map<string, Readonly<{ blob: Blob; locatorRevision: string }>>([
		[OLD_LOCATOR_ID, snapshot(originalBody, OLD_LOCATOR_REVISION)],
	]);
	const loads: Array<Readonly<{ locatorId: string; expectedRevision: string | null }>> = [];
	const releases: unknown[] = [];
	const fixture: {
		loadOverride: ((
			locatorId: string,
			expectedRevision: string | null,
		) => Promise<Readonly<{ blob: Blob; locatorRevision: string }> | null>) | null;
	} = { loadOverride: null };
	const port: LinkedVideoOriginalPort = {
		async load(locatorId, { expectedRevision }) {
			loads.push({ locatorId, expectedRevision });
			if (fixture.loadOverride) return fixture.loadOverride(locatorId, expectedRevision);
			const selected = snapshots.get(locatorId) ?? null;
			return expectedRevision !== null && selected?.locatorRevision !== expectedRevision
				? null
				: selected;
		},
		release(reference) { releases.push(reference); return true; },
	};
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName,
		linkedVideoOriginalPort: port,
	});
	context.after(async () => { await store.close(); });
	const original = await store.bindLinkedVideoOriginal(
		PROJECT_ID,
		source,
		OLD_LOCATOR_ID,
		{
			expectedLocatorRevision: OLD_LOCATOR_REVISION,
			expectedSnapshot: originalBody,
		},
	);
	return {
		databaseName,
		loads,
		original,
		releases,
		snapshots,
		store,
		get loadOverride() { return fixture.loadOverride; },
		set loadOverride(value) { fixture.loadOverride = value; },
	};
}

function currentRoot(databaseName: string) {
	const key = linkedOriginalBindingKey(PROJECT_ID, SOURCE_ID);
	return normalizeLinkedOriginalProvisionalRoot(
		getMemoryDatabase(databaseName).linkedOriginalProvisionalRoots.get(key),
	);
}

function snapshot(blob: Blob, locatorRevision: string) {
	return Object.freeze({ blob, locatorRevision });
}

function videoSource(): LinkedVideoOriginalSource {
	return Object.freeze({
		kind: 'video',
		id: SOURCE_ID,
		storageKey: STORAGE_KEY,
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

function deferred<Value>() {
	let resolvePromise!: (value: Value | PromiseLike<Value>) => void;
	let rejectPromise!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, resolve: resolvePromise, reject: rejectPromise };
}
