/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { createScapeProjectFileService } from '../src/common/editor/controller/scape-project-file-service.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import {
	assertScapeArchiveByteSource,
	type ScapeArchiveByteSource,
} from '../src/common/editor/scape-archive-byte-source.ts';

const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';

test('desktop Scape read scopes retain one capability across serialized range consumers', async () => {
	const archiveBytes = Uint8Array.of(1, 2, 3, 4);
	const events: string[] = [];
	const service = createAudioEditorFileService({
		bridge: {
			async releaseRead(id: string) {
				events.push(`release:${id}`);
			},
		},
		fetch: async (_url: string, init: RequestInit) => {
			const range = new Headers(init.headers).get('Range');
			assert.ok(range);
			events.push(`fetch:${range}`);
			return exactRangeResponse(archiveBytes, range);
		},
	});

	const result = await service.withScapeReadDescriptor(
		scapeDescriptor(),
		{},
		async (source: ScapeArchiveByteSource) => {
			events.push('consume:start');
			assert.deepEqual(await source.read({ offset: 0, length: 2 }), Uint8Array.of(1, 2));
			assert.equal(events.some((event) => event.startsWith('release:')), false);
			events.push('consume:between');
			assert.deepEqual(await source.read({ offset: 2, length: 2 }), Uint8Array.of(3, 4));
			assert.equal(events.some((event) => event.startsWith('release:')), false);
			return 'consumed';
		},
	);

	assert.equal(result, 'consumed');
	assert.deepEqual(events, [
		'consume:start',
		'fetch:bytes=0-1',
		'consume:between',
		'fetch:bytes=2-3',
		'release:scape-read',
	]);
});

test('one desktop range scope spans Scape inspection, decision, and import', async () => {
	const archiveBytes = Uint8Array.of(1, 2, 3, 4);
	const events: string[] = [];
	const fileService = createAudioEditorFileService({
		bridge: {
			async releaseRead() {
				events.push('release');
			},
		},
		fetch: async (_url: string, init: RequestInit) => {
			const range = new Headers(init.headers).get('Range');
			assert.ok(range);
			events.push(`fetch:${range}`);
			return exactRangeResponse(archiveBytes, range);
		},
	});
	const projectService = createScapeProjectFileService({
		lifetime: new EditorControllerLifetime(),
		store: null,
		productCapabilities: {},
		inspectScapeProject: async (source, _store, options) => {
			events.push('inspect');
			assertScapeArchiveByteSource(source);
			assert.deepEqual(
				await source.read({ offset: 0, length: 1, signal: options.signal }),
				Uint8Array.of(1),
			);
			assert.equal(events.includes('release'), false);
			return Object.freeze({ exists: true, title: 'Ranged project' });
		},
		openScape: async (source) => {
			events.push('import');
			assertScapeArchiveByteSource(source);
			assert.deepEqual(await source.read({ offset: 3, length: 1 }), Uint8Array.of(4));
			assert.equal(events.includes('release'), false);
			return 'opened';
		},
	});

	const result = await fileService.withScapeReadDescriptor(
		scapeDescriptor(),
		{},
		async (source: ScapeArchiveByteSource) => projectService.openScapeFile(source, (request) => {
			events.push(`decision:${request.kind}`);
			return 'replace';
		}),
	);
	assert.equal(result, 'opened');
	assert.deepEqual(events, [
		'inspect',
		'fetch:bytes=0-0',
		'decision:collision',
		'import',
		'fetch:bytes=3-3',
		'release',
	]);
});

test('a cancelled Scape open releases its range capability without importing', async () => {
	const archiveBytes = Uint8Array.of(1);
	let importCalls = 0;
	let releaseCalls = 0;
	const fileService = createAudioEditorFileService({
		bridge: { async releaseRead() { releaseCalls += 1; } },
		fetch: async (_url: string, init: RequestInit) => {
			const range = new Headers(init.headers).get('Range');
			assert.ok(range);
			return exactRangeResponse(archiveBytes, range);
		},
	});
	const projectService = createScapeProjectFileService({
		lifetime: new EditorControllerLifetime(),
		store: null,
		productCapabilities: {},
		inspectScapeProject: async (source, _store, options) => {
			assertScapeArchiveByteSource(source);
			await source.read({ offset: 0, length: 1, signal: options.signal });
			return Object.freeze({ exists: true, title: 'Existing project' });
		},
		openScape: async () => {
			importCalls += 1;
			return 'must not open';
		},
	});

	assert.deepEqual(await fileService.withScapeReadDescriptor(
		{ ...scapeDescriptor(), size: 1 },
		{},
		async (source: ScapeArchiveByteSource) => projectService.openScapeFile(source, () => 'cancel'),
	), { cancelled: true });
	assert.equal(importCalls, 0);
	assert.equal(releaseCalls, 1);
});

