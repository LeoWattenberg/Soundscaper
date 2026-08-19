/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperVideoProxyBodySourceV18 } from '../src/framescaper/editor-video-proxy-body-source-v18.ts';
import type {
	FramescaperVideoProxyBodyRequestV18,
	FramescaperVideoProxyExpectedBodyV18,
} from '../src/framescaper/editor-video-proxy-reattestation-contract-v18.ts';

const PROJECT_ID = 'project-1';
const SOURCE_ID = 'source-1';
const PROXY_SHA = 'a1'.repeat(32);
const TIMING_SHA = 'b2'.repeat(32);
const PROXY_KEY = `video-proxy-sha256:${PROXY_SHA}`;
const TIMING_KEY = `video-timing-sha256:${TIMING_SHA}`;
const PROXY_BODY = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6])], { type: 'video/mp4' });
const TIMING_BODY = new Blob([new Uint8Array([7, 8, 9])], {
	type: 'application/vnd.soundscaper.video-timing',
});

const PROXY_EXPECTED: FramescaperVideoProxyExpectedBodyV18 = Object.freeze({
	role: 'proxy',
	kind: 'video-proxy',
	encoding: 'video-proxy-v1',
	storageKey: PROXY_KEY,
	mimeType: 'video/mp4',
	byteLength: 6,
	sha256: PROXY_SHA,
});

const TIMING_EXPECTED: FramescaperVideoProxyExpectedBodyV18 = Object.freeze({
	role: 'timing',
	kind: 'video-timing',
	encoding: 'soundscaper-video-timing-v1',
	storageKey: TIMING_KEY,
	mimeType: 'application/vnd.soundscaper.video-timing',
	byteLength: 3,
	sha256: TIMING_SHA,
	frameCount: 4,
	timescale: 24,
	finalFrameDurationTicks: '1',
});

function project(attachment: unknown = attached()) {
	return {
		id: PROJECT_ID,
		sources: [{ id: SOURCE_ID, kind: 'video', proxyAttachment: attachment }],
	};
}

function attached(overrides: Record<string, unknown> = {}) {
	return {
		storageKey: PROXY_KEY,
		sha256: PROXY_SHA,
		byteLength: 6,
		mimeType: 'video/mp4',
		timingAsset: { storageKey: TIMING_KEY, sha256: TIMING_SHA },
		...overrides,
	};
}

function store(bodies: Readonly<Record<string, Blob | null>> = { [PROXY_KEY]: PROXY_BODY, [TIMING_KEY]: TIMING_BODY }) {
	const reads: string[] = [];
	return {
		reads,
		store: {
			loadMediaAsset: (key: string) => {
				reads.push(key);
				return Promise.resolve(bodies[key] ?? null);
			},
		},
	};
}

function request(
	expected: FramescaperVideoProxyExpectedBodyV18,
	overrides: Partial<FramescaperVideoProxyBodyRequestV18> = {},
): FramescaperVideoProxyBodyRequestV18 {
	return { projectId: PROJECT_ID, sourceId: SOURCE_ID, role: expected.role, expected, ...overrides };
}

test('both bodies an attachment names are readable through one port', async () => {
	const host = store();
	const acquire = createFramescaperVideoProxyBodySourceV18({
		store: host.store, getProject: () => project(),
	});

	const proxy = await acquire(request(PROXY_EXPECTED));
	// Canonicalised on the way out, so the bytes are compared rather than the
	// reference the store happened to answer with.
	assert.equal(proxy.body.size, PROXY_BODY.size);
	assert.equal(proxy.body.type, PROXY_BODY.type);
	// Content-addressed storage means the digest is the generation: a changed
	// body is a different key, never this key at a later moment.
	assert.equal(proxy.identity.generationToken, `video-proxy:${PROXY_SHA}`);
	assert.equal(proxy.identity.storageKey, PROXY_KEY);

	const timing = await acquire(request(TIMING_EXPECTED));
	assert.equal(timing.body.size, TIMING_BODY.size);
	assert.equal(timing.identity.generationToken, `video-timing:${TIMING_SHA}`);
	assert.deepEqual(host.reads, [PROXY_KEY, TIMING_KEY]);
});

test('a body of the wrong length is refused before anything is digested', async () => {
	const acquire = createFramescaperVideoProxyBodySourceV18({
		store: store({ [PROXY_KEY]: new Blob([new Uint8Array([1, 2])], { type: 'video/mp4' }) }).store,
		getProject: () => project(),
	});
	// Not the body this attachment names. Hashing it would only rediscover that
	// at the cost of reading all of it.
	await assert.rejects(acquire(request(PROXY_EXPECTED)), /is 2 bytes, not 6/u);
});

test('a missing body is reported rather than substituted', async () => {
	const acquire = createFramescaperVideoProxyBodySourceV18({
		store: store({}).store, getProject: () => project(),
	});
	// Retention may have collected it, or a copy may never have carried it. Either
	// way the answer upstream is original-or-unavailable, never a proxy on trust.
	await assert.rejects(acquire(request(PROXY_EXPECTED)), /is missing/u);
});

test('a body is not read for a source whose attachment has gone or changed', async () => {
	const host = store();
	let current: unknown = project(null);
	const acquire = createFramescaperVideoProxyBodySourceV18({
		store: host.store, getProject: () => current,
	});
	await assert.rejects(acquire(request(PROXY_EXPECTED)), /no longer has a proxy attachment/u);

	current = project(attached({ storageKey: 'video-proxy-sha256:other' }));
	await assert.rejects(acquire(request(PROXY_EXPECTED)), /no longer names/u);

	current = { id: 'other-project', sources: [] };
	await assert.rejects(acquire(request(PROXY_EXPECTED)), /no longer open/u);
	assert.deepEqual(host.reads, [], 'a body nothing names must not be read');
});

test('a lease notices the attachment being replaced under it', async () => {
	let current = project();
	const lease = await createFramescaperVideoProxyBodySourceV18({
		store: store().store, getProject: () => current,
	})(request(PROXY_EXPECTED));
	lease.assertCurrent();

	current = project(attached({ storageKey: 'video-proxy-sha256:other' }));
	assert.throws(() => lease.assertCurrent(), (error: Error) => {
		assert.equal(error.name, 'AbortError');
		return /no longer names/u.test(error.message);
	});
});

test('a released lease stops answering', async () => {
	const lease = await createFramescaperVideoProxyBodySourceV18({
		store: store().store, getProject: () => project(),
	})(request(PROXY_EXPECTED));

	await lease.release();
	assert.throws(() => lease.assertCurrent(), /released/u);
});

test('an aborted acquisition never reaches the store', async () => {
	const host = store();
	const controller = new AbortController();
	controller.abort();
	const acquire = createFramescaperVideoProxyBodySourceV18({
		store: host.store, getProject: () => project(),
	});

	await assert.rejects(
		acquire(request(PROXY_EXPECTED, { signal: controller.signal })),
		(error: Error) => error.name === 'AbortError',
	);
	assert.deepEqual(host.reads, []);
});
