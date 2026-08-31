/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { verifyFfmpegRuntimeManifest } from '../scripts/lib/ffmpeg-runtime-manifest.mjs';
import {
	promotePointer,
	publishFfmpegRuntime,
} from '../scripts/lib/ffmpeg-runtime-publisher.mjs';
import {
	REQUIRED_LICENSING_CHECKS,
	createFixture,
	descriptor,
	writeJson,
	writeManifest,
} from './helpers/ffmpeg-runtime-fixture.mjs';

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

test('first pointer smoke failure conditionally replaces the candidate with a fail-closed marker', async () => {
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
		/replaced the first pointer with an unavailable marker.*public 404/iu,
	);
	assert.deepEqual(JSON.parse(fixture.bytes()), { schemaVersion: 1, status: 'unavailable' });
	assert.equal(fixture.deletes, 0);
	assert.equal(fixture.puts.at(-1).options.ifMatch, '"revision-1"');
	assert.deepEqual(purges, [[URL], [URL]]);
});

test('first pointer smoke rollback never deletes a concurrent pointer writer', async () => {
	const candidate = Buffer.from('{"releaseId":"first"}\n');
	const competitor = Buffer.from('{"releaseId":"competitor"}\n');
	const fixture = memoryPointerClient(null);

	await assert.rejects(
		() => promotePointer({
			client: fixture.client,
			current: { key: KEY, bytes: null, etag: null },
			pointerBytes: candidate,
			pointerKey: KEY,
			pointerPolicy: POLICY,
			pointerUrl: URL,
			publicFetch: async () => {
				fixture.replace(competitor);
				throw new Error('candidate smoke failed after concurrent promotion');
			},
			purgeUrls: async () => undefined,
		}),
		/concurrent pointer was left in place.*concurrent promotion/iu,
	);
	assert.deepEqual(fixture.bytes(), competitor);
	assert.equal(fixture.deletes, 0);
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

test('rollback CAS conflict retains the concurrently promoted pointer', async () => {
	const prior = Buffer.from('{"releaseId":"prior"}\n');
	const candidate = Buffer.from('{"releaseId":"candidate"}\n');
	const competitor = Buffer.from('{"releaseId":"competitor"}\n');
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
			publicFetch: async () => {
				fixture.replace(competitor);
				throw new Error('public verification failed');
			},
			purgeUrls: async (urls) => { purges.push(urls); },
		}),
		/restoring FFmpeg latest\.json also failed.*public verification failed/iu,
	);
	assert.deepEqual(fixture.bytes(), competitor);
	assert.deepEqual(purges, [[URL]]);
});

test('licensing blocks are descriptive and do not weaken authenticated runtime publication', async (context) => {
	const fixture = await createFixture(context);
	const licensingPath = `${fixture.root}/config/production-licensing-matrix.json`;
	const licensing = JSON.parse(await readFile(licensingPath, 'utf8'));
	for (const check of licensing.distributionChecks) {
		if (REQUIRED_LICENSING_CHECKS.includes(check.id)) check.status = 'blocked';
	}
	const licensingBytes = Buffer.from(`${JSON.stringify(licensing, null, 2)}\n`);
	await writeJson(licensingPath, licensing);
	fixture.manifest.evidence.licensingMatrix = descriptor(
		'config/production-licensing-matrix.json', licensingBytes,
	);
	fixture.manifest.distributionChecks.runtimePublication = {
		allowed: false,
		blockedBy: [...REQUIRED_LICENSING_CHECKS],
	};
	fixture.manifest.distributionChecks.desktopRelease = {
		allowed: false,
		blockedBy: REQUIRED_LICENSING_CHECKS.slice(0, 2),
	};
	await writeManifest(fixture);
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: fixture.root,
		purpose: 'desktop-assembly',
	});
	const transport = runtimeTransport();
	const result = await publishFfmpegRuntime({
		repositoryRoot: fixture.root,
		loadRelease: async () => release,
		client: transport.client,
		applyCors: async () => undefined,
		purgeUrls: async () => undefined,
		publicFetch: transport.publicFetch,
	});
	assert.equal(result.objectCount, 6);
});

test('immutable metadata drift and purge failure both stop before pointer promotion', async (context) => {
	const fixture = await createFixture(context);
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot: fixture.root,
		purpose: 'desktop-assembly',
	});
	const transport = runtimeTransport();
	await publishFfmpegRuntime({
		repositoryRoot: fixture.root,
		client: transport.client,
		applyCors: async () => undefined,
		purgeUrls: async () => undefined,
		publicFetch: transport.publicFetch,
		loadRelease: async () => release,
	});
	const releasePrefix = `${release.publicPolicy.publicPrefix}/${release.publicPolicy.releaseSegment}/${release.manifestSha256}`;
	const firstKey = `${releasePrefix}/ffmpeg-core.js`;
	transport.objects.get(firstKey).contentType = 'application/octet-stream';
	await assert.rejects(
		() => publishFfmpegRuntime({
			repositoryRoot: fixture.root,
			client: transport.client,
			applyCors: async () => undefined,
			purgeUrls: async () => undefined,
			publicFetch: transport.publicFetch,
			loadRelease: async () => release,
		}),
		/Immutable R2 object.*content type is invalid/iu,
	);
	transport.objects.get(firstKey).contentType = release.publicPolicy.runtimeFiles[0].contentType;

	const fresh = runtimeTransport();
	let publicFetchCalls = 0;
	await assert.rejects(
		() => publishFfmpegRuntime({
			repositoryRoot: fixture.root,
			client: fresh.client,
			applyCors: async () => undefined,
			purgeUrls: async () => { throw new Error('exact purge failed'); },
			publicFetch: async (...args) => {
				publicFetchCalls += 1;
				return fresh.publicFetch(...args);
			},
			loadRelease: async () => release,
		}),
		/exact purge failed/iu,
	);
	assert.equal(publicFetchCalls, 0);
	assert.equal(fresh.puts.length, 5, 'only immutable release objects are written before their purge');
	assert.equal(fresh.objects.has(KEY), false, 'purge failure prevents pointer promotion');
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
		replace(bytes) {
			stored = Buffer.from(bytes);
			currentEtag = `"revision-${String(++revision)}"`;
		},
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

function runtimeTransport() {
	const objects = new Map();
	const puts = [];
	let revision = 0;
	const client = {
		async put(key, bytes, options) {
			puts.push({ key, bytes: Buffer.from(bytes), options });
			const current = objects.get(key);
			if (options.ifNoneMatch === '*' && current) return response(412);
			if (options.ifMatch && current?.etag !== options.ifMatch) return response(412);
			const etag = `"runtime-${String(++revision)}"`;
			objects.set(key, {
				bytes: Buffer.from(bytes),
				contentType: options.contentType,
				cacheControl: options.cacheControl,
				etag,
			});
			return response(200, { etag });
		},
		async get(key) {
			const object = objects.get(key);
			if (!object) return { response: response(404), bytes: Buffer.alloc(0) };
			return {
				response: response(200, {
					etag: object.etag,
					'content-type': object.contentType,
					'cache-control': object.cacheControl,
				}),
				bytes: Buffer.from(object.bytes),
			};
		},
	};
	const publicFetch = async (url) => {
		const object = objects.get(new globalThis.URL(url).pathname.slice(1));
		return object
			? new Response(object.bytes, {
				status: 200,
				headers: {
					'content-type': object.contentType,
					'cache-control': object.cacheControl,
					'access-control-allow-origin': 'https://soundscaper.org',
				},
			})
			: new Response(null, { status: 404 });
	};
	return { client, objects, publicFetch, puts };
}
