/* SPDX-License-Identifier: AGPL-3.0-only */

const DEFAULT_WRITE_CHUNK_BYTES = 1024 * 1024;
const MAXIMUM_WRITE_CHUNK_BYTES = 4 * 1024 * 1024;

export const DIRECT_SAVE_FINAL_PREFIX_BYTE_LENGTH = 32;

type Awaitable<Value> = PromiseLike<Value> | Value;

export type DirectSaveSizeMode = 'maximum' | 'exact';

type DesktopSaveDeclaration = Readonly<{
	readonly targetId: string;
	readonly finalPrefixByteLength?: number;
} & (
	| { readonly maximumSize: number; readonly size?: never }
	| { readonly maximumSize?: never; readonly size: number }
)>;

interface DesktopSaveBridge {
	beginWrite(request: DesktopSaveDeclaration): PromiseLike<Readonly<{ writeId?: unknown; chunkSize?: unknown }>>;
	writeChunk(request: Readonly<{
		writeId: string;
		offset: number;
		bytes: Uint8Array;
	}>): PromiseLike<Readonly<{ nextOffset?: unknown }>>;
	patchFinalPrefix?(request: Readonly<{
		writeId: string;
		bytes: Uint8Array;
	}>): PromiseLike<Readonly<{ byteLength?: unknown }>>;
	finishWrite(writeId: string): PromiseLike<Readonly<{ byteLength?: unknown }>>;
	abortWrite?(writeId: string): PromiseLike<unknown> | unknown;
}

interface DesktopSaveTarget {
	readonly id?: unknown;
	readonly name?: unknown;
}

interface FileSystemSaveTarget {
	readonly name?: unknown;
	createWritable(): PromiseLike<FileSystemSaveWriter>;
}

interface FileSystemSaveWriter {
	write(value: Uint8Array | Readonly<{
		type: 'write';
		position: number;
		data: Uint8Array;
	}>): Awaitable<unknown>;
	close(): Awaitable<unknown>;
	abort?(reason?: unknown): Awaitable<unknown>;
}

interface DirectSaveBackend {
	readonly maximumChunkBytes: number;
	write(bytes: Uint8Array, offset: number): Promise<void>;
	patchFinalPrefix?(bytes: Uint8Array): Promise<void>;
	commit(byteLength: number): Promise<void>;
	abort(reason?: unknown): Promise<void>;
}

export interface DirectSaveWritableOptions {
	readonly finalPrefixByteLength?: number;
}

export interface DirectSavedFile extends Readonly<Record<string, unknown>> {
	readonly fileName: string;
	readonly method: 'desktop' | 'file-system-access';
	readonly size: number;
}

export interface PreparedDirectSave {
	readonly mode: 'stream';
	createWritable(
		byteLength: number,
		sizeMode?: DirectSaveSizeMode,
		options?: DirectSaveWritableOptions,
	): Promise<WritableStream<Uint8Array>>;
	patchFinalPrefix(bytes: Uint8Array): Promise<void>;
	bytesWritten(): number;
	commit(): Promise<DirectSavedFile>;
	abort(reason?: unknown): Promise<void>;
	savedFile(): DirectSavedFile;
}

export function createDesktopPreparedSave(options: Readonly<{
	bridge: DesktopSaveBridge;
	fileName: string;
	signal?: AbortSignal;
	target: DesktopSaveTarget;
}>): PreparedDirectSave {
	const targetId = String(options.target?.id || '');
	if (!targetId) throw new Error('Desktop file writing is unavailable.');
	const bridge = options.bridge;
	if (typeof bridge?.beginWrite !== 'function'
		|| typeof bridge.writeChunk !== 'function'
		|| typeof bridge.finishWrite !== 'function') {
		throw new Error('Desktop file writing is unavailable.');
	}
	return createPreparedDirectSave({
		fileName: String(options.target.name || options.fileName),
		method: 'desktop',
		signal: options.signal,
		open: async (byteLength, sizeMode, writableOptions) => {
			if (writableOptions.finalPrefixByteLength
				&& typeof bridge.patchFinalPrefix !== 'function') {
				throw new Error('Desktop final-prefix patching is unavailable.');
			}
			const declaration: DesktopSaveDeclaration = sizeMode === 'exact'
				? {
					targetId,
					size: byteLength,
					...(writableOptions.finalPrefixByteLength
						? { finalPrefixByteLength: writableOptions.finalPrefixByteLength }
						: {}),
				}
				: { targetId, maximumSize: byteLength };
			const session = await bridge.beginWrite(declaration);
			const writeId = String(session?.writeId || '');
			if (!writeId) throw new Error('The desktop save session could not be started.');
			const negotiatedChunkBytes = Number(session.chunkSize);
			const maximumChunkBytes = Number.isSafeInteger(negotiatedChunkBytes) && negotiatedChunkBytes > 0
				? Math.min(MAXIMUM_WRITE_CHUNK_BYTES, negotiatedChunkBytes)
				: DEFAULT_WRITE_CHUNK_BYTES;
			return {
				maximumChunkBytes,
				async write(bytes, offset) {
					const result = await bridge.writeChunk({ writeId, offset, bytes });
					if (Number(result?.nextOffset) !== offset + bytes.byteLength) {
						throw new Error('The desktop save stream lost synchronization.');
					}
				},
				async patchFinalPrefix(bytes) {
					const result = await bridge.patchFinalPrefix!({ writeId, bytes });
					if (Number(result?.byteLength) !== byteLength) {
						throw new Error('The desktop final-prefix patch lost synchronization.');
					}
				},
				async commit(byteLength) {
					const result = await bridge.finishWrite(writeId);
					if (Number(result?.byteLength) !== byteLength) {
						throw new Error('The desktop save completed with an unexpected size.');
					}
				},
				async abort() {
					await Promise.resolve(bridge.abortWrite?.(writeId));
				},
			};
		},
	});
}

