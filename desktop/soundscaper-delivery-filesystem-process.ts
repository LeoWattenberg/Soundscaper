/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { Readable } from 'node:stream';

import {
	SoundscaperDeliveryFilesystemUnavailableError,
	type SoundscaperDeliveryFilesystemAuthority,
	type SoundscaperDeliveryFilesystemFence,
	type SoundscaperDeliveryFilesystemSession,
} from './soundscaper-delivery-filesystem-authority.ts';
import {
	sameDeliveryFileIdentity,
	type SoundscaperDeliveryFileIdentity,
	type SoundscaperDeliveryFileInspection,
	type SoundscaperDeliveryRoot,
} from './soundscaper-delivery-root.ts';

const MAGIC = Buffer.from('SDF1');
const VERSION = 1;
const HEADER_BYTES = 16;
const MAXIMUM_CONTROL_BYTES = 64 * 1024;
const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
const ERROR = 0xff;

const OP = Object.freeze({
	init: 0x01, data: 0x02, seal: 0x03, publish: 0x04, abort: 0x05, patch: 0x06, recover: 0x07,
	inspectFinal: 0x08,
	ready: 0x81, acknowledged: 0x82, sealed: 0x83, published: 0x84, aborted: 0x85,
	recovered: 0x87, finalInspection: 0x88,
});

type SpawnProcess = typeof spawn;

export interface SoundscaperDeliveryFilesystemProcessOptions {
	readonly executablePath: string;
	readonly spawnProcess?: SpawnProcess;
}

export class SoundscaperDeliveryFilesystemProcessError extends Error {
	readonly code: string;
	readonly phase: string;
	readonly retryable: boolean;

	constructor(value: Readonly<{ code: string; phase: string; retryable: boolean; detail: string }>) {
		super(value.detail);
		this.name = 'SoundscaperDeliveryFilesystemProcessError';
		this.code = value.code;
		this.phase = value.phase;
		this.retryable = value.retryable;
	}
}

