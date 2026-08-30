#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Target-native SDF1 write, patched-seal, no-clobber publication, and durability canary. */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { resolveSoundscaperNativeTestRuntime } from './lib/soundscaper-native-test-runtime.mjs';

async function main() {
	const [helperValue, target] = process.argv.slice(2);
	if (process.argv.length !== 4 || !helperValue) {
		throw new TypeError('Usage: self-test-soundscaper-delivery-fs.mjs <target helper> <target>.');
	}
	resolveSoundscaperNativeTestRuntime({
		requestedTarget: target, platform: process.platform, architecture: process.arch,
	});
	const helper = resolve(helperValue);
	if (basename(helper) !== `soundscaper_delivery_fs${process.platform === 'win32' ? '.exe' : ''}`) {
		throw new TypeError('The SDF1 self-test requires the canonical installed helper name.');
	}
	const temporary = await mkdtemp(join(tmpdir(), 'soundscaper-delivery-fs-self-test-'));
	try {
		const root = await mkdtemp(join(temporary, 'root-'));
		const details = await stat(root, { bigint: true });
		const volumeIdentity = `device:${details.dev.toString(16)}`;
		const peer = new Peer(helper);
		const initial = Buffer.concat([Buffer.alloc(32), Buffer.from('target-native delivery self-test')]);
		const prefix = Buffer.from('0123456789abcdef0123456789abcdef');
		const expected = Buffer.concat([prefix, initial.subarray(32)]);
		const ready = await peer.request(0x01, {
			schemaVersion: 1, sessionId: '10'.repeat(24), rootPath: root, finalName: 'self-test.wav',
			expectedRootIdentity: {
				volumeIdentity, directoryIdentity: `${volumeIdentity}:inode:${details.ino.toString(16)}`,
			},
			limits: { maxBytes: expected.byteLength, maxChunkBytes: 1024, finalPrefixByteLength: 32 },
		}, 0x81);
		assert(ready.sessionId === '10'.repeat(24) && ready.fileIdentity?.volumeIdentity === volumeIdentity,
			'The SDF1 READY authority changed.');
		await peer.request(0x02, initial, 0x82);
		await peer.request(0x06, prefix, 0x82);
		const sealed = await peer.request(0x03, { byteLength: expected.byteLength }, 0x83);
		const digest = createHash('sha256').update(expected).digest('hex');
		assert(sealed.byteLength === expected.byteLength && sealed.sha256 === digest,
			'The SDF1 helper sealed different final bytes.');
		const published = await peer.request(0x04, { journalId: '20'.repeat(24) }, 0x84);
		assert(published.sha256 === digest && published.journalId === '20'.repeat(24)
			&& published.finalIdentity?.fileIdentity === sealed.fileIdentity?.fileIdentity,
		'The SDF1 helper published a different journal artifact.');
		await peer.close();
		assert((await readFile(join(root, 'self-test.wav'))).equals(expected),
			'The target-native published bytes changed.');
		assert(JSON.stringify(await readdir(root)) === JSON.stringify(['self-test.wav']),
			'The target-native helper left a staging name in the destination.');
		process.stdout.write(`${JSON.stringify({
			schemaVersion: 1, status: 'passed', target, protocol: 'SDF1',
			byteLength: expected.byteLength, sha256: digest,
			publication: 'handle-anchored-no-clobber', recoveryReference: 'opaque',
		})}\n`);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

class Peer {
	#child;
	#reader;
	#requestId = 0;

	constructor(executable) {
		this.#child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
		this.#reader = new Reader(this.#child.stdout);
	}

	async request(operation, value, expectedOperation) {
		const payload = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
		const header = Buffer.alloc(16);
		header.write('SDF1'); header[4] = 1; header[5] = operation;
		header.writeUInt32BE(++this.#requestId, 8);
		header.writeUInt32BE(payload.byteLength, 12);
		await write(this.#child.stdin, Buffer.concat([header, payload]));
		const response = await this.#reader.read();
		assert(response.requestId === this.#requestId, 'The SDF1 response lost synchronization.');
		const decoded = response.payload.byteLength === 0 ? {} : JSON.parse(response.payload.toString('utf8'));
		if (response.operation === 0xff) throw new Error(`SDF1 ${decoded.code}: ${decoded.detail}`);
		assert(response.operation === expectedOperation, 'The SDF1 helper returned the wrong opcode.');
		return decoded;
	}

	async close() {
		this.#child.stdin.end();
		const status = await new Promise((resolveExit, reject) => {
			this.#child.once('error', reject);
			this.#child.once('exit', resolveExit);
		});
		assert(status === 0, 'The SDF1 helper did not exit cleanly after publication.');
	}
}

class Reader {
	#iterator;
	#buffer = Buffer.alloc(0);

	constructor(stream) { this.#iterator = stream[Symbol.asyncIterator](); }

	async read() {
		await this.#fill(16);
		const header = this.#buffer.subarray(0, 16);
		assert(header.subarray(0, 4).toString() === 'SDF1' && header[4] === 1
			&& header[6] === 0 && header[7] === 0, 'The SDF1 response header is malformed.');
		const length = header.readUInt32BE(12);
		assert(length <= 64 * 1024, 'The SDF1 response exceeded its bound.');
		await this.#fill(16 + length);
		const output = {
			operation: header[5], requestId: header.readUInt32BE(8),
			payload: Buffer.from(this.#buffer.subarray(16, 16 + length)),
		};
		this.#buffer = this.#buffer.subarray(16 + length);
		return output;
	}

	async #fill(length) {
		while (this.#buffer.byteLength < length) {
			const next = await this.#iterator.next();
			assert(!next.done, 'The SDF1 helper closed before its response.');
			this.#buffer = Buffer.concat([this.#buffer, Buffer.from(next.value)]);
		}
	}
}

function write(stream, value) {
	return new Promise((resolveWrite, reject) => {
		stream.write(value, (error) => error ? reject(error) : resolveWrite());
	});
}

function assert(condition, message) { if (!condition) throw new Error(message); }

await main();
