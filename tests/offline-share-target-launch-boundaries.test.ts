/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectSharedFiles,
	sharedFilesBodyUrl,
	sharedFilesManifestUrl,
	SHARED_FILES_CACHE_NAME,
} from '../src/common/offline/share-target-launch.ts';

const ORIGIN = 'https://soundscaper.org';

test('body responses are acquired before the manifest is claimed', async () => {
	const token = '6'.repeat(32);
	const manifestUrl = sharedFilesManifestUrl(token);
	let manifestAvailable = true;
	const cache = {
		match: async (url: string): Promise<Response | undefined> => {
			if (url === manifestUrl) return new Response(JSON.stringify({
				schemaVersion: 1,
				files: [{ name: 'held.wav', type: 'audio/wav', byteLength: 4 }],
			}));
			assert.equal(manifestAvailable, true, 'body matching must precede the manifest claim');
			return new Response('held');
		},
		delete: async (url: string): Promise<boolean> => {
			if (url !== manifestUrl) return true;
			const claimed = manifestAvailable;
			manifestAvailable = false;
			return claimed;
		},
	};

	const result = await collectSharedFiles({
		href: `${ORIGIN}/en/?share=${token}`,
		caches: { open: async () => cache },
		replaceAddress: () => undefined,
	});

	assert.equal(result.status, 'collected');
	assert.equal(await result.files[0]?.text(), 'held');
});

test('a rejected manifest claim cancels every body acquired before it', async () => {
	const token = '2'.repeat(32);
	const failure = new Error('manifest claim failed');
	let cancelled = false;
	const cache = {
		match: async (url: string): Promise<Response | undefined> => (
			url === sharedFilesManifestUrl(token)
				? new Response(JSON.stringify({
					schemaVersion: 1,
					files: [{ name: 'held.wav', type: 'audio/wav', byteLength: 1 }],
				}))
				: new Response(new ReadableStream({ cancel() { cancelled = true; } }))
		),
		delete: async (): Promise<boolean> => { throw failure; },
	};
	const errors: unknown[] = [];

	const result = await collectSharedFiles({
		href: `${ORIGIN}/en/?share=${token}`,
		caches: { open: async () => cache },
		replaceAddress: () => undefined,
		onError: (error) => { errors.push(error); },
	});

	assert.equal(result.status, 'unreadable');
	assert.equal(cancelled, true);
	assert.deepEqual(errors, [failure]);
});

test('a stashed body is streamed only until its actual bytes exceed its declaration', async () => {
	const token = '9'.repeat(32);
	const errors: unknown[] = [];
	const deleted: string[] = [];
	let cancelled = false;
	let blobCalls = 0;
	const manifest = new Response(JSON.stringify({
		schemaVersion: 1,
		files: [{ name: 'forged.wav', type: 'audio/wav', byteLength: 4 }],
	}));
	const body = {
		body: new ReadableStream<Uint8Array>({
			start(controller) { controller.enqueue(Uint8Array.from([1, 2, 3, 4, 5])); },
			cancel() { cancelled = true; },
		}),
		blob: async () => { blobCalls += 1; throw new Error('the body must be streamed'); },
	} as unknown as Response;
	const cache = {
		match: async (url: string): Promise<Response | undefined> => (
			url === sharedFilesManifestUrl(token) ? manifest.clone() : body
		),
		delete: async (url: string): Promise<boolean> => { deleted.push(url); return true; },
	};

	const result = await collectSharedFiles({
		href: `${ORIGIN}/en/?share=${token}`,
		caches: { open: async () => cache },
		replaceAddress: () => undefined,
		onError: (error) => { errors.push(error); },
	});

	assert.equal(result.status, 'missing');
	assert.equal(blobCalls, 0);
	assert.equal(cancelled, true, 'the unread remainder is cancelled at the first oversized chunk');
	assert.equal(errors.length, 1);
	assert.match(String((errors[0] as Error).message), /forged\.wav/u);
	assert.deepEqual(deleted, [sharedFilesManifestUrl(token), sharedFilesBodyUrl(token, 0)]);
});

