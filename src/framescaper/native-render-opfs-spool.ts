/* SPDX-License-Identifier: AGPL-3.0-only */

/** OPFS-backed direct collector for renderer-evaluated native-media carriers. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type {
	FramescaperNativeRgbaFramePackCollector,
	FramescaperNativeRgbaFramePackV1,
} from './native-render-frame-pack-v1.ts';

const DIRECTORY = 'framescaper-native-render-spool-v1';
const NAME = /^carrier-[a-f0-9]{32}\.bin$/u;
const RELEASE = new WeakMap<Blob, () => Promise<void>>();

export interface FramescaperNativeOpfsCollectorOptions {
	readonly root?: FileSystemDirectoryHandle;
	readonly mintName?: () => string;
}

export interface FramescaperNativeOpfsByteSpool {
	readonly byteLength: number;
	write(bytes: Uint8Array): Promise<void>;
	complete(type: string): Promise<Readonly<{
		readonly bytes: Blob;
		readonly byteLength: number;
		readonly sha256: string;
		readonly chunkCount: number;
	}>>;
	abort(): Promise<void>;
}

/** Production requires OPFS; absence is a refusal, never a whole-memory fallback. */
export async function createFramescaperNativeOpfsFramePackCollector(
	maximumChunkBytes: number,
	expectedByteLength: number,
	signal: AbortSignal,
	options: FramescaperNativeOpfsCollectorOptions = {},
): Promise<FramescaperNativeRgbaFramePackCollector> {
	const spool = await createFramescaperNativeOpfsByteSpool(
		maximumChunkBytes, expectedByteLength, signal, options,
	);
	return Object.freeze({
		append: (bytes: Uint8Array) => spool.write(bytes),
		complete: (type: string) => spool.complete(type),
		clear: () => spool.abort(),
	});
}

/** Exact-length OPFS spool shared by selected V28 picture and PCM carriers. */
export async function createFramescaperNativeOpfsByteSpool(
	maximumChunkBytes: number,
	expectedByteLength: number,
	signal: AbortSignal,
	options: FramescaperNativeOpfsCollectorOptions = {},
): Promise<FramescaperNativeOpfsByteSpool> {
	if (!Number.isSafeInteger(maximumChunkBytes) || maximumChunkBytes < 32
		|| !Number.isSafeInteger(expectedByteLength) || expectedByteLength < 1
		|| !(signal instanceof AbortSignal)) throw new TypeError('The native OPFS collector bounds are invalid.');
	throwIfAborted(signal);
	const root = options.root ?? await opfsRoot();
	const directory = await root.getDirectoryHandle(DIRECTORY, { create: true });
	const name = options.mintName?.() ?? `carrier-${crypto.randomUUID().replaceAll('-', '')}.bin`;
	if (!NAME.test(name)) throw new TypeError('The native OPFS carrier name is invalid.');
	const handle = await directory.getFileHandle(name, { create: true });
	const writable = await handle.createWritable({ keepExistingData: false });
	return new OpfsByteSpool(
		directory, name, handle, writable, maximumChunkBytes, expectedByteLength, signal,
	);
}

/** Remove the renderer-side spool only after main durably stages its bytes. */
export async function releaseFramescaperNativeOpfsSpool(bytes: Blob): Promise<boolean> {
	const release = RELEASE.get(bytes);
	if (!release) return false;
	await release();
	RELEASE.delete(bytes);
	return true;
}

class OpfsByteSpool implements FramescaperNativeOpfsByteSpool {
	readonly #directory: FileSystemDirectoryHandle;
	readonly #name: string;
	readonly #handle: FileSystemFileHandle;
	readonly #maximumChunkBytes: number;
	readonly #expectedByteLength: number;
	readonly #signal: AbortSignal;
	readonly #hash = sha256.create();
	#writable: FileSystemWritableFileStream | null;
	#byteLength = 0;
	#chunkCount = 0;
	#completed: Blob | null = null;

	constructor(directory: FileSystemDirectoryHandle, name: string, handle: FileSystemFileHandle,
		writable: FileSystemWritableFileStream, maximumChunkBytes: number,
		expectedByteLength: number, signal: AbortSignal) {
		this.#directory = directory; this.#name = name; this.#handle = handle;
		this.#writable = writable; this.#maximumChunkBytes = maximumChunkBytes;
		this.#expectedByteLength = expectedByteLength; this.#signal = signal;
	}

	get byteLength(): number { return this.#byteLength; }

	async write(bytes: Uint8Array): Promise<void> {
		throwIfAborted(this.#signal);
		if (!this.#writable || this.#completed) throw new Error('The native OPFS collector is closed.');
		if (this.#byteLength > this.#expectedByteLength - bytes.byteLength) {
			throw new RangeError('The native OPFS collector exceeded its exact byte declaration.');
		}
		this.#hash.update(bytes); this.#byteLength += bytes.byteLength;
		for (let offset = 0; offset < bytes.byteLength; offset += this.#maximumChunkBytes) {
			throwIfAborted(this.#signal);
			const chunk = bytes.slice(offset, Math.min(bytes.byteLength, offset + this.#maximumChunkBytes));
			await this.#writable.write(chunk); chunk.fill(0); this.#chunkCount += 1;
		}
	}

	async complete(type: string): Promise<FramescaperNativeRgbaFramePackV1> {
		throwIfAborted(this.#signal);
		if (!this.#writable || this.#completed || this.#byteLength !== this.#expectedByteLength) {
			throw new Error('The native OPFS collector cannot close an incomplete carrier.');
		}
		await this.#writable.close(); this.#writable = null;
		const file = await this.#handle.getFile();
		if (file.size !== this.#byteLength) throw new Error('The native OPFS carrier changed length.');
		const exposed = new Blob([file], { type });
		this.#completed = exposed;
		const release = async (): Promise<void> => { await this.#directory.removeEntry(this.#name); };
		RELEASE.set(exposed, release);
		return Object.freeze({
			bytes: exposed,
			byteLength: this.#byteLength, sha256: bytesToHex(this.#hash.digest()),
			chunkCount: this.#chunkCount,
		});
	}

	async abort(): Promise<void> {
		const writable = this.#writable; this.#writable = null;
		if (writable) await writable.abort().catch(() => undefined);
		if (this.#completed) RELEASE.delete(this.#completed);
		this.#completed = null;
		await this.#directory.removeEntry(this.#name).catch(() => undefined);
	}
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
	if (!globalThis.navigator?.storage || typeof navigator.storage.getDirectory !== 'function') {
		throw new Error('Selected V28 direct carrier staging requires OPFS.');
	}
	return navigator.storage.getDirectory();
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason
		?? new DOMException('Native OPFS carrier production was cancelled.', 'AbortError');
}
