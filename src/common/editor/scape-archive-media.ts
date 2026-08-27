/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';

import type { ScapeArchiveEntry, ScapeDescriptor } from './scape-archive-envelope.ts';
import { awaitScapeOperation, throwIfScapeAborted } from './scape-abort.ts';
import {
	ScapeAudioChunkBudget,
	SCAPE_MAXIMUM_AUDIO_CHUNKS,
	type ScapeExpandedByteBudget,
} from './scape-expanded-byte-budget.ts';
import {
	pcmRawByteLength,
	validatePcmGeometry,
	WAVPACK_PCM_MAXIMUM_RAW_BYTES,
} from './wavpack/pcm.js';

export const SCAPE_MAXIMUM_PENDING_AUDIO_BYTES = 4 + WAVPACK_PCM_MAXIMUM_RAW_BYTES;
export { SCAPE_MAXIMUM_AUDIO_CHUNKS };

interface DigestWriter {
	update(bytes: Uint8Array): unknown;
	digest(): Uint8Array;
}

export interface ScapeAudioSource {
	readonly kind?: string;
	readonly id: string;
	readonly storageKey?: string;
	readonly name?: string;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly chunkFrames: number;
}

interface ScapePortableSourceCandidate {
	readonly kind?: string;
	readonly id?: string;
	readonly channelCount?: number;
	readonly frameCount?: number;
	readonly chunkFrames?: number;
}

export interface ScapeAudioSourceLayout {
	readonly frameCount: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly chunkCount: number;
	readonly rawPcmBytes: number;
	readonly archiveBytes: number;
}

interface ScapeSourceChunk {
	readonly channels?: readonly Float32Array[];
}

interface ScapeSourceReaderStore {
	readSourceChunks(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): AsyncIterable<readonly Float32Array[] | ScapeSourceChunk>;
}

export interface ScapeSourceWriter {
	write(
		channels: readonly Float32Array[],
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<unknown>;
}

export interface ScapeExtractedAsset {
	readonly digest: string;
	readonly size: number;
}

export function safeScapeEntryId(value: unknown): string {
	const encoded = encodeURIComponent(String(value || '')).replaceAll('%', '_');
	if (encoded === '.') return '_2E';
	if (encoded === '..') return '_2E_2E';
	return encoded;
}

export function scapeBytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new Blob([exactArrayBuffer(bytes)]).stream();
}

export function scapeHashingStream(
	stream: ReadableStream<Uint8Array>,
	digest: DigestWriter,
	signal?: AbortSignal,
): ReadableStream<Uint8Array> {
	return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			throwIfScapeAborted(signal);
			const bytes = toBytes(chunk);
			digest.update(bytes);
			controller.enqueue(bytes);
		},
	}), signal ? { signal } : undefined);
}

export function scapeAudioSourceStream(
	store: ScapeSourceReaderStore,
	source: ScapeAudioSource,
	digest: DigestWriter,
	onBytes: (byteLength: number) => void,
	signal?: AbortSignal,
	audioChunkBudget = new ScapeAudioChunkBudget(),
): ReadableStream<Uint8Array> {
	throwIfScapeAborted(signal);
	const sourceGeometry = scapeAudioSourceLayout(source);
	const iterator = store.readSourceChunks(
		source.storageKey || source.id,
		{ signal },
	)[Symbol.asyncIterator]();
	let queue: Uint8Array[] = [];
	let iteratorClosed = false;
	let writtenFrames = 0;
	const closeIterator = async (): Promise<void> => {
		if (iteratorClosed) return;
		iteratorClosed = true;
		await iterator.return?.();
	};
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				throwIfScapeAborted(signal);
				if (!queue.length) {
					const next = await iterator.next();
					throwIfScapeAborted(signal);
					if (next.done) {
						iteratorClosed = true;
						if (writtenFrames !== source.frameCount) {
							throw new Error(`Stored PCM for ${source.id} ended before its declared frame count.`);
						}
						controller.close();
						return;
					}
					const value = next.value;
					const channels: readonly Float32Array[] | undefined = Array.isArray(value)
						? value as readonly Float32Array[]
						: (value as ScapeSourceChunk).channels;
					if (!channels?.length || channels.length !== source.channelCount) {
						throw new Error(`Stored PCM for ${source.id} is invalid.`);
					}
					if (!channels.every((channel) => channel instanceof Float32Array)) {
						throw new Error(`Stored PCM for ${source.id} is invalid.`);
					}
					const frameCount = channels[0]?.length ?? 0;
					if (!channels.every((channel) => channel.length === frameCount)) {
						throw new Error(`Stored PCM for ${source.id} is not aligned.`);
					}
					const expectedFrameCount = Math.min(
						sourceGeometry.chunkFrames,
						source.frameCount - writtenFrames,
					);
					if (expectedFrameCount < 1 || frameCount !== expectedFrameCount) {
						throw new Error(`Stored PCM for ${source.id} has noncanonical PCM chunk geometry.`);
					}
					audioChunkBudget.consume(source.id);
					writtenFrames += frameCount;
					const header = new Uint8Array(4);
					new DataView(header.buffer).setUint32(0, frameCount, true);
					queue = [header, ...channels.map(float32LittleEndianBytes)];
				}
				const bytes = queue.shift();
				if (!bytes) throw new Error(`Stored PCM for ${source.id} produced an empty queue.`);
				digest.update(bytes);
				onBytes(bytes.byteLength);
				controller.enqueue(bytes);
			} catch (error) {
				await closeIterator();
				throw error;
			}
		},
		async cancel() { await closeIterator(); },
	});
}