test('an invalid streamed chunk cancels the claimed body before collection fails', async () => {
	const token = '7'.repeat(32);
	const failureReports: unknown[] = [];
	let cancelled = false;
	const manifestUrl = sharedFilesManifestUrl(token);
	const body = {
		body: new ReadableStream<Uint8Array>({
			start(controller) { controller.enqueue(new Uint8Array()); },
			cancel() { cancelled = true; },
		}),
	} as unknown as Response;
	const cache = {
		match: async (url: string): Promise<Response | undefined> => url === manifestUrl
			? new Response(JSON.stringify({
				schemaVersion: 1,
				files: [{ name: 'invalid.wav', type: 'audio/wav', byteLength: 1 }],
			}))
			: body,
		delete: async () => true,
	};

	const result = await collectSharedFiles({
		href: `${ORIGIN}/en/?share=${token}`,
		caches: { open: async () => cache },
		replaceAddress: () => undefined,
		onError: (error) => { failureReports.push(error); },
	});

	assert.equal(result.status, 'unreadable');
	assert.equal(cancelled, true);
	assert.match(String((failureReports[0] as Error).message), /invalid body chunk/u);
});

test('a failed body cancels every later response acquired before the claim', async () => {
	const token = '5'.repeat(32);
	const failure = new Error('first body failed');
	let laterCancelled = false;
	const cache = {
		match: async (url: string): Promise<Response | undefined> => {
			if (url === sharedFilesManifestUrl(token)) return new Response(JSON.stringify({
				schemaVersion: 1,
				files: [
					{ name: 'failed.wav', type: 'audio/wav', byteLength: 1 },
					{ name: 'unread.wav', type: 'audio/wav', byteLength: 1 },
				],
			}));
			if (url === sharedFilesBodyUrl(token, 0)) return new Response(new ReadableStream({
				pull() { throw failure; },
			}));
			return new Response(new ReadableStream({
				cancel() { laterCancelled = true; },
			}));
		},
		delete: async () => true,
	};
	const errors: unknown[] = [];

	const result = await collectSharedFiles({
		href: `${ORIGIN}/en/?share=${token}`,
		caches: { open: async () => cache },
		replaceAddress: () => undefined,
		onError: (error) => { errors.push(error); },
	});

	assert.equal(result.status, 'unreadable');
	assert.deepEqual(errors, [failure]);
	assert.equal(laterCancelled, true);
});

test('actual streamed bytes retain an aggregate bound across malformed bodies', async () => {
	class AggregateLimitChunk extends Uint8Array {
		override get byteLength(): number { return 512 * 1024 * 1024; }
	}
	const token = '4'.repeat(32);
	let aggregateBodyCancelled = false;
	const cache = {
		match: async (url: string): Promise<Response | undefined> => {
			if (url === sharedFilesManifestUrl(token)) return new Response(JSON.stringify({
				schemaVersion: 1,
				files: [
					{ name: 'forged.wav', type: 'audio/wav', byteLength: 1 },
					{ name: 'overflow.wav', type: 'audio/wav', byteLength: 1 },
				],
			}));
			const chunk = url === sharedFilesBodyUrl(token, 0)
				? new AggregateLimitChunk([1])
				: Uint8Array.of(2);
			return new Response(new ReadableStream<Uint8Array>({
				start(controller) { controller.enqueue(chunk); },
				cancel() {
					if (url === sharedFilesBodyUrl(token, 1)) aggregateBodyCancelled = true;
				},
			}));
		},
		delete: async () => true,
	};
	const errors: unknown[] = [];

	const result = await collectSharedFiles({
		href: `${ORIGIN}/en/?share=${token}`,
		caches: { open: async () => cache },
		replaceAddress: () => undefined,
		onError: (error) => { errors.push(error); },
	});

	assert.equal(result.status, 'unreadable');
	assert.equal(aggregateBodyCancelled, true);
	assert.match(String((errors.at(-1) as Error).message), /actual byte limit/u);
});

