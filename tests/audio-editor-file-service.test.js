import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

test('desktop file service streams acknowledged chunks and applies backpressure', async () => {
	const calls = [];
	let activeWrite = false;
	const bridge = {
		async chooseSaveTarget(request) {
			calls.push(['choose', request]);
			return { id: 'target-1', name: 'mix.wav' };
		},
		async beginWrite(request) {
			calls.push(['begin', request]);
			return { writeId: 'write-1', chunkSize: 700_000 };
		},
		async writeChunk(request) {
			assert.equal(activeWrite, false);
			activeWrite = true;
			await Promise.resolve();
			calls.push(['chunk', request.offset, request.bytes.byteLength]);
			activeWrite = false;
			return { nextOffset: request.offset + request.bytes.byteLength };
		},
		async finishWrite(writeId) {
			calls.push(['finish', writeId]);
			return { byteLength: 1_500_001 };
		},
	};
	const service = createAudioEditorFileService({ bridge });
	const result = await service.saveFile({
		purpose: 'audio',
		suggestedName: 'mix.wav',
		mimeType: 'audio/wav',
		blob: new Blob([new Uint8Array(1_500_001)]),
	});

	assert.deepEqual(calls, [
		['choose', { purpose: 'audio', suggestedName: 'mix.wav', mimeType: 'audio/wav' }],
		['begin', { targetId: 'target-1', size: 1_500_001 }],
		['chunk', 0, 700_000],
		['chunk', 700_000, 700_000],
		['chunk', 1_400_000, 100_001],
		['finish', 'write-1'],
	]);
	assert.deepEqual(result, { method: 'desktop', fileName: 'mix.wav', size: 1_500_001 });
});

test('desktop file service aborts a desynchronized write without publishing it', async () => {
	const aborted = [];
	const service = createAudioEditorFileService({
		bridge: {
			async chooseSaveTarget() { return { id: 'target-2', name: 'labels.vtt' }; },
			async beginWrite() { return { writeId: 'write-2', chunkSize: 10 }; },
			async writeChunk() { return { nextOffset: 9 }; },
			async finishWrite() { throw new Error('must not finish'); },
			async abortWrite(writeId) { aborted.push(writeId); },
		},
	});

	await assert.rejects(() => service.saveFile({
		purpose: 'labels',
		suggestedName: 'labels.vtt',
		text: 'WEBVTT\n',
		mimeType: 'text/vtt',
	}), /lost synchronization/);
	assert.deepEqual(aborted, ['write-2']);
});

test('desktop file service aborts an in-flight save when its signal is cancelled', async () => {
	const controller = new AbortController();
	const writes = [];
	const aborted = [];
	let finishCalls = 0;
	const service = createAudioEditorFileService({
		bridge: {
			async chooseSaveTarget() { return { id: 'target-abort', name: 'cancel.scape' }; },
			async beginWrite() { return { writeId: 'write-abort', chunkSize: 10 }; },
			async writeChunk(request) {
				writes.push(request.offset);
				controller.abort(new DOMException('cancel save', 'AbortError'));
				return { nextOffset: request.offset + request.bytes.byteLength };
			},
			async finishWrite() { finishCalls += 1; return { byteLength: 4 }; },
			async abortWrite(writeId) { aborted.push(writeId); },
		},
	});

	await assert.rejects(() => service.saveFile({
		purpose: 'project',
		suggestedName: 'cancel.scape',
		blob: new Blob(['data']),
		signal: controller.signal,
	}), (error) => error instanceof Error && error.name === 'AbortError');
	assert.deepEqual(writes, [0]);
	assert.deepEqual(aborted, ['write-abort']);
	assert.equal(finishCalls, 0);
});

