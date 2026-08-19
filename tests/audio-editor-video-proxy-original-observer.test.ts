/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoProxyOriginalObserver,
	type VideoProxyOriginalStore,
} from '../src/common/editor/controller/video-proxy-original-observer.ts';

const PROJECT_ID = 'project-1';
const SOURCE_ID = 'source-1';
const SHA = 'a1'.repeat(32);
const OTHER_SHA = 'b2'.repeat(32);

function videoSource(overrides: Record<string, unknown> = {}) {
	return {
		id: SOURCE_ID,
		kind: 'video',
		storageKey: `${SOURCE_ID}-storage`,
		contentSha256: SHA,
		mimeType: 'video/mp4',
		...overrides,
	};
}

function project(sources: readonly Record<string, unknown>[] = [videoSource()]) {
	return { id: PROJECT_ID, sources };
}

const OWNED = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'video/mp4' });
const LINKED = new Blob([new Uint8Array([9, 9, 9])], { type: 'video/quicktime' });

function ownedStore(blob: Blob | null = OWNED): VideoProxyOriginalStore {
	return { loadMediaAsset: () => Promise.resolve(blob) };
}

function request(overrides: Record<string, unknown> = {}) {
	return {
		projectId: PROJECT_ID,
		sourceId: SOURCE_ID,
		storageKey: `${SOURCE_ID}-storage`,
		mimeType: 'video/mp4',
		contentSha256: SHA,
		...overrides,
	};
}

test('an owned original opens with a generation the project can already state', async () => {
	const observe = createVideoProxyOriginalObserver({
		store: ownedStore(), getProject: () => project(),
	});
	const lease = await observe(request());

	assert.equal(lease.blob, OWNED);
	assert.equal(lease.fingerprint.authority, 'owned');
	assert.equal(lease.fingerprint.byteLength, 5);
	assert.equal(lease.fingerprint.sha256, SHA);
	// The token has to move when the bytes behind the source move, which for an
	// owned source is exactly when its storage key or content digest changes.
	assert.equal(lease.fingerprint.generationToken, `owned:${SOURCE_ID}-storage:${SHA}`);
	assert.ok(Object.isFrozen(lease.fingerprint));
	lease.assertCurrent();
});

test('a linked original hangs its generation from the binding relink moves', async () => {
	const store: VideoProxyOriginalStore = {
		loadMediaAsset: () => Promise.resolve(null),
		resolveLinkedVideoOriginal: () => Promise.resolve({
			blob: LINKED,
			binding: { bindingToken: 'binding-7', locatorRevision: 'rev-3', locatorId: 'locator-1' },
		}),
	};
	const lease = await createVideoProxyOriginalObserver({ store, getProject: () => project() })(request());

	assert.equal(lease.blob, LINKED);
	assert.equal(lease.fingerprint.authority, 'linked');
	// A linked file's bytes live outside the project, so its recorded digest
	// cannot say whether it is still the file the user pointed at; the binding
	// and its revision can, and they are what relink replaces.
	assert.equal(lease.fingerprint.generationToken, 'linked:binding-7:rev-3');
});

test('a source that changed under the lease refuses rather than answering for the new one', async () => {
	let current = project();
	const lease = await createVideoProxyOriginalObserver({
		store: ownedStore(), getProject: () => current,
	})(request());
	lease.assertCurrent();

	// Replace, reprobe, and trim all land as a new digest on the same source.
	current = project([videoSource({ contentSha256: OTHER_SHA })]);
	assert.throws(() => lease.assertCurrent(), (error: Error) => {
		assert.equal(error.name, 'AbortError');
		return /changed/u.test(error.message);
	});

	// Consolidate moves the media instead, which is the same question asked of
	// the storage key.
	current = project([videoSource({ storageKey: 'managed-storage' })]);
	assert.throws(() => lease.assertCurrent(), /changed/u);

	// And a removed source has nothing left to be current about.
	current = project([]);
	assert.throws(() => lease.assertCurrent(), /no longer/u);
});

test('a project that closed or switched under the lease refuses too', async () => {
	let current: unknown = project();
	const lease = await createVideoProxyOriginalObserver({
		store: ownedStore(), getProject: () => current,
	})(request());

	current = { id: 'another-project', sources: [videoSource()] };
	assert.throws(() => lease.assertCurrent(), /no longer open/u);
	current = null;
	assert.throws(() => lease.assertCurrent(), /no longer open/u);
});

test('a stale request is refused before any media is read', async () => {
	let loads = 0;
	const store: VideoProxyOriginalStore = {
		loadMediaAsset: () => {
			loads += 1;
			return Promise.resolve(OWNED);
		},
	};
	const observe = createVideoProxyOriginalObserver({ store, getProject: () => project() });

	await assert.rejects(observe(request({ contentSha256: OTHER_SHA })), /no longer has content/u);
	await assert.rejects(observe(request({ storageKey: 'somewhere-else' })), /no longer stores/u);
	assert.equal(loads, 0, 'a stale observation must not read media');
});

test('an original that is not there is reported, not substituted', async () => {
	const observe = createVideoProxyOriginalObserver({
		store: ownedStore(null), getProject: () => project(),
	});
	await assert.rejects(observe(request()), /not available/u);

	// An audio source is not an original a proxy can stand in for.
	const audio = createVideoProxyOriginalObserver({
		store: ownedStore(), getProject: () => project([videoSource({ kind: 'audio' })]),
	});
	await assert.rejects(audio(request()), /not a video source/u);
});

test('a released lease stops answering, and releasing twice is not an error', async () => {
	const lease = await createVideoProxyOriginalObserver({
		store: ownedStore(), getProject: () => project(),
	})(request());

	await lease.release();
	await lease.release();
	assert.throws(() => lease.assertCurrent(), /released/u);
});

test('an aborted observation never reaches the store', async () => {
	let loads = 0;
	const controller = new AbortController();
	controller.abort();
	const observe = createVideoProxyOriginalObserver({
		store: {
			loadMediaAsset: () => {
				loads += 1;
				return Promise.resolve(OWNED);
			},
		},
		getProject: () => project(),
	});

	await assert.rejects(observe(request({ signal: controller.signal })), (error: Error) => (
		error.name === 'AbortError'
	));
	assert.equal(loads, 0);
});