/** Main-only SDF1 adapter. The child process owns every mutable filesystem handle. */
export function createSoundscaperDeliveryFilesystemProcessAuthority(
	options: SoundscaperDeliveryFilesystemProcessOptions,
): SoundscaperDeliveryFilesystemAuthority {
	if (!options || typeof options.executablePath !== 'string' || !isAbsolute(options.executablePath)) {
		throw new TypeError('Soundscaper delivery filesystem helper requires an absolute executable path.');
	}
	const spawnProcess = options.spawnProcess ?? spawn;
	const authority: SoundscaperDeliveryFilesystemAuthority = {
		async open(value) {
			const peer = startPeer(spawnProcess, options.executablePath, []);
			try {
				const ready = exactRecord(await peer.request(OP.init, json({
					schemaVersion: 1,
					sessionId: opaqueId(value.reference, 'session'),
					rootPath: value.root.rootPath,
					finalName: value.finalName,
					expectedRootIdentity: {
						volumeIdentity: value.root.volumeIdentity,
						directoryIdentity: value.root.directoryIdentity,
					},
					limits: {
						maxBytes: boundedBytes(value.maximumBytes, 'maximum bytes'),
						maxChunkBytes: MAXIMUM_CHUNK_BYTES,
						finalPrefixByteLength: value.finalPrefixByteLength,
					},
				}), OP.ready), [
					'schemaVersion', 'sessionId', 'rootIdentity', 'stagingReference',
					'fileIdentity', 'maxChunkBytes',
				], 'READY');
				if (ready.schemaVersion !== 1) throw new Error('Invalid delivery helper READY schema version.');
				const rootIdentity = decodeRootIdentity(ready.rootIdentity);
				if (rootIdentity.volumeIdentity !== value.root.volumeIdentity
					|| rootIdentity.directoryIdentity !== value.root.directoryIdentity) {
					throw new Error('Soundscaper delivery helper changed the authorized destination identity.');
				}
				if (ready.sessionId !== value.reference
					|| boundedBytes(ready.maxChunkBytes, 'negotiated chunk bytes') !== MAXIMUM_CHUNK_BYTES) {
					throw new Error('Soundscaper delivery helper changed its session or chunk authority.');
				}
				const identity = decodeFileIdentity(ready.fileIdentity);
				const recoveryToken = boundedText(ready.stagingReference, 8, MAXIMUM_CONTROL_BYTES, 'staging reference');
				value.fence('native-stage-ready');
				return new ProcessSession(
					peer, value.root, value.reference, recoveryToken, value.finalName,
					identity, value.maximumBytes, value.finalPrefixByteLength, value.fence,
				);
			} catch (error) {
				await peer.close();
				throw error;
			}
		},
		async removeRecovered(root, recoveryToken, expected, fence) {
			const peer = startPeer(spawnProcess, options.executablePath, ['--recover']);
			try {
				const response = exactRecord(await peer.request(OP.recover, json({
					schemaVersion: 1, action: 'remove', rootPath: root.rootPath,
					expectedRootIdentity: {
						volumeIdentity: root.volumeIdentity, directoryIdentity: root.directoryIdentity,
					},
					stagingReference: boundedText(
						recoveryToken, 8, MAXIMUM_CONTROL_BYTES, 'recovery staging reference',
					),
					expectedFileIdentity: {
						volumeIdentity: expected.volumeIdentity, fileIdentity: expected.fileIdentity,
					},
					expectedInspection: isInspection(expected) ? {
						byteLength: expected.byteLength, sha256: expected.sha256,
					} : null,
				}), OP.recovered), ['schemaVersion', 'status', 'inspection'], 'RECOVERY');
				if (response.schemaVersion !== 1) throw new Error('Invalid delivery recovery schema version.');
				const status = recoveryStatus(response.status);
				fence('native-recovery-result');
				return status === 'removed' ? 'removed' : status;
			} finally { await peer.close(); }
		},
		async inspectFinal(root, finalName, fence) {
			const peer = startPeer(spawnProcess, options.executablePath, ['--inspect-final']);
			try {
				const response = exactRecord(await peer.request(OP.inspectFinal, json({
					schemaVersion: 1, rootPath: root.rootPath, finalName,
					expectedRootIdentity: {
						volumeIdentity: root.volumeIdentity, directoryIdentity: root.directoryIdentity,
					},
				}), OP.finalInspection), ['schemaVersion', 'status', 'rootIdentity', 'inspection'], 'FINAL INSPECTION');
				if (response.schemaVersion !== 1) throw new Error('Invalid final-inspection schema version.');
				const observedRoot = decodeRootIdentity(response.rootIdentity);
				if (observedRoot.volumeIdentity !== root.volumeIdentity
					|| observedRoot.directoryIdentity !== root.directoryIdentity) {
					throw new Error('Soundscaper delivery helper inspected a different destination root.');
				}
				fence('native-final-inspection');
				if (response.status === 'missing' && response.inspection === null) return null;
				if (response.status !== 'inspection') {
					throw new Error('Soundscaper delivery final is foreign or ambiguous.');
				}
				return decodeFinalInspection(response.inspection);
			} finally { await peer.close(); }
		},
	};
	return Object.freeze(authority);
}

class ProcessSession implements SoundscaperDeliveryFilesystemSession {
	readonly reference: string;
	readonly recoveryToken: string;
	readonly volumeIdentity: string;
	readonly fileIdentity: string;
	readonly #peer: FramedPeer;
	readonly #root: SoundscaperDeliveryRoot;
	readonly #finalName: string;
	readonly #maximumBytes: number;
	readonly #prefixBytes: 0 | 32;
	readonly #fence: SoundscaperDeliveryFilesystemFence;
	#byteLength = 0;
	#patched = false;
	#sealed: SoundscaperDeliveryFileInspection | null = null;
	#settled = false;

