/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createTauriPrototypeBridge,
	installTauriPrototypeBridge,
	PROTOTYPE_READ_CHUNK_BYTES,
	PROTOTYPE_WRITE_CHUNK_BYTES,
} from '../prototypes/tauri/bridge.mjs';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createDesktopPreparedSave } from '../src/common/editor/file-save-stream.ts';
import type { ScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';

type Arguments = Record<string, unknown>;
type Call = Readonly<{ command: string; arguments: Arguments }>;
type Invoke = (command: string, arguments_?: Arguments) => Promise<unknown>;

function fixture(options: Readonly<{
	size?: number;
	profile?: string;
	read?: (offset: number, length: number) => Promise<unknown>;
}> = {}) {
	const calls: Call[] = [];
	const size = options.size ?? PROTOTYPE_READ_CHUNK_BYTES + 3;
	const descriptor = {
		id: 'read-123', name: options.profile === 'scape-range-v1' ? 'test.scape' : 'test.wav',
		size, mimeType: options.profile === 'scape-range-v1' ? 'application/vnd.soundscaper.scape+zip' : 'audio/wav',
		readProfile: options.profile ?? 'selected-range-v1',
	};
	const invoke: Invoke = async (command, arguments_ = {}) => {
		calls.push({ command, arguments: arguments_ });
		if (command === 'prototype_choose_files') return [descriptor];
		if (command === 'prototype_read_range') {
			const offset = Number(arguments_.offset), length = Number(arguments_.length);
			return options.read ? options.read(offset, length) : new Uint8Array(length).fill(offset % 251).buffer;
		}
		if (command === 'prototype_release_read') return true;
		throw new Error(`Unexpected command ${command}`);
	};
	const runtime = createTauriPrototypeBridge({ invoke, fetch: async () => new Response('ordinary') });
	return { ...runtime, calls, descriptor };
}

test('native imports pull bounded binary ranges and expose exact response headers', async () => {
	const runtime = fixture();
	const [descriptor] = await runtime.bridge.v1.chooseFiles({ purpose: 'audio', multiple: true });
	assert.equal(descriptor.url, 'prototype-read:read-123');
	const response = await runtime.fetch(descriptor.url);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Content-Length'), String(descriptor.size));
	assert.equal(response.headers.get('Content-Type'), 'audio/wav');
	assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
	assert.equal(runtime.calls.length, 1, 'the stream does not prefetch before its consumer reads');
	assert.ok(response.body);
	const reader = response.body.getReader();
	assert.equal((await reader.read()).value?.byteLength, PROTOTYPE_READ_CHUNK_BYTES);
	assert.equal((await reader.read()).value?.byteLength, 3);
	assert.equal((await reader.read()).done, true);
	assert.deepEqual(runtime.calls.slice(1), [
		{ command: 'prototype_read_range', arguments: { id: descriptor.id, offset: 0, length: PROTOTYPE_READ_CHUNK_BYTES } },
		{ command: 'prototype_read_range', arguments: { id: descriptor.id, offset: PROTOTYPE_READ_CHUNK_BYTES, length: 3 } },
	]);
});

test('range and HEAD requests avoid whole-file reads, including a multi-gigabyte archive', async () => {
	const runtime = fixture({ size: 8 * 1024 ** 3, profile: 'scape-range-v1' });
	const [descriptor] = await runtime.bridge.v1.chooseFiles({ purpose: 'project' });
	const head = await runtime.fetch(descriptor.url, { method: 'HEAD' });
	assert.equal(head.body, null);
	assert.equal(runtime.calls.length, 1);
	const offset = descriptor.size - 3;
	const response = await runtime.fetch(new Request(descriptor.url, { headers: { Range: 'bytes=-3' } }));
	assert.equal(response.status, 206);
	assert.equal(response.headers.get('Content-Range'), `bytes ${offset}-${descriptor.size - 1}/${descriptor.size}`);
	assert.equal(response.headers.get('Content-Length'), '3');
	assert.equal((await response.arrayBuffer()).byteLength, 3);
	assert.deepEqual(runtime.calls.at(-1)?.arguments, { id: descriptor.id, offset, length: 3 });
	for (const range of ['bytes=9-1', 'bytes=0-1,4-5', `bytes=${descriptor.size}-`, 'bytes=-0']) {
		const rejected = await runtime.fetch(descriptor.url, { headers: { Range: range } });
		assert.equal(rejected.status, 416);
		assert.equal(rejected.headers.get('Content-Range'), `bytes */${descriptor.size}`);
	}
});

test('abort immediately errors a pending body and prevents further native reads', async () => {
	let resolveRead: (bytes: ArrayBuffer) => void = () => undefined;
	const runtime = fixture({ read: () => new Promise(resolve => { resolveRead = resolve; }) });
	const [descriptor] = await runtime.bridge.v1.chooseFiles({ purpose: 'audio' });
	const abort = new AbortController();
	const response = await runtime.fetch(descriptor.url, { signal: abort.signal });
	assert.ok(response.body);
	const reader = response.body.getReader();
	const read = reader.read();
	await Promise.resolve();
	abort.abort();
	await assert.rejects(read, { name: 'AbortError' });
	resolveRead(new ArrayBuffer(PROTOTYPE_READ_CHUNK_BYTES));
	await Promise.resolve();
	assert.equal(runtime.calls.filter(call => call.command === 'prototype_read_range').length, 1);
	await assert.rejects(runtime.fetch(descriptor.url, { signal: abort.signal }), { name: 'AbortError' });
});

test('cancel, revoked capabilities, malformed descriptors and non-binary or short native results fail closed', async () => {
	const runtime = fixture();
	const [descriptor] = await runtime.bridge.v1.chooseFiles({ purpose: 'audio' });
	const response = await runtime.fetch(descriptor.url);
	await response.body?.cancel();
	assert.equal(runtime.calls.length, 1);
	await runtime.bridge.v1.releaseRead(descriptor.id);
	await assert.rejects(runtime.fetch(descriptor.url), /released|unknown/iu);
	for (const value of [[1, 2], new ArrayBuffer(1)]) {
		const invalid = fixture({ size: 2, read: async () => value });
		const [entry] = await invalid.bridge.v1.chooseFiles({ purpose: 'audio' });
		await assert.rejects((await invalid.fetch(entry.url)).arrayBuffer(), /binary|length|short/iu);
	}
	const invalid = createTauriPrototypeBridge({ invoke: async () => [{ id: 'bad/path', size: -1 }], fetch });
	await assert.rejects(invalid.bridge.v1.chooseFiles({ purpose: 'audio' }), /descriptor|identifier/iu);
});

test('disposing during a native chooser revokes its subsequently returned capabilities', async () => {
	let resolveChoice: (value: unknown) => void = () => undefined;
	const calls: Call[] = [];
	const runtime = createTauriPrototypeBridge({ fetch, invoke: async (command: string, arguments_: Arguments = {}) => {
		calls.push({ command, arguments: arguments_ });
		if (command === 'prototype_choose_files') return new Promise(resolve => { resolveChoice = resolve; });
		if (command === 'prototype_release_read') return true;
		throw new Error(`Unexpected ${command}`);
	} });
	const choice = runtime.bridge.v1.chooseFiles({ purpose: 'audio' });
	await runtime.dispose();
	resolveChoice([{ id: 'late-read', name: 'late.wav', size: 2, mimeType: 'audio/wav', readProfile: 'materialized-v1' }]);
	await assert.rejects(choice, /disposed/iu);
	assert.deepEqual(calls.at(-1), { command: 'prototype_release_read', arguments: { id: 'late-read' } });
});

test('a malformed chooser batch revokes every recoverable native capability', async () => {
	const released: unknown[] = [];
	const runtime = createTauriPrototypeBridge({ fetch, invoke: async (command: string, arguments_: Arguments = {}) => {
		if (command === 'prototype_choose_files') return [
			{ id: 'valid-read', name: 'valid.wav', size: 2, mimeType: 'audio/wav', readProfile: 'materialized-v1' },
			{ id: 'invalid-read', name: '', size: 2, mimeType: 'audio/wav', readProfile: 'materialized-v1' },
		];
		if (command === 'prototype_release_read') { released.push(arguments_.id); return true; }
		throw new Error(`Unexpected ${command}`);
	} });
	await assert.rejects(runtime.bridge.v1.chooseFiles({ purpose: 'audio' }), /native text/iu);
	assert.deepEqual(released, ['valid-read', 'invalid-read']);
	await assert.rejects(runtime.fetch('prototype-read:valid-read'), /unknown/iu);
});

test('disposing during a native save chooser revokes its late destination capability', async () => {
	let resolveChoice: (value: unknown) => void = () => undefined;
	const calls: Call[] = [];
	const runtime = createTauriPrototypeBridge({ fetch, invoke: async (command: string, arguments_: Arguments = {}) => {
		calls.push({ command, arguments: arguments_ });
		if (command === 'prototype_choose_save_target') return new Promise(resolve => { resolveChoice = resolve; });
		if (command === 'prototype_release_target') return true;
		throw new Error(`Unexpected ${command}`);
	} });
	const choice = runtime.bridge.v1.chooseSaveTarget({ purpose: 'audio', suggestedName: 'late.wav' });
	await runtime.dispose();
	resolveChoice({ id: 'late-target', name: 'late.wav' });
	await assert.rejects(choice, /disposed/iu);
	assert.deepEqual(calls.at(-1), { command: 'prototype_release_target', arguments: { id: 'late-target' } });
});

test('malformed save targets are revoked and unused destinations are released on disposal', async () => {
	const released: unknown[] = [];
	let choice = 0;
	const runtime = createTauriPrototypeBridge({ fetch, invoke: async (command: string, arguments_: Arguments = {}) => {
		if (command === 'prototype_choose_save_target') {
			choice += 1;
			return { id: `target-${choice}`, name: choice === 1 ? '' : 'mix.wav' };
		}
		if (command === 'prototype_release_target') { released.push(arguments_.id); return true; }
		if (command === 'prototype_begin_write') return { writeId: 'write-1', chunkSize: PROTOTYPE_WRITE_CHUNK_BYTES };
		throw new Error(`Unexpected ${command}`);
	} });
	await assert.rejects(runtime.bridge.v1.chooseSaveTarget({ purpose: 'audio' }), /native text/iu);
	const target = await runtime.bridge.v1.chooseSaveTarget({ purpose: 'audio' });
	assert.ok(target);
	await runtime.bridge.v1.beginWrite({ targetId: target.id, size: 0 });
	await runtime.bridge.v1.chooseSaveTarget({ purpose: 'audio' });
	await runtime.dispose();
	assert.deepEqual(released, ['target-1', 'target-3']);
});

test('installation preserves ordinary fetch calls and does not advertise unavailable native services', async () => {
	const originalCalls: unknown[][] = [];
	const originalFetch: typeof fetch = async (...arguments_) => { originalCalls.push(arguments_); return new Response('ok'); };
	const scope = { fetch: originalFetch, __TAURI__: { core: { invoke: async () => ({ host: 'tauri' }) } } };
	const runtime = installTauriPrototypeBridge(scope);
	assert.ok(runtime);
	const request = new Request('https://example.invalid/asset');
	const init = { cache: 'no-cache' as const };
	assert.equal(await (await scope.fetch(request, init)).text(), 'ok');
	assert.equal(originalCalls[0][0], request);
	assert.equal(originalCalls[0][1], init);
	assert.equal(Object.isFrozen(runtime.bridge), true);
	assert.equal(Object.isFrozen(runtime.bridge.v1), true);
	assert.equal('nativePluginAvailability' in runtime.bridge.v1, false);
	assert.equal('getDesktopAudioCodecCapabilities' in runtime.bridge.v1, false);
	assert.equal('soundscaperProjectLibraryDesktop' in scope, false);
	await runtime.dispose();
	assert.equal(scope.fetch, originalFetch);
	assert.equal('scapeDesktop' in scope, false);
});

test('existing file service reads Scape ranges and releases the native capability', async () => {
	const runtime = fixture({ size: 8 * 1024 ** 3, profile: 'scape-range-v1' });
	const service = createAudioEditorFileService({ bridge: runtime.bridge.v1, fetch: runtime.fetch });
	const [descriptor] = await service.chooseFiles({ purpose: 'project' });
	const bytes = await service.withScapeReadDescriptor(descriptor, {}, async (source: ScapeArchiveByteSource) => (
		source.read({ offset: source.size - 2, length: 2 })
	));
	assert.equal(bytes.byteLength, 2);
	assert.equal(runtime.calls.at(-1)?.command, 'prototype_release_read');
	assert.equal(runtime.calls.filter(call => call.command === 'prototype_read_range').length, 1);
});

test('existing file service streams save chunks through the bounded prototype JSON write path', async () => {
	const chunks: number[][] = [];
	let offset = 0;
	const runtime = createTauriPrototypeBridge({ fetch, invoke: async (command: string, arguments_: Arguments = {}) => {
		const request = arguments_.request as Arguments;
		if (command === 'prototype_choose_save_target') return { id: 'target-1', name: 'out.wav' };
		if (command === 'prototype_begin_write') return { writeId: 'write-1', chunkSize: PROTOTYPE_WRITE_CHUNK_BYTES };
		if (command === 'prototype_write_chunk') {
			assert.equal(request.offset, offset);
			assert.ok(Array.isArray(request.bytes));
			chunks.push(request.bytes as number[]);
			offset += request.bytes.length;
			return { nextOffset: offset };
		}
		if (command === 'prototype_finish_write') return { byteLength: offset };
		throw new Error(`Unexpected ${command}`);
	} });
	const service = createAudioEditorFileService({ bridge: runtime.bridge.v1, fetch: runtime.fetch });
	const result = await service.saveFile({ purpose: 'audio', bytes: new Uint8Array(PROTOTYPE_WRITE_CHUNK_BYTES + 7).fill(73), fileName: 'out.wav' });
	assert.ok('method' in result);
	assert.equal(result.method, 'desktop');
	assert.deepEqual(chunks.map(chunk => chunk.length), [PROTOTYPE_WRITE_CHUNK_BYTES, 7]);
	assert.equal(chunks[1][6], 73);
});

test('direct saves preserve the exact-size final-prefix protocol and abort failed appends', async () => {
	const calls: Call[] = [];
	let failWrite = false;
	const runtime = createTauriPrototypeBridge({ fetch, invoke: async (command: string, arguments_: Arguments = {}) => {
		calls.push({ command, arguments: arguments_ });
		if (command === 'prototype_begin_write') return { writeId: 'write-1', chunkSize: PROTOTYPE_WRITE_CHUNK_BYTES };
		if (command === 'prototype_write_chunk') {
			if (failWrite) throw new Error('disk full');
			return { nextOffset: 40 };
		}
		if (command === 'prototype_patch_final_prefix' || command === 'prototype_finish_write') return { byteLength: 40 };
		if (command === 'prototype_abort_write') return true;
		throw new Error(`Unexpected ${command}`);
	} });
	const prepared = createDesktopPreparedSave({ bridge: runtime.bridge.v1, target: { id: 'target-1' }, fileName: 'out.wav' });
	const writer = (await prepared.createWritable(40, 'exact', { finalPrefixByteLength: 32 })).getWriter();
	await writer.write(new Uint8Array(40));
	await writer.close();
	await prepared.patchFinalPrefix(new Uint8Array(32).fill(82));
	assert.equal((await prepared.commit()).size, 40);
	assert.deepEqual(calls[0].arguments, { request: { targetId: 'target-1', size: 40, finalPrefixByteLength: 32 } });
	assert.deepEqual(calls[2].arguments, { request: { writeId: 'write-1', bytes: Array.from(new Uint8Array(32).fill(82)) } });
	failWrite = true;
	const aborted = createDesktopPreparedSave({ bridge: runtime.bridge.v1, target: { id: 'target-2' }, fileName: 'failed.wav' });
	const failedWriter = (await aborted.createWritable(40)).getWriter();
	await assert.rejects(failedWriter.write(new Uint8Array(40)), /disk full/u);
	assert.deepEqual(calls.at(-1), { command: 'prototype_abort_write', arguments: { id: 'write-1' } });
});

test('write declarations and payload sizes are bounded before native invocation', async () => {
	let calls = 0;
	const runtime = createTauriPrototypeBridge({ fetch, invoke: async () => { calls += 1; return {}; } });
	await assert.rejects(runtime.bridge.v1.beginWrite({ targetId: 'target', size: 1, maximumSize: 1 }), /one exact size/u);
	await assert.rejects(runtime.bridge.v1.beginWrite({ targetId: 'target', maximumSize: 40, finalPrefixByteLength: 32 }), /exact-size/u);
	await assert.rejects(runtime.bridge.v1.writeChunk({ writeId: 'write', offset: 0, bytes: new Uint8Array(PROTOTYPE_WRITE_CHUNK_BYTES + 1) }), /128 KiB/u);
	await assert.rejects(runtime.bridge.v1.patchFinalPrefix({ writeId: 'write', bytes: new Uint8Array(31) }), /32 bytes/u);
	assert.equal(calls, 0);
});

test('the existing fullscreen menu reaches the supported native window action', async () => {
	const calls: Call[] = [];
	const runtime = createTauriPrototypeBridge({ fetch, invoke: async (command: string, arguments_: Arguments = {}) => {
		calls.push({ command, arguments: arguments_ });
		return true;
	} });
	const service = createAudioEditorFileService({ bridge: runtime.bridge.v1, fetch: runtime.fetch });
	assert.equal(service.isDesktop, true);
	await service.runWindowAction('toggle-fullscreen');
	assert.deepEqual(calls, [{ command: 'prototype_window_action', arguments: { action: 'toggle-fullscreen' } }]);
	assert.throws(() => service.runWindowAction('unsupported'), /Unsupported prototype window action/u);
	assert.equal(calls.length, 1);
});

test('close handshake awaits event registration, forwards decisions and disposes subscriptions', async () => {
	const calls: string[] = [];
	let listener: (event: Readonly<{ payload: unknown }>) => void = () => undefined;
	let ready: (() => void) | undefined;
	const runtime = createTauriPrototypeBridge({ fetch,
		invoke: async command => { calls.push(command); return true; },
		listen: async (event, callback) => {
			assert.equal(event, 'prototype-close-requested');
			listener = callback;
			await new Promise<void>(resolve => { ready = resolve; });
			return () => { calls.push('unlisten'); };
		},
	});
	const requests: unknown[] = [];
	const unsubscribe = runtime.bridge.v1.onCloseRequested(request => { requests.push(request); });
	const signalled = runtime.bridge.v1.signalReady();
	await Promise.resolve();
	assert.deepEqual(calls, []);
	assert.ok(ready);
	ready();
	await signalled;
	listener({ payload: { requestId: 'close-1' } });
	assert.deepEqual(requests, [{ requestId: 'close-1' }]);
	await runtime.bridge.v1.respondToClose({ requestId: 'close-1', allow: false });
	unsubscribe();
	await runtime.dispose();
	assert.deepEqual(calls, ['prototype_signal_ready', 'prototype_respond_to_close', 'unlisten']);
});
