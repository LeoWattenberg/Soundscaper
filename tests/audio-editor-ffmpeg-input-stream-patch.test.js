/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const packageRoot = resolve('node_modules/@ffmpeg/ffmpeg/dist/esm');
const patchPath = resolve('patches/npm/@ffmpeg+ffmpeg+0.12.15.patch');
const HEADER_INTS = 8;
const STATE = 0;
const READ_INDEX = 1;
const WRITE_INDEX = 2;
const USED_BYTES = 3;
const EPOCH = 4;
const CLOSED = 1;
const ABORTED = 2;

test('the patched FFmpeg class exposes a bounded backpressured input stream', async () => {
	const [patch, declarations] = await Promise.all([
		readFile(patchPath, 'utf8'),
		readFile(resolve(packageRoot, 'classes.d.ts'), 'utf8'),
	]);
	assert.match(patch, /FFMessageType\.CREATE_INPUT_STREAM/u);
	assert.match(patch, /SharedArrayBuffer/u);
	assert.match(patch, /Atomics\.wait\(/u);
	assert.match(patch, /FS\.registerDevice/u);
	assert.match(declarations, /createInputStream: .*Promise<FFmpegInputStream>/u);
	const originalWorker = globalThis.Worker;
	const workers = [];
	class FakeWorker {
		onmessage = null;
		messages = [];
		held = [];
		terminated = false;
		constructor() { workers.push(this); }
		postMessage(message) {
			this.messages.push(message);
			if (message.type === 'CREATE_INPUT_STREAM' && message.data.path === '/held.rgba') {
				this.held.push(message);
				return;
			}
			this.respond(message);
		}
		respond(message) {
			queueMicrotask(() => this.onmessage?.({
				data: message.type === 'CREATE_INPUT_STREAM' && message.data.path === '/duplicate.rgba'
					? { id: message.id, type: 'ERROR', data: new Error('duplicate fixture') }
					: { id: message.id, type: message.type, data: true },
			}));
		}
		releaseHeld() {
			for (const message of this.held.splice(0)) this.respond(message);
		}
		terminate() { this.terminated = true; }
	}
	globalThis.Worker = FakeWorker;
	try {
		const [{ FFmpeg }, { FFMessageType }] = await Promise.all([
			import(`${pathToFileURL(resolve(packageRoot, 'index.js')).href}?stream=${Date.now()}`),
			import(`${pathToFileURL(resolve(packageRoot, 'const.js')).href}?stream=${Date.now()}`),
		]);
		const ffmpeg = new FFmpeg();
		await ffmpeg.load({ classWorkerURL: 'fixture-worker.js' });
		assert.equal(FFMessageType.CREATE_INPUT_STREAM, 'CREATE_INPUT_STREAM');
		assert.equal(FFMessageType.DELETE_INPUT_STREAM, 'DELETE_INPUT_STREAM');
		await assert.rejects(ffmpeg.createInputStream('../bad', 4096), /canonical absolute path/u);
		await assert.rejects(ffmpeg.createInputStream('/too-small', 4095), /4096 through 8388608/u);

		const stream = await ffmpeg.createInputStream('/frames.rgba', 4096);
		const createMessage = workers[0].messages.find(({ type }) => type === 'CREATE_INPUT_STREAM');
		assert.ok(createMessage.data.buffer instanceof SharedArrayBuffer);
		assert.equal(createMessage.data.buffer.byteLength, (HEADER_INTS * 4) + 4096);
		const control = new Int32Array(createMessage.data.buffer, 0, HEADER_INTS);
		const bytes = new Uint8Array(createMessage.data.buffer, HEADER_INTS * 4, 4096);
		const source = Uint8Array.from({ length: 4096 }, (_, index) => index % 251);
		const expected = source.slice();
		await assert.rejects(stream.write(new Uint8Array(4097)), /bounded stream capacity/u);
		await stream.write(source);
		source.fill(255);
		await eventually(() => Atomics.load(control, USED_BYTES) === 4096);
		assert.deepEqual([...bytes.slice(0, 16)], [...expected.slice(0, 16)]);
		const tail = stream.write(Uint8Array.of(1, 2, 3));
		await assert.rejects(stream.write(Uint8Array.of(4)), /active write/u);
		Atomics.store(control, READ_INDEX, 0);
		Atomics.store(control, USED_BYTES, 0);
		Atomics.add(control, EPOCH, 1);
		Atomics.notify(control, EPOCH);
		await tail;
		assert.equal(Atomics.load(control, USED_BYTES), 3);
		assert.equal(Atomics.load(control, WRITE_INDEX), 3);
		assert.deepEqual([...bytes.slice(0, 3)], [1, 2, 3]);
		await stream.close();
		assert.equal(Atomics.load(control, STATE), CLOSED);
		await assert.rejects(stream.write(Uint8Array.of(1)), /closed/u);
		await stream.dispose();
		assert.equal(workers[0].messages.at(-1).type, 'DELETE_INPUT_STREAM');

		const preAborted = new AbortController();
		preAborted.abort(new DOMException('pre-aborted fixture', 'AbortError'));
		const messagesBeforePreAbort = workers[0].messages.length;
		await assert.rejects(
			ffmpeg.createInputStream('/pre-aborted.rgba', 4096, { signal: preAborted.signal }),
			/pre-aborted fixture/u,
		);
		assert.equal(workers[0].messages.length, messagesBeforePreAbort);

		const creationAbort = new AbortController();
		const orphan = ffmpeg.createInputStream('/orphan.rgba', 4096, {
			signal: creationAbort.signal,
		});
		creationAbort.abort(new DOMException('creation aborted fixture', 'AbortError'));
		await assert.rejects(orphan, /creation aborted fixture/u);
		assert.ok(workers[0].messages.some(({ type, data }) => (
			type === 'DELETE_INPUT_STREAM' && data.path === '/orphan.rgba'
		)));
		const heldAbort = new AbortController();
		const held = ffmpeg.createInputStream('/held.rgba', 4096, { signal: heldAbort.signal });
		heldAbort.abort(new DOMException('held creation aborted fixture', 'AbortError'));
		await assert.rejects(
			Promise.race([
				held,
				new Promise((_, reject) => setTimeout(
					() => reject(new Error('held creation did not cancel promptly')),
					25,
				)),
			]),
			/held creation aborted fixture/u,
		);
		workers[0].releaseHeld();
		await eventually(() => workers[0].messages.some(({ type, data }) => (
			type === 'DELETE_INPUT_STREAM' && data.path === '/held.rgba'
		)));

		const messagesBeforeDuplicate = workers[0].messages.length;
		await assert.rejects(ffmpeg.createInputStream('/duplicate.rgba', 4096), /duplicate fixture/u);
		assert.equal(
			workers[0].messages.slice(messagesBeforeDuplicate)
				.some(({ type }) => type === 'DELETE_INPUT_STREAM'),
			false,
			'a rejected worker create must not delete another stream at the same path',
		);

		const aborted = await ffmpeg.createInputStream('/abort.rgba', 4096);
		const abortedCreate = workers[0].messages.find(({ type, data }) => (
			type === 'CREATE_INPUT_STREAM' && data.path === '/abort.rgba'
		));
		const abortedControl = new Int32Array(abortedCreate.data.buffer, 0, HEADER_INTS);
		await aborted.write(new Uint8Array(4094));
		const writeAbort = new AbortController();
		const partialWrite = aborted.write(Uint8Array.of(1, 2, 3, 4), {
			signal: writeAbort.signal,
		});
		await eventually(() => Atomics.load(abortedControl, USED_BYTES) === 4096);
		writeAbort.abort(new DOMException('write aborted fixture', 'AbortError'));
		await assert.rejects(partialWrite, /write aborted fixture/u);
		assert.equal(Atomics.load(abortedControl, STATE), ABORTED);
		await assert.rejects(aborted.close(), /write aborted fixture/u);
		await aborted.dispose();

		const reserved = await Promise.all(Array.from({ length: 8 }, (_, index) => (
			ffmpeg.createInputStream(`/reserved-${index}.rgba`, 4096)
		)));
		await assert.rejects(
			ffmpeg.createInputStream('/reserved-overflow.rgba', 4096),
			/bounded per-instance reservation/u,
		);
		await Promise.all(reserved.map((entry) => entry.dispose()));

		const stale = await ffmpeg.createInputStream('/same-generation.rgba', 4096);
		ffmpeg.terminate();
		assert.equal(workers[0].terminated, true);
		await ffmpeg.load({ classWorkerURL: 'fixture-worker.js' });
		const fresh = await ffmpeg.createInputStream('/same-generation.rgba', 4096);
		const generationPeers = await Promise.all(Array.from({ length: 7 }, (_, index) => (
			ffmpeg.createInputStream(`/generation-${index}.rgba`, 4096)
		)));
		await assert.rejects(
			ffmpeg.createInputStream('/generation-overflow.rgba', 4096),
			/bounded per-instance reservation/u,
		);
		await stale.dispose();
		assert.equal(
			workers[1].messages.some(({ type, data }) => (
				type === 'DELETE_INPUT_STREAM' && data.path === '/same-generation.rgba'
			)),
			false,
			'a stale generation must not delete a new worker device',
		);
		await assert.rejects(
			ffmpeg.createInputStream('/generation-still-bounded.rgba', 4096),
			/bounded per-instance reservation/u,
		);
		await generationPeers[0].dispose();
		const replacement = await ffmpeg.createInputStream('/generation-replacement.rgba', 4096);
		await Promise.all([fresh, ...generationPeers.slice(1), replacement].map((entry) => entry.dispose()));
		ffmpeg.terminate();
		assert.equal(workers[1].terminated, true);
	} finally {
		if (originalWorker === undefined) delete globalThis.Worker;
		else globalThis.Worker = originalWorker;
	}
});

test('the patched worker exposes the ring as a fail-closed character device', async () => {
	const fixture = await loadWorkerFixture();
	try {
		await fixture.send('LOAD', {});
		const capacityBytes = 4096;
		const buffer = new SharedArrayBuffer((HEADER_INTS * 4) + capacityBytes);
		const control = new Int32Array(buffer, 0, HEADER_INTS);
		const bytes = new Uint8Array(buffer, HEADER_INTS * 4, capacityBytes);
		const created = await fixture.send('CREATE_INPUT_STREAM', {
			path: '/frames.rgba', buffer, capacityBytes,
		});
		assert.equal(created.data, true);
		const operations = fixture.fs.registeredOperations();
		const stream = { seekable: true };
		operations.open(stream);
		assert.equal(stream.seekable, false);

		bytes.set([7, 8], capacityBytes - 2);
		bytes.set([9, 10], 0);
		Atomics.store(control, READ_INDEX, capacityBytes - 2);
		Atomics.store(control, WRITE_INDEX, 2);
		Atomics.store(control, USED_BYTES, 4);
		Atomics.store(control, STATE, CLOSED);
		const output = new Uint8Array(4);
		assert.equal(operations.read(stream, output, 0, 4), 4);
		assert.deepEqual([...output], [7, 8, 9, 10]);
		assert.equal(operations.read(stream, output, 0, 4), 0, 'closed and drained is EOF');

		const deleted = await fixture.send('DELETE_INPUT_STREAM', { path: '/frames.rgba' });
		assert.equal(deleted.data, true);
		assert.deepEqual(fixture.fs.calls.slice(-2), ['unlink:/frames.rgba', 'deleteDevice:20481']);

		const abortedBuffer = new SharedArrayBuffer((HEADER_INTS * 4) + capacityBytes);
		await fixture.send('CREATE_INPUT_STREAM', {
			path: '/aborted.rgba', buffer: abortedBuffer, capacityBytes,
		});
		const abortedControl = new Int32Array(abortedBuffer, 0, HEADER_INTS);
		Atomics.store(abortedControl, STATE, ABORTED);
		assert.throws(
			() => fixture.fs.registeredOperations().read({}, new Uint8Array(1), 0, 1),
			(error) => error?.errno === 29,
		);
		await fixture.send('DELETE_INPUT_STREAM', { path: '/aborted.rgba' });

		const protectedBuffer = new SharedArrayBuffer((HEADER_INTS * 4) + capacityBytes);
		await fixture.send('CREATE_INPUT_STREAM', {
			path: '/protected.rgba', buffer: protectedBuffer, capacityBytes,
		});
		for (const [type, data] of [
			['WRITE_FILE', { path: '/protected.rgba', data: Uint8Array.of(1) }],
			['READ_FILE', { path: '/protected.rgba', encoding: 'binary' }],
			['DELETE_FILE', { path: '/protected.rgba' }],
			['RENAME', { oldPath: '/protected.rgba', newPath: '/moved.rgba' }],
			['RENAME', { oldPath: '/regular.rgba', newPath: '/protected.rgba' }],
			['DELETE_DIR', { path: '/' }],
			['MOUNT', { fsType: 'MEMFS', options: {}, mountPoint: '/' }],
			['UNMOUNT', { mountPoint: '/' }],
		]) {
			const response = await fixture.send(type, data);
			assert.equal(response.type, 'ERROR');
			assert.match(response.data, /reserved from regular file APIs/u);
		}
		const protectedControl = new Int32Array(protectedBuffer, 0, HEADER_INTS);
		Atomics.store(protectedControl, STATE, ABORTED);
		await fixture.send('DELETE_INPUT_STREAM', { path: '/protected.rgba' });
	} finally {
		fixture.restore();
	}
});

async function eventually(predicate) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolveAttempt) => setImmediate(resolveAttempt));
	}
	throw new Error('Timed out waiting for input-stream state.');
}

