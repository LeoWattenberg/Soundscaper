/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { promotePointer } from '../scripts/lib/ffmpeg-runtime-publisher.mjs';

const KEY = 'runtime/ffmpeg/0.12.10/latest.json';
const URL = `https://assets.soundscaper.org/${KEY}`;
const POLICY = Object.freeze({
	contentType: 'application/json; charset=utf-8',
	cacheControl: 'no-store',
});

test('pointer smoke failure CAS-restores the exact prior pointer and purges the rollback', async () => {
	const prior = Buffer.from('{"releaseId":"prior"}\n');
	const candidate = Buffer.from('{"releaseId":"candidate"}\n');
	const fixture = memoryPointerClient(prior);
	const purges = [];

	await assert.rejects(
		() => promotePointer({
			client: fixture.client,
			current: { key: KEY, bytes: prior, etag: fixture.etag() },
			pointerBytes: candidate,
			pointerKey: KEY,
			pointerPolicy: POLICY,
			pointerUrl: URL,
			publicFetch: async () => { throw new Error('edge still serves stale bytes'); },
			purgeUrls: async (urls) => { purges.push(urls); },
		}),
		/restored the prior release.*edge still serves stale bytes/iu,
	);
	assert.deepEqual(fixture.bytes(), prior);
	assert.equal(fixture.puts.at(-1).options.ifMatch, '"revision-2"');
	assert.deepEqual(purges, [[URL], [URL]]);
});

test('first pointer smoke failure deletes only the unchanged promoted candidate', async () => {
	const candidate = Buffer.from('{"releaseId":"first"}\n');
	const fixture = memoryPointerClient(null);
	const purges = [];

	await assert.rejects(
		() => promotePointer({
			client: fixture.client,
			current: { key: KEY, bytes: null, etag: null },
			pointerBytes: candidate,
			pointerKey: KEY,
			pointerPolicy: POLICY,
			pointerUrl: URL,
			publicFetch: async () => { throw new Error('public 404'); },
			purgeUrls: async (urls) => { purges.push(urls); },
		}),
		/removed the guarded first pointer.*public 404/iu,
	);
	assert.equal(fixture.bytes(), null);
	assert.equal(fixture.deletes, 1);
	assert.deepEqual(purges, [[URL], [URL]]);
});

test('pointer CAS conflict refuses before purge or public smoke', async () => {
	const fixture = memoryPointerClient(Buffer.from('prior'));
	fixture.conflict = true;
	let sideEffects = 0;
	await assert.rejects(
		() => promotePointer({
			client: fixture.client,
			current: { key: KEY, bytes: Buffer.from('prior'), etag: fixture.etag() },
			pointerBytes: Buffer.from('candidate'),
			pointerKey: KEY,
			pointerPolicy: POLICY,
			pointerUrl: URL,
			publicFetch: async () => { sideEffects += 1; return new Response(); },
			purgeUrls: async () => { sideEffects += 1; },
		}),
		/changed concurrently/u,
	);
	assert.equal(sideEffects, 0);
});

function memoryPointerClient(initial) {
	let stored = initial ? Buffer.from(initial) : null;
	let currentEtag = initial ? '"revision-1"' : null;
	let revision = initial ? 1 : 0;
	const fixture = {
		conflict: false,
		deletes: 0,
		puts: [],
		bytes: () => stored && Buffer.from(stored),
		etag: () => currentEtag,
		client: {
			async put(key, bytes, options) {
				fixture.puts.push({ key, bytes: Buffer.from(bytes), options });
				if (fixture.conflict || (options.ifMatch && options.ifMatch !== currentEtag)
					|| (options.ifNoneMatch === '*' && stored)) return response(412);
				stored = Buffer.from(bytes);
				currentEtag = `"revision-${String(++revision)}"`;
				return response(200, { etag: currentEtag });
			},
			async get() {
				if (!stored) return { response: response(404), bytes: Buffer.alloc(0) };
				return {
					response: response(200, {
						etag: currentEtag,
						'content-type': POLICY.contentType,
						'cache-control': POLICY.cacheControl,
					}),
					bytes: Buffer.from(stored),
				};
			},
			async delete() {
				fixture.deletes += 1;
				stored = null;
				currentEtag = null;
				return response(204);
			},
		},
	};
	return fixture;
}

function response(status, headers = {}) {
	return new Response(null, { status, headers });
}