	constructor(
		peer: FramedPeer,
		root: SoundscaperDeliveryRoot,
		reference: string,
		recoveryToken: string,
		finalName: string,
		identity: SoundscaperDeliveryFileIdentity,
		maximumBytes: number,
		prefixBytes: 0 | 32,
		fence: SoundscaperDeliveryFilesystemFence,
	) {
		this.#peer = peer;
		this.#root = root;
		this.reference = reference;
		this.recoveryToken = recoveryToken;
		this.#finalName = finalName;
		this.volumeIdentity = identity.volumeIdentity;
		this.fileIdentity = identity.fileIdentity;
		this.#maximumBytes = maximumBytes;
		this.#prefixBytes = prefixBytes;
		this.#fence = fence;
	}

	get settled(): boolean { return this.#settled; }

	async write(offset: number, bytes: Uint8Array): Promise<number> {
		if (this.#sealed || this.#settled || this.#patched || offset !== this.#byteLength
			|| bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_CHUNK_BYTES
			|| bytes.byteLength > this.#maximumBytes - this.#byteLength) {
			throw new RangeError('Soundscaper delivery native stream lost synchronization.');
		}
		const response = exactRecord(
			await this.#peer.request(OP.data, Buffer.from(bytes), OP.acknowledged),
			['acceptedBytes', 'totalBytes'], 'DATA acknowledgement',
		);
		const accepted = boundedBytes(response.acceptedBytes, 'accepted bytes');
		const total = boundedBytes(response.totalBytes, 'total accepted bytes');
		if (accepted !== bytes.byteLength || total !== this.#byteLength + accepted) {
			throw new Error('Soundscaper delivery helper acknowledged a different byte stream.');
		}
		this.#byteLength = total;
		this.#fence('write');
		return accepted;
	}

	async patch(offset: number, bytes: Uint8Array): Promise<number> {
		if (offset !== 0 || this.#prefixBytes !== 32 || bytes.byteLength !== 32
			|| this.#byteLength < 32 || this.#sealed || this.#settled || this.#patched) {
			throw new Error('Soundscaper delivery native final prefix is not admissible.');
		}
		const response = exactRecord(
			await this.#peer.request(OP.patch, Buffer.from(bytes), OP.acknowledged),
			['acceptedBytes', 'totalBytes'], 'PATCH',
		);
		if (boundedBytes(response.acceptedBytes, 'patched bytes') !== 32
			|| boundedBytes(response.totalBytes, 'patched total bytes') !== this.#byteLength) {
			throw new Error('Soundscaper delivery helper acknowledged a different final prefix.');
		}
		this.#patched = true;
		this.#fence('patch-prefix');
		return 32;
	}

	async seal(byteLength: number): Promise<SoundscaperDeliveryFileInspection> {
		if (this.#sealed || this.#settled || byteLength !== this.#byteLength
			|| (this.#prefixBytes === 32 && !this.#patched)) {
			throw new Error('Soundscaper delivery native stream cannot be sealed.');
		}
		const response = exactRecord(
			await this.#peer.request(OP.seal, json({ byteLength }), OP.sealed),
			['schemaVersion', 'byteLength', 'sha256', 'rootIdentity', 'fileIdentity', 'stagingReference'],
			'SEALED',
		);
		if (response.schemaVersion !== 1) throw new Error('Invalid delivery helper SEALED schema version.');
		this.#assertRootIdentity(response.rootIdentity);
		const inspection = decodeInspection(response);
		if (inspection.byteLength !== byteLength || !sameDeliveryFileIdentity(inspection, this)) {
			throw new Error('Soundscaper delivery helper sealed different bytes or identity.');
		}
		if (response.stagingReference !== this.recoveryToken) {
			throw new Error('Soundscaper delivery helper changed its recovery authority.');
		}
		this.#sealed = inspection;
		this.#fence('sync');
		return inspection;
	}

	async inspect(): Promise<SoundscaperDeliveryFileInspection> {
		if (!this.#sealed || this.#settled) throw new Error('Soundscaper delivery native stage is not inspectable.');
		return this.#sealed;
	}

	async publish(finalName: string, journalId: string): Promise<SoundscaperDeliveryFileInspection> {
		if (!this.#sealed || this.#settled || finalName !== this.#finalName) {
			throw new Error('Soundscaper delivery native stage cannot be published.');
		}
		const response = exactRecord(await this.#peer.request(OP.publish, json({
			journalId: opaqueId(journalId, 'journal'),
		}), OP.published), [
			'schemaVersion', 'journalId', 'byteLength', 'sha256',
			'rootIdentity', 'fileIdentity', 'finalIdentity',
		], 'PUBLISHED');
		if (response.schemaVersion !== 1) throw new Error('Invalid delivery helper PUBLISHED schema version.');
		this.#assertRootIdentity(response.rootIdentity);
		const stagedIdentity = decodeFileIdentity(response.fileIdentity);
		const inspection = decodePublished(response);
		if (response.journalId !== journalId || inspection.byteLength !== this.#sealed.byteLength
			|| inspection.sha256 !== this.#sealed.sha256
			|| !sameDeliveryFileIdentity(stagedIdentity, this)
			|| !sameDeliveryFileIdentity(inspection, this)) {
			throw new Error('Soundscaper delivery helper published a different journal artifact.');
		}
		this.#settled = true;
		await this.#peer.close();
		this.#fence('publication-link');
		this.#fence('publication-retire');
		this.#fence('directory-sync');
		return inspection;
	}