test('desktop file service exposes a bounded direct-save stream with acknowledged backpressure', async () => {
	const calls = [];
	const service = createAudioEditorFileService({
		bridge: {
			async chooseSaveTarget(request) {
				calls.push(['choose', request]);
				return { id: 'target-stream', name: 'session.scape' };
			},
			async beginWrite(request) {
				calls.push(['begin', request]);
				return { writeId: 'write-stream', chunkSize: 3 };
			},
			async writeChunk(request) {
				calls.push(['chunk', request.offset, [...request.bytes]]);
				return { nextOffset: request.offset + request.bytes.byteLength };
			},
			async finishWrite(writeId) {
				calls.push(['finish', writeId]);
				return { byteLength: 5 };
			},
			async abortWrite(writeId) { calls.push(['abort', writeId]); },
		},
	});
	const prepared = await service.prepareSave({
		purpose: 'project',
		suggestedName: 'session.scape',
		mimeType: 'application/vnd.soundscaper.scape+zip',
	});
	assert.equal(prepared.mode, 'stream');
	const writable = await prepared.createWritable(99);
	const writer = writable.getWriter();
	await writer.write(Uint8Array.of(1, 2, 3, 4, 5));
	await writer.close();
	assert.equal(prepared.bytesWritten(), 5);
	await prepared.commit();

	assert.deepEqual(prepared.savedFile(), {
		method: 'desktop', fileName: 'session.scape', size: 5,
	});
	assert.deepEqual(calls, [
		['choose', {
			purpose: 'project',
			suggestedName: 'session.scape',
			mimeType: 'application/vnd.soundscaper.scape+zip',
		}],
		['begin', { targetId: 'target-stream', maximumSize: 99 }],
		['chunk', 0, [1, 2, 3]],
		['chunk', 3, [4, 5]],
		['finish', 'write-stream'],
	]);
});

test('browser file service streams to File System Access and retains Blob download fallback', async () => {
	const calls = [];
	const handle = {
		name: 'session.scape',
		async createWritable() {
			calls.push(['open']);
			return {
				async write(bytes) { calls.push(['write', [...bytes]]); },
				async close() { calls.push(['close']); },
				async abort(reason) { calls.push(['abort', reason]); },
			};
		},
	};
	const service = createAudioEditorFileService({
		bridge: null,
		scope: { showSaveFilePicker: async () => handle },
	});
	const prepared = await service.prepareSave({
		purpose: 'project',
		suggestedName: 'session.scape',
		useFileSystemAccess: true,
	});
	assert.equal(prepared.mode, 'stream');
	const writer = (await prepared.createWritable(4)).getWriter();
	await writer.write(Uint8Array.of(1, 2, 3, 4));
	await writer.close();
	assert.equal(prepared.bytesWritten(), 4);
	await prepared.commit();
	assert.deepEqual(prepared.savedFile(), {
		method: 'file-system-access', fileName: 'session.scape', size: 4,
	});
	assert.deepEqual(calls, [['open'], ['write', [1, 2, 3, 4]], ['close']]);

	const fallback = await service.prepareSave({
		purpose: 'project',
		suggestedName: 'fallback.scape',
		useFileSystemAccess: false,
	});
	assert.equal(fallback.mode, 'blob');
	assert.deepEqual(fallback.target, { browserDownload: true, name: 'fallback.scape' });
});

test('direct-save streams abort without publishing when their admitted maximum is exceeded', async () => {
	const aborted = [];
	const service = createAudioEditorFileService({
		bridge: {
			async chooseSaveTarget() { return { id: 'target-limit', name: 'large.scape' }; },
			async beginWrite() { return { writeId: 'write-limit', chunkSize: 10 }; },
			async writeChunk() { throw new Error('must not cross the bridge'); },
			async finishWrite() { throw new Error('must not publish'); },
			async abortWrite(writeId) { aborted.push(writeId); },
		},
	});
	const prepared = await service.prepareSave({ purpose: 'project', suggestedName: 'large.scape' });
	const writer = (await prepared.createWritable(1)).getWriter();
	await assert.rejects(writer.write(Uint8Array.of(1, 2)), /admitted maximum/iu);
	await writer.abort().catch(() => undefined);
	assert.deepEqual(aborted, ['write-limit']);
});

test('desktop read descriptors become named files and are always released', async () => {
	const released = [];
	const service = createAudioEditorFileService({
		bridge: { async releaseRead(id) { released.push(id); } },
		fetch: async () => new Response(
			new Blob(['SQLite format 3'], { type: 'application/x-audacity-project' }),
			{ headers: { 'Content-Length': '15' } },
		),
	});
	const file = await service.openReadDescriptor({
		id: 'read-1',
		readProfile: 'materialized-v1',
		url: 'soundscaper-app://read/read-1',
		name: 'Session.aup4',
		size: 15,
		mimeType: 'application/x-audacity-project',
		lastModified: 123,
	});

	assert.equal(file.name, 'Session.aup4');
	assert.equal(file.lastModified, 123);
	assert.equal(await file.text(), 'SQLite format 3');
	assert.deepEqual(released, ['read-1']);
});