test('desktop Scape read scopes fail closed before fetching and still release descriptors', async () => {
	const released: string[] = [];
	let fetchCalls = 0;
	const service = createAudioEditorFileService({
		bridge: { async releaseRead(id: string) { released.push(id); } },
		readMaximumBytes: 3,
		fetch: async () => {
			fetchCalls += 1;
			throw new Error('must not fetch');
		},
	});
	const cases = [
		{ ...scapeDescriptor({ id: 'wrong-name' }), name: 'project.aup4' },
		{ ...scapeDescriptor({ id: 'wrong-mime' }), mimeType: 'application/octet-stream' },
		scapeDescriptor({ id: 'oversized', size: 4 }),
	];

	for (const descriptor of cases) {
		await assert.rejects(
			service.withScapeReadDescriptor(descriptor, {}, async () => undefined),
			/Scape.*descriptor|admitted maximum/iu,
		);
	}
	assert.equal(fetchCalls, 0);
	assert.deepEqual(released, ['wrong-name', 'wrong-mime', 'oversized']);
});

test('desktop Scape read scopes preserve primary and release failures', async () => {
	const primary = new Error('inspection failed');
	const cleanup = new Error('release failed');
	const service = createAudioEditorFileService({
		bridge: { async releaseRead() { throw cleanup; } },
		fetch: async () => { throw new Error('must not fetch'); },
	});

	await assert.rejects(
		service.withScapeReadDescriptor(scapeDescriptor(), {}, async () => { throw primary; }),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, [primary, cleanup]);
			assert.equal(error.cause, primary);
			return true;
		},
	);
});

test('pre-aborted desktop Scape scopes skip fetch and consumer but release exactly once', async () => {
	const controller = new AbortController();
	const reason = new Error('cancel before Scape range admission');
	controller.abort(reason);
	let consumeCalls = 0;
	let fetchCalls = 0;
	let releaseCalls = 0;
	const service = createAudioEditorFileService({
		bridge: { async releaseRead() { releaseCalls += 1; } },
		fetch: async () => {
			fetchCalls += 1;
			throw new Error('must not fetch');
		},
	});

	await assert.rejects(
		service.withScapeReadDescriptor(
			scapeDescriptor(),
			{ signal: controller.signal },
			async () => { consumeCalls += 1; },
		),
		(error: unknown) => error === reason,
	);
	assert.equal(consumeCalls, 0);
	assert.equal(fetchCalls, 0);
	assert.equal(releaseCalls, 1);
});

test('desktop Scape abort is prompt while outer settlement awaits authoritative release', async () => {
	const controller = new AbortController();
	const reason = new DOMException('cancel stalled Scape open', 'AbortError');
	const readStarted = deferred<void>();
	const consumerRejected = deferred<unknown>();
	const releaseStarted = deferred<void>();
	const releaseGate = deferred<void>();
	const cancelled: unknown[] = [];
	let releaseCalls = 0;
	const reader = {
		read() {
			readStarted.resolve();
			return new Promise<never>(() => undefined);
		},
		cancel(cancelReason: unknown) {
			cancelled.push(cancelReason);
			return new Promise<never>(() => undefined);
		},
	};
	const service = createAudioEditorFileService({
		bridge: {
			async releaseRead() {
				releaseCalls += 1;
				releaseStarted.resolve();
				await releaseGate.promise;
			},
		},
		fetch: async () => ({
			ok: true,
			status: 206,
			headers: new Headers({
				'Content-Length': '1',
				'Content-Range': 'bytes 0-0/4',
			}),
			body: { getReader: () => reader },
		}),
	});
	const operation = service.withScapeReadDescriptor(
		scapeDescriptor(),
		{},
		async (source: ScapeArchiveByteSource) => {
			try {
				await source.read({ offset: 0, length: 1, signal: controller.signal });
			} catch (error) {
				consumerRejected.resolve(error);
				throw error;
			}
		},
	);
	await readStarted.promise;
	controller.abort(reason);
	const timeout = Symbol('timeout');
	assert.equal(await Promise.race([
		consumerRejected.promise,
		delay(250, timeout, { ref: false }),
	]), reason);
	await releaseStarted.promise;
	assert.equal(releaseCalls, 1);
	assert.deepEqual(cancelled, [reason]);
	let settled = false;
	void operation.finally(() => { settled = true; }).catch(() => undefined);
	await Promise.resolve();
	assert.equal(settled, false);
	releaseGate.resolve();
	await assert.rejects(operation, (error: unknown) => error === reason);
	assert.equal(releaseCalls, 1);
});

function scapeDescriptor(overrides: Readonly<Record<string, unknown>> = {}) {
	return Object.freeze({
		id: 'scape-read',
		url: 'soundscaper-app://bundle/_desktop/read/scape-read/project.scape',
		name: 'project.scape',
		size: 4,
		mimeType: SCAPE_MIME_TYPE,
		lastModified: 1,
		...overrides,
	});
}

function exactRangeResponse(bytes: Uint8Array, range: string): Response {
	const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
	assert.ok(match);
	const offset = Number(match[1]);
	const end = Number(match[2]);
	const body = bytes.slice(offset, end + 1);
	return new Response(body, {
		status: 206,
		headers: {
			'Content-Length': String(body.byteLength),
			'Content-Range': `bytes ${String(offset)}-${String(end)}/${String(bytes.byteLength)}`,
		},
	});
}

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	reject(reason?: unknown): void;
	resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}