/** Preflights semantic audio work before export creates or writes a ZIP destination. */
export function createScapeAudioExportChunkBudget(
	sources: readonly ScapePortableSourceCandidate[],
): ScapeAudioChunkBudget {
	const plannedBudget = new ScapeAudioChunkBudget();
	for (const source of sources) {
		if (source.kind === 'video') continue;
		const layout = scapeAudioSourceLayout(source as ScapeAudioSource);
		plannedBudget.consumeMany(layout.chunkCount, source.id || 'unknown source');
	}
	return new ScapeAudioChunkBudget();
}

export function scapeAudioSourceLayout(source: ScapeAudioSource): Readonly<ScapeAudioSourceLayout> {
	if (!Number.isSafeInteger(source?.frameCount) || source.frameCount < 0) {
		throw new RangeError(`Audio source ${String(source?.id)} has an invalid frame count.`);
	}
	const geometry = validatePcmGeometry(source.chunkFrames, source.channelCount);
	const frames = BigInt(source.frameCount);
	const channels = BigInt(geometry.channelCount);
	const chunkFrames = BigInt(geometry.frames);
	const chunkCount = frames === 0n ? 0n : ((frames - 1n) / chunkFrames) + 1n;
	const rawPcmBytes = frames * channels * BigInt(Float32Array.BYTES_PER_ELEMENT);
	const archiveBytes = rawPcmBytes + 4n * chunkCount;
	if (archiveBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`Audio source ${source.id} archive bytes exceed the supported safe integer range.`);
	}
	return Object.freeze({
		frameCount: source.frameCount,
		channelCount: geometry.channelCount,
		chunkFrames: geometry.frames,
		chunkCount: Number(chunkCount),
		rawPcmBytes: Number(rawPcmBytes),
		archiveBytes: Number(archiveBytes),
	});
}