test('desktop reads honor a pre-aborted signal and await exactly-once capability release', async () => {
	const reason = new DOMException('cancel open', 'AbortError');
	const controller = new AbortController();
	controller.abort(reason);
	let fetchCalls = 0;
	let releaseCalls = 0;
	let finishRelease;
	let announceRelease;
	const releaseGate = new Promise((resolve) => { finishRelease = resolve; });
	const releaseStarted = new Promise((resolve) => { announceRelease = resolve; });
	const service = createAudioEditorFileService({
		bridge: {
			async releaseRead() {
				releaseCalls += 1;
				announceRelease();
				await releaseGate;
			},
		},
		fetch: async () => {
			fetchCalls += 1;
			throw new Error('must not fetch');
		},
	});
	const operation = service.openReadDescriptor({
		id: 'read-abort', readProfile: 'materialized-v1', url: 'soundscaper-app://read/read-abort', name: 'cancel.wav', size: 4,
	}, { signal: controller.signal });
	await releaseStarted;
	assert.equal(releaseCalls, 1);
	assert.equal(fetchCalls, 0);
	let settled = false;
	void operation.finally(() => { settled = true; }).catch(() => undefined);
	await Promise.resolve();
	assert.equal(settled, false);
	finishRelease();
	await assert.rejects(operation, (error) => error === reason);
	assert.equal(releaseCalls, 1);
});

test('desktop reads promptly abort a stalled body, cancel its reader, and release its capability', async () => {
	const controller = new AbortController();
	const reason = new DOMException('cancel stalled open', 'AbortError');
	let startRead;
	const readStarted = new Promise((resolve) => { startRead = resolve; });
	const cancelled = [];
	const released = [];
	const reader = {
		read() {
			startRead();
			return new Promise(() => undefined);
		},
		cancel(cancelReason) {
			cancelled.push(cancelReason);
			return new Promise(() => undefined);
		},
	};
	const service = createAudioEditorFileService({
		bridge: { async releaseRead(id) { released.push(id); } },
		fetch: async (_url, init) => {
			assert.equal(init.signal, controller.signal);
			return {
				ok: true,
				status: 200,
				headers: new Headers({ 'Content-Length': '1' }),
				body: { getReader: () => reader },
			};
		},
	});
	const operation = service.openReadDescriptor({
		id: 'read-stalled', readProfile: 'materialized-v1', url: 'soundscaper-app://read/read-stalled', name: 'stalled.wav', size: 1,
	}, { signal: controller.signal });
	await readStarted;
	controller.abort(reason);
	const timeout = Symbol('timeout');
	const outcome = await Promise.race([
		operation.then(() => undefined, (error) => error),
		delay(250, timeout, { ref: false }),
	]);
	assert.notEqual(outcome, timeout, 'service abort must not await a stalled reader cancellation');
	assert.equal(outcome, reason);
	assert.deepEqual(cancelled, [reason]);
	assert.deepEqual(released, ['read-stalled']);
});

test('desktop read failures preserve primary and cleanup errors', async () => {
	const service = createAudioEditorFileService({
		bridge: { async releaseRead() { throw new Error('release failed'); } },
		fetch: async () => new Response('denied', { status: 500 }),
	});
	await assert.rejects(() => service.openReadDescriptor({
		id: 'read-failed', readProfile: 'materialized-v1', url: 'soundscaper-app://read/read-failed', name: 'failed.wav', size: 6,
	}), (error) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.errors[0].message, /status 500/u);
		assert.match(error.errors[1].message, /release failed/u);
		assert.equal(error.cause, error.errors[0]);
		return true;
	});
});

test('scoped desktop reads retain capabilities through consumption and release every descriptor', async () => {
	const released = [];
	const descriptors = [
		{ id: 'read-a', readProfile: 'materialized-v1', url: 'soundscaper-app://read/read-a', name: 'a.wav', size: 1 },
		{ id: 'read-b', readProfile: 'materialized-v1', url: 'soundscaper-app://read/read-b', name: 'b.wav', size: 1 },
	];
	const service = createAudioEditorFileService({
		bridge: { async releaseRead(id) { released.push(id); } },
		fetch: async (url) => new Response(url.endsWith('a') ? 'a' : 'b', {
			headers: { 'Content-Length': '1' },
		}),
	});
	const result = await service.withReadDescriptors(descriptors, {}, async (files) => {
		assert.deepEqual(released, []);
		assert.deepEqual(await Promise.all(files.map((file) => file.text())), ['a', 'b']);
		return 'consumed';
	});
	assert.equal(result, 'consumed');
	assert.deepEqual(released, ['read-a', 'read-b']);
});

