/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';

import {
	createSoundscaperDeliveryFilesystemProcessAuthority,
} from '../desktop/soundscaper-delivery-filesystem-process.ts';
import {
	SoundscaperDeliveryFilesystemUnavailableError,
} from '../desktop/soundscaper-delivery-filesystem-authority.ts';

const ROOT = Object.freeze({
	grantId: '1'.repeat(48), rootPath: '/authorized/output',
	volumeIdentity: 'volume-1', directoryIdentity: 'directory-1',
	authorizedAtMs: 1, revokedAtMs: null,
});
const FILE_IDENTITY = Object.freeze({ volumeIdentity: 'volume-1', fileIdentity: 'file-1' });

test('SDF1 retains one native session through patched seal, journaled publication and durability', async () => {
	const helper = new FakeHelper();
	const fences: string[] = [];
	const authority = createSoundscaperDeliveryFilesystemProcessAuthority({
		executablePath: '/installed/soundscaper_delivery_fs', spawnProcess: helper.spawn as never,
	});
	const session = await authority.open({
		root: ROOT, reference: '2'.repeat(48), finalName: 'master.wav',
		maximumBytes: 64, finalPrefixByteLength: 32, fence: (operation) => fences.push(operation),
	});
	const original = new Uint8Array(64).fill(1);
	assert.equal(await session.write(0, original), 64);
	const prefix = new Uint8Array(32).fill(9);
	assert.equal(await session.patch(0, prefix), 32);
	const expected = Buffer.concat([Buffer.from(prefix), Buffer.from(original.subarray(32))]);
	const sealed = await session.seal(64);
	assert.equal(sealed.sha256, createHash('sha256').update(expected).digest('hex'));
	assert.equal(helper.exited, false, 'the exact native handle survives sealing and journal preparation');
	const published = await session.publish('master.wav', '3'.repeat(48));
	assert.deepEqual(published, sealed);
	assert.equal(session.settled, true);
	assert.equal(helper.exited, true);
	assert.deepEqual(helper.opcodes, [0x01, 0x02, 0x06, 0x03, 0x04]);
	assert.deepEqual(fences.slice(-3), ['publication-link', 'publication-retire', 'directory-sync']);
});

test('SDF1 maps unsupported filesystems to typed unavailability and closes the helper', async () => {
	const helper = new FakeHelper('unsupported-filesystem');
	const authority = createSoundscaperDeliveryFilesystemProcessAuthority({
		executablePath: '/installed/soundscaper_delivery_fs', spawnProcess: helper.spawn as never,
	});
	await assert.rejects(authority.open({
		root: ROOT, reference: '2'.repeat(48), finalName: 'master.wav',
		maximumBytes: 4, finalPrefixByteLength: 0, fence: () => undefined,
	}), SoundscaperDeliveryFilesystemUnavailableError);
	assert.equal(helper.exited, true);
});

test('SDF1 recovery carries only opaque native authority and exact identities', async () => {
	const helper = new FakeHelper(undefined, 'foreign');
	const authority = createSoundscaperDeliveryFilesystemProcessAuthority({
		executablePath: '/installed/soundscaper_delivery_fs', spawnProcess: helper.spawn as never,
	});
	assert.equal(await authority.removeRecovered(
		ROOT, 'opaque-native-recovery-token', FILE_IDENTITY, () => undefined,
	), 'foreign');
	assert.deepEqual(helper.opcodes, [0x07]);
	assert.equal(helper.lastJson.rootPath, ROOT.rootPath);
	assert.equal(helper.lastJson.stagingReference, 'opaque-native-recovery-token');
	assert.equal(helper.lastJson.expectedInspection, null);
});

test('SDF1 recovery removal binds sealed length and digest as well as native identity', async () => {
	const helper = new FakeHelper(undefined, 'removed');
	const authority = createSoundscaperDeliveryFilesystemProcessAuthority({
		executablePath: '/installed/soundscaper_delivery_fs', spawnProcess: helper.spawn as never,
	});
	const sha256 = createHash('sha256').update('sealed').digest('hex');
	assert.equal(await authority.removeRecovered(ROOT, 'opaque-native-recovery-token', {
		...FILE_IDENTITY, byteLength: 6, sha256,
	}, () => undefined), 'removed');
	assert.deepEqual(helper.lastJson.expectedInspection, { byteLength: 6, sha256 });
	assert.deepEqual(helper.lastJson.expectedFileIdentity, FILE_IDENTITY);
});

test('SDF1 final inspection is a root-authenticated native operation, never a child path', async () => {
	const helper = new FakeHelper(undefined, 'inspection');
	helper.data = Buffer.from([1, 2, 3, 4]);
	const authority = createSoundscaperDeliveryFilesystemProcessAuthority({
		executablePath: '/installed/soundscaper_delivery_fs', spawnProcess: helper.spawn as never,
	});
	const inspected = await authority.inspectFinal(ROOT, 'master.wav', () => undefined);
	assert.deepEqual(inspected, {
		byteLength: 4,
		sha256: createHash('sha256').update(helper.data).digest('hex'),
		...FILE_IDENTITY,
	});
	assert.deepEqual(helper.opcodes, [0x08]);
	assert.deepEqual(Object.keys(helper.lastJson).sort(), [
		'expectedRootIdentity', 'finalName', 'rootPath', 'schemaVersion',
	]);
	assert.equal(helper.lastJson.finalName, 'master.wav');
	assert.equal(JSON.stringify(helper.lastJson).includes('master.wav/'), false);
});