export async function extractScapeAudio(
	entry: ScapeArchiveEntry,
	sourceWriter: ScapeSourceWriter,
	source: ScapeAudioSource,
	signal?: AbortSignal,
	expandedByteBudget?: ScapeExpandedByteBudget,
	audioChunkBudget = new ScapeAudioChunkBudget(),
): Promise<ScapeExtractedAsset> {
	if (typeof entry.getData !== 'function') throw new Error(`The Scape archive is missing ${entry.filename}.`);
	const sourceGeometry = scapeAudioSourceLayout(source);
	const digest = sha256.create();
	let size = 0;
	const header = new Uint8Array(4);
	let headerBytes = 0;
	let pendingChunk: Uint8Array | undefined;
	let pendingChunkBytes = 0;
	let pendingFrameCount = 0;
	let writtenFrames = 0;
	const writable = new WritableStream<Uint8Array>({
		async write(chunk) {
			throwIfScapeAborted(signal);
			const bytes = toBytes(chunk);
			expandedByteBudget?.consume(bytes.byteLength, entry.filename);
			assertScapeEntryEmissionWithinSize(entry, size, bytes.byteLength);
			digest.update(bytes);
			size += bytes.byteLength;
			let inputOffset = 0;
			while (inputOffset < bytes.byteLength) {
				throwIfScapeAborted(signal);
				if (!pendingChunk) {
					const copiedHeaderBytes = Math.min(4 - headerBytes, bytes.byteLength - inputOffset);
					header.set(bytes.subarray(inputOffset, inputOffset + copiedHeaderBytes), headerBytes);
					headerBytes += copiedHeaderBytes;
					inputOffset += copiedHeaderBytes;
					if (headerBytes < 4) continue;
					pendingFrameCount = new DataView(header.buffer).getUint32(0, true);
					validatePcmGeometry(pendingFrameCount, source.channelCount);
					const expectedFrameCount = Math.min(
						sourceGeometry.chunkFrames,
						source.frameCount - writtenFrames,
					);
					if (pendingFrameCount !== expectedFrameCount) {
						throw new Error(`Audio source ${source.id} has noncanonical PCM chunk geometry.`);
					}
					audioChunkBudget.consume(source.id);
					pendingChunk = new Uint8Array(pcmRawByteLength(pendingFrameCount, source.channelCount));
					pendingChunkBytes = 0;
					headerBytes = 0;
				}
				const copiedChunkBytes = Math.min(
					pendingChunk.byteLength - pendingChunkBytes,
					bytes.byteLength - inputOffset,
				);
				pendingChunk.set(bytes.subarray(inputOffset, inputOffset + copiedChunkBytes), pendingChunkBytes);
				pendingChunkBytes += copiedChunkBytes;
				inputOffset += copiedChunkBytes;
				if (pendingChunkBytes < pendingChunk.byteLength) continue;
				if (pendingFrameCount > source.frameCount - writtenFrames) {
					throw new Error(`Audio source ${source.id} has an unexpected frame count.`);
				}
				const channels: Float32Array[] = [];
				const channelBytes = pendingFrameCount * Float32Array.BYTES_PER_ELEMENT;
				let offset = 0;
				for (let channel = 0; channel < source.channelCount; channel += 1) {
					channels.push(littleEndianBytesToFloat32(pendingChunk.subarray(offset, offset + channelBytes)));
					offset += channelBytes;
				}
				await sourceWriter.write(channels, { signal });
				throwIfScapeAborted(signal);
				writtenFrames += pendingFrameCount;
				pendingChunk = undefined;
				pendingChunkBytes = 0;
				pendingFrameCount = 0;
			}
		},
	});
	await awaitScapeOperation(entry.getData(writable, { signal, strictness: 'strict' }), signal);
	assertScapeEntryEmissionComplete(entry, size);
	if (headerBytes || pendingChunk) throw new Error(`Audio source ${source.id} ends with an incomplete chunk.`);
	if (writtenFrames !== source.frameCount) throw new Error(`Audio source ${source.id} has an unexpected frame count.`);
	return { digest: scapeHex(digest.digest()), size };
}

export function verifyScapeAssetBytes(bytes: Uint8Array, descriptor: ScapeDescriptor, label: string): void {
	verifyScapeExtractedAsset(descriptor, digestScapeBytes(bytes), bytes.byteLength, label);
}

export function verifyScapeExtractedAsset(
	descriptor: ScapeDescriptor,
	digest: string,
	size: number,
	label: string,
): void {
	if (size !== descriptor.size) throw new Error(`${label} has an unexpected size.`);
	if (digest !== descriptor.sha256) throw new Error(`${label} failed SHA-256 verification.`);
}

export function digestScapeBytes(bytes: Uint8Array): string {
	return scapeHex(sha256(bytes));
}

export function createScapeDigest(): DigestWriter {
	return sha256.create();
}

export function scapeHex(bytes: Uint8Array): string {
	return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function toBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('A Scape asset emitted a non-byte chunk.');
}

function assertScapeEntryEmissionWithinSize(
	entry: ScapeArchiveEntry,
	emittedBytes: number,
	chunkBytes: number,
): void {
	if (chunkBytes > entry.uncompressedSize - emittedBytes) {
		throw new Error(`${entry.filename} emitted bytes that do not match its archive metadata.`);
	}
}

function assertScapeEntryEmissionComplete(entry: ScapeArchiveEntry, emittedBytes: number): void {
	if (emittedBytes !== entry.uncompressedSize) {
		throw new Error(`${entry.filename} emitted bytes that do not match its archive metadata.`);
	}
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function float32LittleEndianBytes(channel: Float32Array): Uint8Array {
	if (!(channel instanceof Float32Array)) throw new TypeError('PCM chunks must contain Float32Array channels.');
	if (littleEndianPlatform()) return new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength).slice();
	const bytes = new Uint8Array(channel.byteLength);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < channel.length; index += 1) view.setFloat32(index * 4, channel[index] ?? 0, true);
	return bytes;
}

function littleEndianBytesToFloat32(bytes: Uint8Array): Float32Array {
	const result = new Float32Array(bytes.byteLength / 4);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let index = 0; index < result.length; index += 1) result[index] = view.getFloat32(index * 4, true);
	return result;
}

let isLittleEndian: boolean | undefined;
function littleEndianPlatform(): boolean {
	if (isLittleEndian !== undefined) return isLittleEndian;
	const words = new Uint16Array([0x00ff]);
	isLittleEndian = new Uint8Array(words.buffer)[0] === 0xff;
	return isLittleEndian;
}