	async abort(): Promise<'missing' | 'removed' | 'foreign'> {
		if (this.#settled) return 'missing';
		try {
			const response = exactRecord(
				await this.#peer.request(OP.abort, Buffer.alloc(0), OP.aborted),
				['schemaVersion', 'status'], 'ABORTED',
			);
			if (response.schemaVersion !== 1 || response.status !== 'aborted') {
				throw new Error('Invalid delivery helper ABORTED response.');
			}
		}
		finally { this.#settled = true; await this.#peer.close(); }
		this.#fence('native-stage-abort');
		return 'removed';
	}

	async abandon(): Promise<void> {
		if (this.#settled) return;
		this.#settled = true;
		await this.#peer.close();
	}

	#assertRootIdentity(value: unknown): void {
		const identity = decodeRootIdentity(value);
		if (identity.volumeIdentity !== this.#root.volumeIdentity
			|| identity.directoryIdentity !== this.#root.directoryIdentity) {
			throw new Error('Soundscaper delivery helper changed the authorized destination identity.');
		}
	}
}

interface Frame { readonly opcode: number; readonly requestId: number; readonly payload: Buffer }

class FramedPeer {
	readonly #child: ChildProcessWithoutNullStreams;
	readonly #reader: FrameReader;
	#requestId = 0;
	#closed = false;
	#failed = false;

	constructor(child: ChildProcessWithoutNullStreams) {
		this.#child = child;
		this.#reader = new FrameReader(child.stdout);
		child.once('error', (error) => { this.#failed = true; this.#reader.fail(error); });
	}

	async request(opcode: number, payload: Buffer, expectedOpcode: number): Promise<unknown> {
		if (this.#closed) throw new Error('Soundscaper delivery filesystem helper is closed.');
		if (payload.byteLength > (opcode === OP.data ? MAXIMUM_CHUNK_BYTES : MAXIMUM_CONTROL_BYTES)) {
			throw new RangeError('Soundscaper delivery filesystem helper payload is too large.');
		}
		const requestId = ++this.#requestId;
		await writeFrame(this.#child, { opcode, requestId, payload });
		const response = await this.#reader.read();
		if (response.requestId !== requestId) throw new Error('Soundscaper delivery helper response lost synchronization.');
		if (response.opcode === ERROR) throw decodeProcessError(response.payload);
		if (response.opcode !== expectedOpcode) throw new Error('Soundscaper delivery helper returned the wrong response.');
		return response.payload.byteLength ? parseJson(response.payload) : Object.freeze({});
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#child.stdin.end();
		if (this.#failed) {
			try { this.#child.kill(); } catch { /* process never spawned */ }
			return;
		}
		if (this.#child.exitCode === null && this.#child.signalCode === null) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(() => { this.#child.kill(); resolve(); }, 2_000);
				timer.unref?.();
				this.#child.once('exit', () => { clearTimeout(timer); resolve(); });
			});
		}
	}
}

class FrameReader {
	readonly #stream: Readable;
	#buffer = Buffer.alloc(0);
	#waiting: (() => void) | null = null;
	#error: Error | null = null;

	constructor(stream: Readable) {
		this.#stream = stream;
		stream.on('data', (chunk: Buffer) => {
			if (this.#error !== null) return;
			const bytes = Buffer.from(chunk);
			if (this.#buffer.byteLength + bytes.byteLength > MAXIMUM_CONTROL_BYTES + HEADER_BYTES) {
				this.#error = new Error('Soundscaper delivery helper exceeded its response bound.');
				stream.destroy();
			} else this.#buffer = Buffer.concat([this.#buffer, bytes]);
			this.#waiting?.();
		});
		stream.on('end', () => { this.#error ??= new Error('Soundscaper delivery helper closed unexpectedly.'); this.#waiting?.(); });
		stream.on('error', (error) => { this.#error = error; this.#waiting?.(); });
	}

	fail(error: Error): void {
		this.#error = error;
		this.#waiting?.();
	}

	async read(): Promise<Frame> {
		while (this.#buffer.byteLength < HEADER_BYTES) await this.#more();
		const header = this.#buffer.subarray(0, HEADER_BYTES);
		if (!header.subarray(0, 4).equals(MAGIC) || header[4] !== VERSION || header[6] !== 0 || header[7] !== 0) {
			throw new Error('Soundscaper delivery helper returned a malformed frame header.');
		}
		const length = header.readUInt32BE(12);
		if (length > MAXIMUM_CONTROL_BYTES) throw new Error('Soundscaper delivery helper response is too large.');
		while (this.#buffer.byteLength < HEADER_BYTES + length) await this.#more();
		const frame = Object.freeze({
			opcode: header[5]!, requestId: header.readUInt32BE(8),
			payload: Buffer.from(this.#buffer.subarray(HEADER_BYTES, HEADER_BYTES + length)),
		});
		this.#buffer = this.#buffer.subarray(HEADER_BYTES + length);
		return frame;
	}

	async #more(): Promise<void> {
		if (this.#error) throw this.#error;
		await new Promise<void>((resolve) => { this.#waiting = resolve; });
		this.#waiting = null;
		if (this.#error) throw this.#error;
	}
}

function startPeer(spawnProcess: SpawnProcess, executablePath: string, args: string[]): FramedPeer {
	const child = spawnProcess(executablePath, args, {
		stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
	});
	let stderrBytes = 0;
	child.stderr.on('data', (chunk: Buffer) => {
		stderrBytes += chunk.byteLength;
		if (stderrBytes > MAXIMUM_CONTROL_BYTES) child.stderr.destroy();
	});
	return new FramedPeer(child);
}

async function writeFrame(child: ChildProcessWithoutNullStreams, frame: Frame): Promise<void> {
	const header = Buffer.alloc(HEADER_BYTES);
	MAGIC.copy(header, 0);
	header[4] = VERSION;
	header[5] = frame.opcode;
	header.writeUInt16BE(0, 6);
	header.writeUInt32BE(frame.requestId, 8);
	header.writeUInt32BE(frame.payload.byteLength, 12);
	const value = Buffer.concat([header, frame.payload]);
	if (child.stdin.write(value)) return;
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => { child.stdin.off('drain', drained); child.stdin.off('error', failed); };
		const drained = () => { cleanup(); resolve(); };
		const failed = (error: Error) => { cleanup(); reject(error); };
		child.stdin.once('drain', drained);
		child.stdin.once('error', failed);
	});
}

function decodeProcessError(payload: Buffer): Error {
	const value = exactRecord(
		parseJson(payload), ['schemaVersion', 'code', 'phase', 'retryable', 'detail'], 'error',
	);
	if (value.schemaVersion !== 1) throw new Error('Invalid delivery helper error schema version.');
	const error = new SoundscaperDeliveryFilesystemProcessError({
		code: boundedText(value.code, 1, 128, 'error code'),
		phase: boundedText(value.phase, 1, 128, 'error phase'),
		retryable: value.retryable === true,
		detail: boundedText(value.detail, 1, 4_096, 'error detail'),
	});
	return error.code === 'unsupported-filesystem'
		? new SoundscaperDeliveryFilesystemUnavailableError(error.message) : error;
}

function decodeInspection(value: Record<string, unknown>): SoundscaperDeliveryFileInspection {
	return Object.freeze({
		byteLength: boundedBytes(value.byteLength, 'sealed byte length'),
		sha256: digest(value.sha256),
		...decodeFileIdentity(value.fileIdentity),
	});
}

function decodePublished(value: Record<string, unknown>): SoundscaperDeliveryFileInspection {
	return Object.freeze({
		byteLength: boundedBytes(value.byteLength, 'published byte length'),
		sha256: digest(value.sha256),
		...decodeFileIdentity(value.finalIdentity),
	});
}

function decodeFinalInspection(value: unknown): SoundscaperDeliveryFileInspection {
	const row = exactRecord(
		value, ['byteLength', 'sha256', 'volumeIdentity', 'fileIdentity'], 'final inspection',
	);
	return Object.freeze({
		byteLength: boundedBytes(row.byteLength, 'final byte length'),
		sha256: digest(row.sha256),
		...decodeFileIdentity(row),
	});
}

function decodeRootIdentity(value: unknown): Readonly<{ volumeIdentity: string; directoryIdentity: string }> {
	const row = record(value, 'root identity');
	return Object.freeze({
		volumeIdentity: identityText(row.volumeIdentity, 'volume identity'),
		directoryIdentity: identityText(row.directoryIdentity, 'directory identity'),
	});
}

function decodeFileIdentity(value: unknown): SoundscaperDeliveryFileIdentity {
	const row = record(value, 'file identity');
	return Object.freeze({
		volumeIdentity: identityText(row.volumeIdentity, 'volume identity'),
		fileIdentity: identityText(row.fileIdentity, 'file identity'),
	});
}

function recoveryStatus(value: unknown): 'removed' | 'missing' | 'foreign' {
	if (value === 'removed' || value === 'missing' || value === 'foreign') return value;
	throw new Error('Soundscaper delivery helper returned an invalid recovery status.');
}

function json(value: unknown): Buffer {
	const encoded = Buffer.from(JSON.stringify(value), 'utf8');
	if (encoded.byteLength > MAXIMUM_CONTROL_BYTES) throw new RangeError('SDF1 control message is too large.');
	return encoded;
}

function parseJson(value: Buffer): unknown {
	try { return JSON.parse(value.toString('utf8')); }
	catch { throw new Error('Soundscaper delivery helper returned invalid JSON.'); }
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`Soundscaper delivery helper ${label} must be a record.`);
	}
	return value as Record<string, unknown>;
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	const row = record(value, label);
	if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...fields].sort())) {
		throw new TypeError(`Soundscaper delivery helper ${label} has unsupported fields.`);
	}
	return row;
}

function boundedBytes(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 65 * 1024 ** 3) {
		throw new RangeError(`Soundscaper delivery helper ${label} is invalid.`);
	}
	return Number(value);
}

function boundedText(value: unknown, minimum: number, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.length < minimum || Buffer.byteLength(value) > maximum || value.includes('\0')) {
		throw new TypeError(`Soundscaper delivery helper ${label} is invalid.`);
	}
	return value;
}

function identityText(value: unknown, label: string): string {
	return boundedText(value, 1, 512, label);
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError('Soundscaper delivery helper digest is invalid.');
	}
	return value;
}

function isInspection(
	value: SoundscaperDeliveryFileIdentity | SoundscaperDeliveryFileInspection,
): value is SoundscaperDeliveryFileInspection {
	return Object.hasOwn(value, 'byteLength') && Object.hasOwn(value, 'sha256');
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) {
		throw new TypeError(`Soundscaper delivery helper ${label} id is invalid.`);
	}
	return value;
}
