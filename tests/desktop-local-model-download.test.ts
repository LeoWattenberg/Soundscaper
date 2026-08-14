/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { downloadLocalModelArtifact } from '../desktop/local-model-download.ts';
import { FileLocalModelStore, type LocalModelArtifact } from '../desktop/local-model-store.ts';

const PAYLOAD = 'the quick brown fox jumps over the lazy dog';
const ARTIFACT: LocalModelArtifact = Object.freeze({
	fileName: 'model.onnx',
	byteLength: Buffer.byteLength(PAYLOAD),
	sha256: createHash('sha256').update(PAYLOAD).digest('hex'),
});
const URL_UNDER_TEST = 'https://models.invalid/silero/model.onnx';

async function createStore(t: { after: (fn: () => unknown) => void }): Promise<FileLocalModelStore> {
	const root = await mkdtemp(join(tmpdir(), 'scape-model-download-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const store = new FileLocalModelStore(root);
	await store.initialize();
	return store;
}

interface StubCall {
	readonly range: string | null;
}

function stubFetch(options: {
	readonly body: string | (() => AsyncIterable<Uint8Array>);
	readonly status?: number;
	readonly contentLength?: number | null;
	readonly calls?: StubCall[];
}): typeof fetch {
	return (async (_input: unknown, init?: { headers?: Record<string, string> }) => {
		const range = init?.headers?.range ?? null;
		options.calls?.push({ range });
		const declared = options.contentLength === undefined
			? undefined
			: options.contentLength;
		const bytes = typeof options.body === 'string' ? Buffer.from(options.body) : null;
		async function* iterate(): AsyncIterable<Uint8Array> {
			if (bytes) {
				yield new Uint8Array(bytes);
				return;
			}
			yield* (options.body as () => AsyncIterable<Uint8Array>)();
		}
		return {
			status: options.status ?? 200,
			headers: {
				get: (name: string) => (name.toLowerCase() === 'content-length'
					? String(declared ?? bytes?.byteLength ?? '')
					: null),
			},
			body: iterate(),
		};
	}) as unknown as typeof fetch;
}

test('a verified artifact is published once downloaded', { timeout: 20_000 }, async (t) => {
	const store = await createStore(t);
	const progress: number[] = [];

	const result = await downloadLocalModelArtifact({
		store,
		artifact: ARTIFACT,
		url: URL_UNDER_TEST,
		fetchImpl: stubFetch({ body: PAYLOAD }),
		onProgress: ({ completedBytes }) => progress.push(completedBytes),
	});

	assert.equal(result.transferredBytes, ARTIFACT.byteLength);
	assert.equal(result.resumedFromBytes, 0);
	assert.equal(await store.hasBlob(ARTIFACT.sha256), true);
	assert.equal(String(await readFile(store.blobPath(ARTIFACT.sha256))), PAYLOAD);
	assert.deepEqual(progress, [ARTIFACT.byteLength]);
});

test('an already-installed artifact is not fetched again', { timeout: 20_000 }, async (t) => {
	const store = await createStore(t);
	await downloadLocalModelArtifact({
		store, artifact: ARTIFACT, url: URL_UNDER_TEST, fetchImpl: stubFetch({ body: PAYLOAD }),
	});

	const result = await downloadLocalModelArtifact({
		store,
		artifact: ARTIFACT,
		url: URL_UNDER_TEST,
		fetchImpl: (() => { throw new Error('must not fetch'); }) as unknown as typeof fetch,
	});
	assert.equal(result.transferredBytes, 0);
});

test('an interrupted download resumes from the bytes already on disk', { timeout: 20_000 }, async (t) => {
	const store = await createStore(t);
	const partialPath = await store.partialPath(ARTIFACT.sha256);
	const prefix = PAYLOAD.slice(0, 10);
	await writeFile(partialPath, prefix);

	const calls: StubCall[] = [];
	const result = await downloadLocalModelArtifact({
		store,
		artifact: ARTIFACT,
		url: URL_UNDER_TEST,
		fetchImpl: stubFetch({ body: PAYLOAD.slice(10), status: 206, calls }),
	});

	assert.deepEqual(calls, [{ range: 'bytes=10-' }]);
	assert.equal(result.resumedFromBytes, 10);
	assert.equal(result.transferredBytes, ARTIFACT.byteLength - 10);
	assert.equal(String(await readFile(store.blobPath(ARTIFACT.sha256))), PAYLOAD);
});

test('a server that ignores the range restarts cleanly rather than splicing', { timeout: 20_000 }, async (t) => {
	const store = await createStore(t);
	await writeFile(await store.partialPath(ARTIFACT.sha256), PAYLOAD.slice(0, 10));

	const result = await downloadLocalModelArtifact({
		store, artifact: ARTIFACT, url: URL_UNDER_TEST, fetchImpl: stubFetch({ body: PAYLOAD, status: 200 }),
	});

	assert.equal(result.resumedFromBytes, 0);
	assert.equal(String(await readFile(store.blobPath(ARTIFACT.sha256))), PAYLOAD);
});

test('a tampered body is refused and never published', { timeout: 20_000 }, async (t) => {
	const store = await createStore(t);
	const tampered = 'the quick brown fox jumps over the lazy cat';

	await assert.rejects(
		downloadLocalModelArtifact({
			store, artifact: ARTIFACT, url: URL_UNDER_TEST, fetchImpl: stubFetch({ body: tampered }),
		}),
		/does not match its recorded digest/iu,
	);
	assert.equal(await store.hasBlob(ARTIFACT.sha256), false);
});

test('a body longer than the artifact is cut off rather than written out', { timeout: 20_000 }, async (t) => {
	const store = await createStore(t);
	await assert.rejects(
		downloadLocalModelArtifact({
			store,
			artifact: ARTIFACT,
			url: URL_UNDER_TEST,
			fetchImpl: stubFetch({ body: `${PAYLOAD} and then some`, contentLength: ARTIFACT.byteLength }),
		}),
		/exceeded the recorded artifact length/iu,
	);
	assert.equal(await store.hasBlob(ARTIFACT.sha256), false);
});

test('a declared length beyond the artifact is refused before any bytes are read', { timeout: 20_000 }, async (t) => {
	const store = await createStore(t);
	await assert.rejects(
		downloadLocalModelArtifact({
			store,
			artifact: ARTIFACT,
			url: URL_UNDER_TEST,
			fetchImpl: stubFetch({ body: PAYLOAD, contentLength: ARTIFACT.byteLength + 4096 }),
		}),
		/declares more bytes than the artifact records/iu,
	);
});

test('a short transfer keeps its partial so the next attempt resumes', { timeout: 20_000 }, async (t) => {
	const store = await createStore(t);
	await assert.rejects(
		downloadLocalModelArtifact({
			store,
			artifact: ARTIFACT,
			url: URL_UNDER_TEST,
			fetchImpl: stubFetch({ body: PAYLOAD.slice(0, 20), contentLength: 20 }),
		}),
		/ended before the recorded artifact length/iu,
	);

	const partial = await stat(await store.partialPath(ARTIFACT.sha256));
	assert.equal(partial.size, 20, 'the partial survives for the resume');
	assert.equal(await store.hasBlob(ARTIFACT.sha256), false);
});

test('cancellation stops the transfer without publishing', { timeout: 20_000 }, async (t) => {
	const store = await createStore(t);
	const controller = new AbortController();

	await assert.rejects(
		downloadLocalModelArtifact({
			store,
			artifact: ARTIFACT,
			url: URL_UNDER_TEST,
			signal: controller.signal,
			fetchImpl: stubFetch({
				body: () => (async function* stream() {
					yield new Uint8Array(Buffer.from(PAYLOAD.slice(0, 5)));
					controller.abort();
					yield new Uint8Array(Buffer.from(PAYLOAD.slice(5)));
				})(),
			}),
		}),
		/aborted|cancelled/iu,
	);
	assert.equal(await store.hasBlob(ARTIFACT.sha256), false);
});

test('only clean https URLs are accepted', { timeout: 20_000 }, async (t) => {
	const store = await createStore(t);
	const fetchImpl = stubFetch({ body: PAYLOAD });

	for (const url of [
		'http://models.invalid/model.onnx',
		'https://user:secret@models.invalid/model.onnx',
		'https://models.invalid/model.onnx#fragment',
		'models.invalid/model.onnx',
	]) {
		await assert.rejects(
			downloadLocalModelArtifact({ store, artifact: ARTIFACT, url, fetchImpl }),
			/must use https|must not carry credentials|must be absolute/iu,
			url,
		);
	}
});

test('a failing status is reported rather than retried silently', { timeout: 20_000 }, async (t) => {
	const store = await createStore(t);
	await assert.rejects(
		downloadLocalModelArtifact({
			store, artifact: ARTIFACT, url: URL_UNDER_TEST, fetchImpl: stubFetch({ body: '', status: 404 }),
		}),
		/failed with status 404/iu,
	);
});