test('SDF1 turns helper spawn failure into a controlled session refusal', async () => {
	const output = new PassThrough();
	const error = new PassThrough();
	const input = new PassThrough();
	const childBase = Object.assign(new EventEmitter(), {
		stdin: input, stdout: output, stderr: error,
		exitCode: null as number | null, signalCode: null,
	});
	const child = Object.assign(childBase, {
		kill: () => {
			childBase.exitCode = 1;
			childBase.emit('exit', 1, null);
			return true;
		},
	});
	const authority = createSoundscaperDeliveryFilesystemProcessAuthority({
		executablePath: '/missing/soundscaper_delivery_fs',
		spawnProcess: (() => {
			queueMicrotask(() => child.emit('error', new Error('spawn ENOENT')));
			return child;
		}) as never,
	});
	await assert.rejects(authority.open({
		root: ROOT, reference: '2'.repeat(48), finalName: 'master.wav',
		maximumBytes: 4, finalPrefixByteLength: 0, fence: () => undefined,
	}), /spawn ENOENT/u);
});

class FakeHelper {
	readonly opcodes: number[] = [];
	readonly output = new PassThrough();
	readonly error = new PassThrough();
	readonly child = new EventEmitter() as EventEmitter & Record<string, unknown>;
	readonly failCode: string | undefined;
	readonly recoveryStatus: string;
	data = Buffer.alloc(0);
	exited = false;
	lastJson: Record<string, unknown> = {};

	constructor(failCode?: string, recoveryStatus = 'missing') {
		this.failCode = failCode;
		this.recoveryStatus = recoveryStatus;
		const input = new Writable({ write: (chunk, _encoding, done) => {
			try { this.#request(Buffer.from(chunk)); done(); } catch (error) { done(error as Error); }
		} });
		input.on('finish', () => this.#exit());
		Object.assign(this.child, {
			stdin: input, stdout: this.output, stderr: this.error,
			exitCode: null, signalCode: null,
			kill: () => { this.#exit(); return true; },
		});
	}

	readonly spawn = () => this.child;

	#request(frame: Buffer): void {
		assert.equal(frame.subarray(0, 4).toString(), 'SDF1');
		const opcode = frame[5]!;
		const requestId = frame.readUInt32BE(8);
		const length = frame.readUInt32BE(12);
		const payload = frame.subarray(16, 16 + length);
		this.opcodes.push(opcode);
		if (opcode !== 0x02 && opcode !== 0x06 && payload.byteLength) {
			this.lastJson = JSON.parse(payload.toString()) as Record<string, unknown>;
		}
		if (this.failCode && opcode === 0x01) {
			this.#respond(0xff, requestId, {
				schemaVersion: 1, code: this.failCode, phase: 'init', retryable: false,
				detail: 'filesystem does not provide required native staging',
			});
			return;
		}
		switch (opcode) {
			case 0x01:
				this.#respond(0x81, requestId, {
					schemaVersion: 1, sessionId: this.lastJson.sessionId,
					rootIdentity: { volumeIdentity: 'volume-1', directoryIdentity: 'directory-1' },
					stagingReference: 'opaque-native-recovery-token', fileIdentity: FILE_IDENTITY,
					maxChunkBytes: 4 * 1024 * 1024,
				});
				break;
			case 0x02:
				this.data = Buffer.concat([this.data, payload]);
				this.#respond(0x82, requestId, { acceptedBytes: payload.byteLength, totalBytes: this.data.byteLength });
				break;
			case 0x06:
				payload.copy(this.data, 0);
				this.#respond(0x82, requestId, { acceptedBytes: 32, totalBytes: this.data.byteLength });
				break;
			case 0x03: {
				const inspection = this.#inspection();
				this.#respond(0x83, requestId, {
					schemaVersion: 1, ...inspection, rootIdentity: {
						volumeIdentity: 'volume-1', directoryIdentity: 'directory-1',
					}, fileIdentity: FILE_IDENTITY, stagingReference: 'opaque-native-recovery-token',
				});
				break;
			}
			case 0x04:
				this.#respond(0x84, requestId, {
					schemaVersion: 1, journalId: this.lastJson.journalId, ...this.#inspection(),
					rootIdentity: { volumeIdentity: 'volume-1', directoryIdentity: 'directory-1' },
					fileIdentity: FILE_IDENTITY, finalIdentity: FILE_IDENTITY,
				});
				break;
			case 0x05: this.#respond(0x85, requestId, { schemaVersion: 1, status: 'aborted' }); break;
			case 0x07:
				this.#respond(0x87, requestId, {
					schemaVersion: 1, status: this.recoveryStatus, inspection: null,
				});
				break;
			case 0x08:
				this.#respond(0x88, requestId, {
					schemaVersion: 1, status: this.recoveryStatus,
					rootIdentity: { volumeIdentity: 'volume-1', directoryIdentity: 'directory-1' },
					inspection: this.recoveryStatus === 'inspection'
						? { ...this.#inspection(), ...FILE_IDENTITY } : null,
				});
				break;
			default: throw new Error('unexpected fake helper opcode');
		}
	}

	#inspection() {
		return {
			byteLength: this.data.byteLength,
			sha256: createHash('sha256').update(this.data).digest('hex'),
		};
	}

	#respond(opcode: number, requestId: number, value: unknown): void {
		const payload = Buffer.from(JSON.stringify(value));
		const header = Buffer.alloc(16);
		header.write('SDF1');
		header[4] = 1;
		header[5] = opcode;
		header.writeUInt32BE(requestId, 8);
		header.writeUInt32BE(payload.byteLength, 12);
		this.output.write(Buffer.concat([header, payload]));
	}

	#exit(): void {
		if (this.exited) return;
		this.exited = true;
		this.child.exitCode = 0;
		this.output.end();
		this.error.end();
		this.child.emit('exit', 0, null);
	}
}