async function loadWorkerFixture() {
	const originalSelf = globalThis.self;
	const originalImportScripts = globalThis.importScripts;
	const waiters = new Map();
	const fs = createFakeFs();
	const workerScope = {
		createFFmpegCore: async () => ({
			FS: fs,
			setLogger() {},
			setProgress() {},
		}),
		postMessage(message, transfer = []) {
			const response = { ...message, transfer };
			waiters.get(message.id)?.(response);
			waiters.delete(message.id);
		},
	};
	globalThis.self = workerScope;
	globalThis.importScripts = () => undefined;
	await import(`${pathToFileURL(resolve(packageRoot, 'worker.js')).href}?stream-worker=${Date.now()}-${Math.random()}`);
	let nextId = 1;
	return {
		fs,
		async send(type, data) {
			const id = nextId;
			nextId += 1;
			const response = new Promise((resolveResponse) => { waiters.set(id, resolveResponse); });
			await workerScope.onmessage({ data: { id, type, data } });
			return response;
		},
		restore() {
			if (originalSelf === undefined) delete globalThis.self;
			else globalThis.self = originalSelf;
			if (originalImportScripts === undefined) delete globalThis.importScripts;
			else globalThis.importScripts = originalImportScripts;
			assert.equal(waiters.size, 0);
		},
	};
}

function createFakeFs() {
	const calls = [];
	const devices = new Proxy({}, {
		deleteProperty(target, property) {
			calls.push(`deleteDevice:${String(property)}`);
			return Reflect.deleteProperty(target, property);
		},
	});
	const nodes = new Map();
	let latestDevice = null;
	class ErrnoError extends Error { constructor(errno) { super(`errno ${errno}`); this.errno = errno; } }
	return {
		calls,
		devices,
		ErrnoError,
		makedev(major, minor) { return (major << 8) | minor; },
		getDevice(device) { return devices[device]; },
		registerDevice(device, operations) {
			devices[device] = { stream_ops: operations };
			latestDevice = device;
		},
		analyzePath(path) { return { exists: nodes.has(path), object: nodes.get(path) }; },
		mkdev(path, mode, device) { nodes.set(path, { mode, rdev: device }); },
		writeFile(path) { nodes.set(path, { mode: 32_768, rdev: 0 }); },
		rename(oldPath, newPath) {
			nodes.set(newPath, nodes.get(oldPath));
			nodes.delete(oldPath);
		},
		unlink(path) {
			this.calls.push(`unlink:${path}`);
			nodes.delete(path);
		},
		registeredOperations() { return devices[latestDevice].stream_ops; },
	};
}