test('stash cleanup attempts every body after an individual deletion fails', async () => {
	const token = '3'.repeat(32);
	const failure = new Error('first body could not be deleted');
	const deleted: string[] = [];
	const cache = {
		match: async (url: string): Promise<Response | undefined> => (
			url === sharedFilesManifestUrl(token)
				? new Response(JSON.stringify({
					schemaVersion: 1,
					files: [0, 1, 2].map((index) => ({
						name: `${String(index)}.wav`, type: 'audio/wav', byteLength: 1,
					})),
				}))
				: new Response('x')
		),
		delete: async (url: string): Promise<boolean> => {
			deleted.push(url);
			if (url === sharedFilesBodyUrl(token, 0)) throw failure;
			return true;
		},
	};
	const errors: unknown[] = [];

	const result = await collectSharedFiles({
		href: `${ORIGIN}/en/?share=${token}`,
		caches: { open: async () => cache },
		deliver: () => undefined,
		replaceAddress: () => undefined,
		onError: (error) => { errors.push(error); },
	});

	assert.equal(result.status, 'collected');
	assert.equal(result.files.length, 3);
	assert.deepEqual(errors, [failure]);
	assert.deepEqual(deleted, [
		sharedFilesManifestUrl(token),
		sharedFilesBodyUrl(token, 0),
		sharedFilesBodyUrl(token, 1),
		sharedFilesBodyUrl(token, 2),
	]);
});

test('concurrent collectors let only the manifest claimant read and deliver a stash', async () => {
	const token = '8'.repeat(32);
	const manifestUrl = sharedFilesManifestUrl(token);
	const bodyUrl = sharedFilesBodyUrl(token, 0);
	const contents = 'one delivery';
	const entries = new Map<string, Response>([
		[manifestUrl, new Response(JSON.stringify({
			schemaVersion: 1,
			files: [{ name: 'Once.wav', type: 'audio/wav', byteLength: contents.length }],
		}))],
		[bodyUrl, new Response(contents)],
	]);
	let manifestMatches = 0;
	let cancelledLoserBodies = 0;
	const bodyBytes = new TextEncoder().encode(contents);
	let releaseMatches!: () => void;
	const bothMatched = new Promise<void>((resolve) => { releaseMatches = resolve; });
	const cache = {
		match: async (url: string): Promise<Response | undefined> => {
			if (url === bodyUrl) {
				let sent = false;
				return new Response(new ReadableStream<Uint8Array>({
					pull(controller) {
						if (sent) controller.close();
						else { sent = true; controller.enqueue(bodyBytes); }
					},
					cancel() { cancelledLoserBodies += 1; },
				}));
			}
			const response = entries.get(url)?.clone();
			manifestMatches += 1;
			if (manifestMatches === 2) releaseMatches();
			await bothMatched;
			return response;
		},
		delete: async (url: string): Promise<boolean> => entries.delete(url),
	};
	const deliveries: string[][] = [];
	const collectOnce = () => collectSharedFiles({
		href: `${ORIGIN}/en/?share=${token}`,
		caches: { open: async (name) => {
			assert.equal(name, SHARED_FILES_CACHE_NAME);
			return cache;
		} },
		deliver: ({ files }) => { deliveries.push(files.map(({ name }) => name)); },
		replaceAddress: () => undefined,
	});

	const results = await Promise.all([collectOnce(), collectOnce()]);

	assert.deepEqual(results.map(({ status }) => status).sort(), ['collected', 'missing']);
	assert.deepEqual(deliveries, [['Once.wav']]);
	assert.equal(cancelledLoserBodies, 1);
	assert.deepEqual([...entries.keys()], []);
});
