/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const packageRoot = resolve('node_modules/@ffmpeg/ffmpeg/dist/esm');
const patchPath = resolve('patches/npm/@ffmpeg+ffmpeg+0.12.15.patch');

test('the installed FFmpeg ESM class and declarations expose bounded output ranges', async () => {
	const [{ FFmpeg }, { FFMessageType }, patch, declarations] = await Promise.all([
		import(pathToFileURL(resolve(packageRoot, 'index.js')).href),
		import(pathToFileURL(resolve(packageRoot, 'const.js')).href),
		readFile(patchPath, 'utf8'),
		readFile(resolve(packageRoot, 'classes.d.ts'), 'utf8'),
	]);
	const ffmpeg = new FFmpeg();
	assert.equal(typeof ffmpeg.statFile, 'function');
	assert.equal(typeof ffmpeg.readFileRange, 'function');
	assert.equal(FFMessageType.STAT_FILE, 'STAT_FILE');
	assert.equal(FFMessageType.READ_FILE_RANGE, 'READ_FILE_RANGE');
	await assert.rejects(ffmpeg.readFileRange('output.mp3', -1, 1), /safe non-negative integer/u);
	await assert.rejects(ffmpeg.readFileRange('output.mp3', 0, 0), /positive safe integer/u);
	await assert.rejects(ffmpeg.readFileRange('output.mp3', 0, (1024 * 1024) + 1), /no greater than 1048576/u);
	assert.match(declarations, /statFile: .*Promise<FSFileStat>/u);
	assert.match(declarations, /readFileRange: .*Promise<Uint8Array>/u);
	assert.match(patch, /FFMessageType\.READ_FILE_RANGE/u);
	assert.match(patch, /ffmpeg\.FS\.open\(path, "r"\)/u);
	assert.match(patch, /ffmpeg\.FS\.read\(stream, buffer/u);
	assert.match(patch, /ffmpeg\.FS\.close\(stream\)/u);
});

test('the patched worker stats, validates, and transfers only each returned range', async () => {
	const fixture = await loadWorkerFixture();
	try {
		await fixture.send('LOAD', {});
		const stat = await fixture.send('STAT_FILE', { path: 'output.mp3' });
		assert.deepEqual(stat.data, { size: 5 });
		assert.deepEqual(fixture.fs.calls.splice(0), ['stat:output.mp3', 'isFile:32768']);

		const range = await fixture.send('READ_FILE_RANGE', {
			path: 'output.mp3',
			offset: 1,
			maximumBytes: 3,
		});
		assert.deepEqual([...range.data], [11, 12, 13]);
		assert.equal(range.transfer.length, 1);
		assert.equal(range.transfer[0], range.data.buffer);
		assert.equal(range.transfer[0].byteLength, 3);
		assert.deepEqual(fixture.fs.calls.splice(0), [
			'stat:output.mp3',
			'isFile:32768',
			'open:output.mp3:r',
			'read:0:3:1',
			'close:output.mp3',
		]);
		assert.equal(fixture.fs.readFileCalls, 0);

		fixture.fs.shortReadBy = 1;
		const shortRange = await fixture.send('READ_FILE_RANGE', {
			path: 'output.mp3',
			offset: 0,
			maximumBytes: 3,
		});
		assert.deepEqual([...shortRange.data], [10, 11]);
		assert.equal(shortRange.data.byteLength, 2);
		assert.equal(shortRange.transfer[0].byteLength, 2, 'the worker cannot transfer an unused buffer tail');
		assert.equal(fixture.fs.readFileCalls, 0);

		fixture.fs.shortReadBy = 0;
		fixture.fs.calls.splice(0);
		for (const data of [
			{ path: 'output.mp3', offset: -1, maximumBytes: 1 },
			{ path: 'output.mp3', offset: 0, maximumBytes: 0 },
			{ path: 'output.mp3', offset: 0, maximumBytes: (1024 * 1024) + 1 },
		]) {
			const response = await fixture.send('READ_FILE_RANGE', data);
			assert.equal(response.type, 'ERROR');
		}
		assert.deepEqual(fixture.fs.calls, []);

		fixture.fs.readFailure = new Error('FS read failed');
		const failed = await fixture.send('READ_FILE_RANGE', {
			path: 'output.mp3',
			offset: 0,
			maximumBytes: 1,
		});
		assert.equal(failed.type, 'ERROR');
		assert.match(failed.data, /FS read failed/u);
		assert.equal(fixture.fs.calls.at(-1), 'close:output.mp3');
	} finally {
		fixture.restore();
	}
});

async function loadWorkerFixture() {
	const originalSelf = globalThis.self;
	const originalImportScripts = globalThis.importScripts;
	const messages = [];
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
			messages.push(response);
			waiters.get(message.id)?.(response);
			waiters.delete(message.id);
		},
	};
	globalThis.self = workerScope;
	globalThis.importScripts = () => undefined;
	await import(`${pathToFileURL(resolve(packageRoot, 'worker.js')).href}?fixture=${Date.now()}-${Math.random()}`);
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
			assert.equal(messages.length > 0, true);
		},
	};
}

function createFakeFs() {
	return {
		calls: [],
		readFileCalls: 0,
		shortReadBy: 0,
		readFailure: null,
		stat(path) {
			this.calls.push(`stat:${path}`);
			return { mode: 0x8000, size: 5 };
		},
		isFile(mode) {
			this.calls.push(`isFile:${mode}`);
			return true;
		},
		open(path, mode) {
			this.calls.push(`open:${path}:${mode}`);
			return { path };
		},
		read(stream, buffer, bufferOffset, length, position) {
			this.calls.push(`read:${bufferOffset}:${length}:${position}`);
			if (this.readFailure) throw this.readFailure;
			const bytesRead = length - this.shortReadBy;
			for (let index = 0; index < bytesRead; index += 1) buffer[index] = 10 + position + index;
			return bytesRead;
		},
		close(stream) {
			this.calls.push(`close:${stream.path}`);
		},
		readFile() {
			this.readFileCalls += 1;
			throw new Error('Whole-file reads are forbidden in this fixture.');
		},
	};
}