export function createFileSystemPreparedSave(options: Readonly<{
	fileName: string;
	signal?: AbortSignal;
	target: FileSystemSaveTarget;
}>): PreparedDirectSave {
	if (typeof options.target?.createWritable !== 'function') {
		throw new Error('File System Access writing is unavailable.');
	}
	return createPreparedDirectSave({
		fileName: String(options.target.name || options.fileName),
		method: 'file-system-access',
		signal: options.signal,
		open: async () => {
			const writer = await options.target.createWritable();
			if (!writer || typeof writer.write !== 'function' || typeof writer.close !== 'function') {
				throw new Error('File System Access writing is unavailable.');
			}
			return {
				maximumChunkBytes: MAXIMUM_WRITE_CHUNK_BYTES,
				async write(bytes) { await writer.write(bytes); },
				async patchFinalPrefix(bytes) {
					await writer.write({ type: 'write', position: 0, data: bytes });
				},
				async commit() { await writer.close(); },
				async abort(reason) { await writer.abort?.(reason); },
			};
		},
	});
}

function createPreparedDirectSave(options: Readonly<{
	fileName: string;
	method: DirectSavedFile['method'];
	open(
		byteLength: number,
		sizeMode: DirectSaveSizeMode,
		options: Readonly<{ readonly finalPrefixByteLength: number }>,
	): Promise<DirectSaveBackend>;
	signal?: AbortSignal;
}>): PreparedDirectSave {
	let backend: DirectSaveBackend | null = null;
	let maximumBytes = 0;
	let sizeMode: DirectSaveSizeMode = 'maximum';
	let byteLength = 0;
	let opened = false;
	let sealed = false;
	let committed: DirectSavedFile | null = null;
	let abortPromise: Promise<void> | null = null;
	let abortReason: unknown;
	let listening = false;
	let finalPrefixByteLength = 0;
	let finalPrefixAttempted = false;
	let finalPrefixPatched = false;

	const onAbort = () => {
		abortReason = options.signal?.reason;
		void requestAbort(abortReason).catch(() => undefined);
	};

	async function createWritable(
		value: number,
		requestedSizeMode?: DirectSaveSizeMode,
		requestedOptions?: DirectSaveWritableOptions,
	): Promise<WritableStream<Uint8Array>> {
		if (opened) throw new Error('The direct-save destination was already opened.');
		const nextSizeMode = normalizeSizeMode(requestedSizeMode);
		const nextMaximumBytes = safeNonNegativeInteger(
			value,
			nextSizeMode === 'exact' ? 'Direct-save declared size' : 'Direct-save admitted maximum',
		);
		const writableOptions = normalizeWritableOptions(
			requestedOptions,
			nextSizeMode,
			nextMaximumBytes,
		);
		sizeMode = nextSizeMode;
		maximumBytes = nextMaximumBytes;
		finalPrefixByteLength = writableOptions.finalPrefixByteLength;
		opened = true;
		throwIfAborted(options.signal);
		backend = await options.open(maximumBytes, sizeMode, writableOptions);
		try {
			throwIfAborted(options.signal);
		} catch (error) {
			await requestAbort(error);
			throw error;
		}
		options.signal?.addEventListener('abort', onAbort, { once: true });
		listening = Boolean(options.signal);
		return new WritableStream<Uint8Array>({
			write: writeChunk,
			close() { sealed = true; },
			abort: requestAbort,
		});
	}

	async function patchFinalPrefix(value: Uint8Array): Promise<void> {
		try {
			throwIfAborted(options.signal);
			if (!backend || committed || abortPromise) {
				throw new Error('The direct-save destination cannot patch its final prefix.');
			}
			if (!finalPrefixByteLength) {
				throw new Error('The direct-save destination did not declare a final prefix.');
			}
			if (finalPrefixAttempted) {
				throw new Error('The direct-save final prefix was already attempted.');
			}
			if (!sealed) {
				throw new Error('The direct-save stream must be sealed before its final prefix is patched.');
			}
			const bytes = toBytes(value);
			if (bytes.byteLength !== finalPrefixByteLength) {
				throw new RangeError(`The direct-save final prefix must contain exactly ${finalPrefixByteLength} bytes.`);
			}
			if (sizeMode !== 'exact' || byteLength !== maximumBytes) {
				throw new RangeError('The direct-save final prefix requires the exact declared size to be appended.');
			}
			if (typeof backend.patchFinalPrefix !== 'function') {
				throw new Error('Direct-save final-prefix patching is unavailable.');
			}
			finalPrefixAttempted = true;
			await backend.patchFinalPrefix(bytes);
			throwIfAborted(options.signal);
			finalPrefixPatched = true;
		} catch (error) {
			await abortAfterFailure(error);
		}
	}

	async function writeChunk(value: Uint8Array): Promise<void> {
		try {
			throwIfAborted(options.signal);
			if (!backend || sealed || committed || abortPromise) {
				throw new Error('The direct-save destination is not writable.');
			}
			const bytes = toBytes(value);
			if (bytes.byteLength > maximumBytes - byteLength) {
				throw new RangeError('The direct save exceeds its admitted maximum.');
			}
			for (let cursor = 0; cursor < bytes.byteLength; cursor += backend.maximumChunkBytes) {
				throwIfAborted(options.signal);
				const chunk = bytes.subarray(cursor, cursor + backend.maximumChunkBytes);
				await backend.write(chunk, byteLength);
				byteLength += chunk.byteLength;
				throwIfAborted(options.signal);
			}
		} catch (error) {
			await abortAfterFailure(error);
		}
	}

	async function commit(): Promise<DirectSavedFile> {
		if (committed) return committed;
		if (!backend || !sealed || abortPromise) throw new Error('The direct-save destination is not ready to commit.');
		throwIfAborted(options.signal);
		if (sizeMode === 'exact' && byteLength !== maximumBytes) {
			await abortAfterFailure(new RangeError(
				'Exact direct-save output size does not match the declared size.',
			));
		}
		if (finalPrefixByteLength && !finalPrefixPatched) {
			await abortAfterFailure(new Error('The direct-save final prefix was not patched.'));
		}
		detachAbort();
		await backend.commit(byteLength);
		committed = Object.freeze({
			method: options.method,
			fileName: options.fileName,
			size: byteLength,
		});
		return committed;
	}

	async function requestAbort(reason?: unknown): Promise<void> {
		if (committed || !backend) return;
		abortReason ??= reason;
		detachAbort();
		abortPromise ??= backend.abort(abortReason);
		await abortPromise;
	}

	async function abortAfterFailure(primary: unknown): Promise<never> {
		try {
			await requestAbort(primary);
		} catch (cleanupError) {
			throw new AggregateError(
				[primary, cleanupError],
				'The direct save and destination cleanup both failed.',
			);
		}
		throw primary;
	}

	function savedFile(): DirectSavedFile {
		if (!committed) throw new Error('The direct-save destination has not been committed.');
		return committed;
	}

	function bytesWritten(): number {
		return byteLength;
	}

	function detachAbort(): void {
		if (!listening) return;
		options.signal?.removeEventListener('abort', onAbort);
		listening = false;
	}

	return Object.freeze({
		mode: 'stream',
		createWritable,
		patchFinalPrefix,
		bytesWritten,
		commit,
		abort: requestAbort,
		savedFile,
	});
}

function toBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('Direct-save chunks must be binary data.');
}

function safeNonNegativeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${field} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function normalizeSizeMode(value: unknown): DirectSaveSizeMode {
	if (value === undefined || value === 'maximum') return 'maximum';
	if (value === 'exact') return 'exact';
	throw new RangeError('Direct-save size mode must be "maximum" or "exact".');
}

function normalizeWritableOptions(
	value: DirectSaveWritableOptions | undefined,
	sizeMode: DirectSaveSizeMode,
	maximumBytes: number,
): Readonly<{ readonly finalPrefixByteLength: number }> {
	const finalPrefixByteLength = value?.finalPrefixByteLength ?? 0;
	if (finalPrefixByteLength !== 0
		&& finalPrefixByteLength !== DIRECT_SAVE_FINAL_PREFIX_BYTE_LENGTH) {
		throw new RangeError(
			`Direct-save final prefixes must contain exactly ${DIRECT_SAVE_FINAL_PREFIX_BYTE_LENGTH} bytes.`,
		);
	}
	if (finalPrefixByteLength && sizeMode !== 'exact') {
		throw new RangeError('Direct-save final prefixes require exact-size mode.');
	}
	if (finalPrefixByteLength && maximumBytes < finalPrefixByteLength) {
		throw new RangeError('The direct-save declared size is smaller than its final prefix.');
	}
	return Object.freeze({ finalPrefixByteLength });
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The file operation was cancelled.', 'AbortError');
}