test('scoped desktop reads reject aggregate excess before fetching and release unopened descriptors', async () => {
	const released = [];
	let fetchCalls = 0;
	let consumed = false;
	const descriptors = [
		{ id: 'read-c', readProfile: 'materialized-v1', url: 'soundscaper-app://read/read-c', name: 'c.wav', size: 2 },
		{ id: 'read-d', readProfile: 'materialized-v1', url: 'soundscaper-app://read/read-d', name: 'd.wav', size: 2 },
	];
	const service = createAudioEditorFileService({
		bridge: { async releaseRead(id) { released.push(id); } },
		readMaximumBytes: 3,
		fetch: async () => {
			fetchCalls += 1;
			throw new Error('must not fetch');
		},
	});
	await assert.rejects(() => service.withReadDescriptors(descriptors, {}, async () => {
		consumed = true;
	}), /aggregate.*maximum|maximum.*aggregate/iu);
	assert.equal(fetchCalls, 0);
	assert.equal(consumed, false);
	assert.deepEqual(released, ['read-c', 'read-d']);
});

test('desktop file-service read ceilings are lower-only numeric test seams', () => {
	assert.throws(
		() => createAudioEditorFileService({ bridge: {}, readMaximumBytes: '3' }),
		/hard limit/iu,
	);
	assert.throws(
		() => createAudioEditorFileService({ bridge: {}, readMaximumBytes: 512 * 1024 ** 2 + 1 }),
		/hard limit/iu,
	);
});

test('scoped desktop read failure releases current and unattempted capabilities with all-settled cleanup', async () => {
	const released = [];
	const fetched = [];
	const descriptors = [
		{ id: 'read-e', readProfile: 'materialized-v1', url: 'soundscaper-app://read/read-e', name: 'e.wav', size: 1 },
		{ id: 'read-f', readProfile: 'materialized-v1', url: 'soundscaper-app://read/read-f', name: 'f.wav', size: 1 },
		{ id: 'read-g', readProfile: 'materialized-v1', url: 'soundscaper-app://read/read-g', name: 'g.wav', size: 1 },
	];
	const service = createAudioEditorFileService({
		bridge: {
			async releaseRead(id) {
				released.push(id);
				if (id === 'read-f') throw new Error('cleanup f');
			},
		},
		fetch: async (url) => {
			fetched.push(url);
			if (url.endsWith('f')) return new Response('failed', { status: 500 });
			return new Response('e', { headers: { 'Content-Length': '1' } });
		},
	});
	await assert.rejects(() => service.withReadDescriptors(descriptors, {}, async () => undefined), (error) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.errors[0].message, /status 500/u);
		assert.match(error.errors[1].message, /cleanup f/u);
		return true;
	});
	assert.deepEqual(fetched, descriptors.slice(0, 2).map(({ url }) => url));
	assert.deepEqual(released, ['read-e', 'read-f', 'read-g']);
});

test('browser file service preserves anchor-download behavior', async () => {
	const anchors = [];
	const revoked = [];
	const service = createAudioEditorFileService({
		bridge: null,
		document: {
			body: { append(anchor) { anchors.push(anchor); } },
			createElement() {
				return { click() { this.clicked = true; }, remove() { this.removed = true; } };
			},
		},
		urlApi: {
			createObjectURL: () => 'blob:download',
			revokeObjectURL: (url) => revoked.push(url),
		},
		setTimeout: (callback) => callback(),
	});
	const result = await service.saveFile({ purpose: 'preset', suggestedName: 'voice.json', text: '{}' });

	assert.deepEqual(result, { method: 'download', fileName: 'voice.json', size: 2 });
	assert.equal(anchors[0].href, 'blob:download');
	assert.equal(anchors[0].download, 'voice.json');
	assert.equal(anchors[0].clicked, true);
	assert.equal(anchors[0].removed, true);
	assert.deepEqual(revoked, ['blob:download']);
});
