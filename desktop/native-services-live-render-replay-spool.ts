/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded main-owned replay file for one renderer-produced selected-V14 input. */

import { createHash, type Hash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';

import type { HelperNativeFileIdentity, HelperNativeInputGrant } from './helper-native-job-contract.ts';
import { HELPER_DATA_CHUNK_MAXIMUM_BYTES } from './helper-data-plane.ts';
import type { NativeRenderInputEnvelope } from './native-services-render-input-contract.ts';
import {
	inspectNativeRenderDerivedFile,
	nativeRenderInputFileIdentity,
	sameNativeRenderInputFileIdentity,
	type FramescaperNativeDerivedRenderInputRole,
	type FramescaperNativeRenderInputDescriptorV1,
} from './native-services-render-input-validation.ts';

const SHA256 = /^[a-f0-9]{64}$/u;

export interface NativeLiveRenderReplaySpoolOptions {
	readonly path: string;
	readonly role: FramescaperNativeDerivedRenderInputRole;
	readonly byteLength: number;
	readonly envelope: NativeRenderInputEnvelope;
}

/**
 * The renderer is acknowledged only after each chunk reaches this bounded file.
 * A completed file is re-opened and authenticated before every native attempt,
 * so hardware and CPU see one immutable carrier without reusing a MessagePort.
 */
export class NativeLiveRenderReplaySpool {
	readonly #path: string;
	readonly #role: FramescaperNativeDerivedRenderInputRole;
	readonly #byteLength: number;
	readonly #envelope: NativeRenderInputEnvelope;
	readonly #hash: Hash = createHash('sha256');
	readonly #ready: Promise<void>;
	readonly #resolveReady: () => void;
	readonly #rejectReady: (reason: unknown) => void;
	#handle: FileHandle | null;
	#identity: HelperNativeFileIdentity | null = null;
	#sha256: string | null = null;
	#admitted = false;
	#offset = 0;
	#grantReservations = 0;
	#grantFailure: Error | null = null;
	#grantTail: Promise<void> = Promise.resolve();
	#disposed = false;
	#failed: unknown = null;
	#closing: Promise<void> = Promise.resolve();

	private constructor(options: NativeLiveRenderReplaySpoolOptions, handle: FileHandle) {
		this.#path = options.path;
		this.#role = options.role;
		this.#byteLength = exactByteLength(options.byteLength);
		this.#envelope = options.envelope;
		this.#handle = handle;
		let resolveReady = (): void => undefined;
		let rejectReady = (_reason: unknown): void => undefined;
		this.#ready = new Promise<void>((resolve, reject) => {
			resolveReady = resolve; rejectReady = reject;
		});
		void this.#ready.catch(() => undefined);
		this.#resolveReady = resolveReady;
		this.#rejectReady = rejectReady;
	}

	static async create(options: NativeLiveRenderReplaySpoolOptions): Promise<NativeLiveRenderReplaySpool> {
		const handle = await open(options.path,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
			0o600);
		try {
			const details = await handle.stat();
			if (!details.isFile() || details.isSymbolicLink() || details.size !== 0) {
				throw new Error('A live V14 replay spool is not one new regular file.');
			}
			return new NativeLiveRenderReplaySpool(options, handle);
		} catch (error) {
			await handle.close().catch(() => undefined);
			throw error;
		}
	}

	get receivedBytes(): number { return this.#offset; }
	get completed(): boolean { return this.#admitted; }

	async write(bytes: Uint8Array): Promise<void> {
		const handle = this.#writable();
		if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1
			|| this.#offset + bytes.byteLength > this.#byteLength) {
			throw new RangeError('A live V14 replay chunk exceeds its exact file authority.');
		}
		const owned = new Uint8Array(bytes);
		const result = await handle.write(owned, 0, owned.byteLength, this.#offset);
		if (result.bytesWritten !== owned.byteLength) {
			throw new Error('A live V14 replay spool write was incomplete.');
		}
		this.#hash.update(owned);
		this.#offset += owned.byteLength;
	}

	async complete(expected: Readonly<{ readonly byteLength: number; readonly sha256: string }>): Promise<void> {
		const handle = this.#writable();
		if (expected.byteLength !== this.#byteLength || this.#offset !== this.#byteLength
			|| typeof expected.sha256 !== 'string' || !SHA256.test(expected.sha256)) {
			throw new Error('A live V14 replay trailer changed its exact byte authority.');
		}
		const sha256 = this.#hash.digest('hex');
		if (sha256 !== expected.sha256) {
			throw new Error('A live V14 replay trailer disagrees with its produced bytes.');
		}
		await handle.sync();
		const beforeClose = identity(await handle.stat());
		await handle.close();
		this.#handle = null;
		this.#identity = beforeClose;
		this.#sha256 = sha256;
		try {
			await this.#authenticate();
			this.#admitted = true;
			this.#resolveReady();
		} catch (error) {
			this.fail(error);
			throw error;
		}
	}

	async grant(signal?: AbortSignal): Promise<HelperNativeInputGrant> {
		await awaitReady(this.#ready, signal);
		if (this.#disposed) throw new Error('The live V14 replay stage ended.');
		if (this.#grantFailure !== null) throw this.#grantFailure;
		if (this.#grantReservations >= 2) {
			throw new Error('A live V14 replay spool admits only hardware and one CPU attempt.');
		}
		this.#grantReservations += 1;
		return this.#serializeGrant(async () => {
			if (this.#disposed) throw new Error('The live V14 replay stage ended.');
			if (this.#grantFailure !== null) throw this.#grantFailure;
			if (signal?.aborted) throw abortError();
			try { await this.#authenticate(); }
			catch (error) {
				// A reserved attempt is never refunded: changed authority poisons every later replay.
				this.#grantFailure = error instanceof Error ? error : new Error(String(error));
				throw this.#grantFailure;
			}
			return Object.freeze({
				type: 'file' as const, role: this.#role, path: this.#path,
				bytes: this.#byteLength, sha256: this.#sha256!, identity: this.#identity!,
			});
		});
	}

	fail(reason: unknown): void {
		if (this.#failed !== null || this.completed) return;
		this.#failed = reason instanceof Error ? reason : new Error(String(reason));
		this.#rejectReady(this.#failed);
		const handle = this.#handle;
		this.#handle = null;
		this.#closing = handle?.close().catch(() => undefined) ?? Promise.resolve();
	}

	async dispose(): Promise<void> {
		this.#disposed = true;
		if (!this.completed && this.#failed === null) {
			this.fail(new Error('The live V14 replay spool was disposed before completion.'));
		}
		await this.#closing;
	}

	#writable(): FileHandle {
		if (this.#failed !== null) throw this.#failed;
		if (this.#handle === null || this.#sha256 !== null) {
			throw new Error('A live V14 replay spool is no longer writable.');
		}
		return this.#handle;
	}

	async #authenticate(): Promise<void> {
		if (this.#sha256 === null || this.#identity === null) {
			throw new Error('A live V14 replay spool is not complete.');
		}
		const descriptor: FramescaperNativeRenderInputDescriptorV1 = Object.freeze({
			role: this.#role, byteLength: this.#byteLength, sha256: this.#sha256,
		});
		const before = await nativeRenderInputFileIdentity(this.#path);
		if (!sameNativeRenderInputFileIdentity(before, this.#identity)) changed();
		await authenticateReplayBytes(
			this.#path, this.#byteLength, this.#sha256, this.#identity,
		);
		await inspectNativeRenderDerivedFile(this.#path, descriptor, this.#envelope);
		const after = await nativeRenderInputFileIdentity(this.#path);
		if (!sameNativeRenderInputFileIdentity(after, this.#identity)) changed();
		const details = await lstat(this.#path);
		if (!details.isFile() || details.isSymbolicLink() || details.size !== this.#byteLength) changed();
	}

	async #serializeGrant<Result>(operation: () => Promise<Result>): Promise<Result> {
		const previous = this.#grantTail;
		let release = (): void => undefined;
		this.#grantTail = new Promise((resolve) => { release = resolve; });
		await previous;
		try { return await operation(); } finally { release(); }
	}
}

async function authenticateReplayBytes(
	path: string,
	byteLength: number,
	sha256: string,
	expectedIdentity: HelperNativeFileIdentity,
): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const details = await handle.stat();
		if (!sameNativeRenderInputFileIdentity(identity(details), expectedIdentity)
			|| details.size !== byteLength) changed();
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(Math.min(HELPER_DATA_CHUNK_MAXIMUM_BYTES, byteLength));
		let offset = 0;
		while (offset < byteLength) {
			const length = Math.min(buffer.byteLength, byteLength - offset);
			const result = await handle.read(buffer, 0, length, offset);
			if (result.bytesRead !== length) changed();
			hash.update(buffer.subarray(0, length)); offset += length;
		}
		if (hash.digest('hex') !== sha256
			|| !sameNativeRenderInputFileIdentity(identity(await handle.stat()), expectedIdentity)) changed();
	} finally { await handle.close(); }
}

function identity(details: Awaited<ReturnType<FileHandle['stat']>>): HelperNativeFileIdentity {
	if (!details.isFile() || details.size < 0) changed();
	const dev = Number(details.dev); const ino = Number(details.ino);
	if (!Number.isSafeInteger(dev) || !Number.isSafeInteger(ino)) changed();
	return Object.freeze({ dev, ino });
}

function exactByteLength(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError('A live V14 replay spool requires one positive exact length.');
	}
	return value;
}

function changed(): never {
	throw new Error('A live V14 replay spool changed file identity, type, length, or digest.');
}

async function awaitReady(ready: Promise<void>, signal?: AbortSignal): Promise<void> {
	if (!signal) { await ready; return; }
	if (signal.aborted) throw abortError();
	let removeAbort = (): void => undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		const abort = (): void => reject(abortError());
		signal.addEventListener('abort', abort, { once: true });
		removeAbort = () => signal.removeEventListener('abort', abort);
	});
	try { await Promise.race([ready, aborted]); } finally { removeAbort(); }
}

function abortError(): Error {
	const error = new Error('The live V14 replay wait was cancelled.');
	error.name = 'AbortError';
	return error;
}
