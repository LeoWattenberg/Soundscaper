/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';

import type { ScapeArchiveEntry, ScapeDescriptor } from './scape-archive-envelope.ts';
import { awaitScapeOperation, throwIfScapeAborted } from './scape-abort.ts';

interface DigestWriter {
	update(bytes: Uint8Array): unknown;
	digest(): Uint8Array;
}

interface ScapeAudioSource {
	readonly id: string;
	readonly storageKey?: string;
	readonly name?: string;
	readonly channelCount: number;
	readonly frameCount: number;
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

export interface ScapeExtractedBlob extends ScapeExtractedAsset {
	readonly blob: Blob;
}

export function safeScapeEntryId(value: unknown): string {
	return encodeURIComponent(String(value || '')).replaceAll('%', '_');
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
): ReadableStream<Uint8Array> {
	throwIfScapeAborted(signal);
	const iterator = store.readSourceChunks(
		source.storageKey || source.id,
		{ signal },
	)[Symbol.asyncIterator]();
	let queue: Uint8Array[] = [];
	let iteratorClosed = false;
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
					const frameCount = channels[0]?.length ?? 0;
					if (!channels.every((channel) => channel.length === frameCount)) {
						throw new Error(`Stored PCM for ${source.id} is not aligned.`);
					}
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

export async function extractScapeBlob(
	entry: ScapeArchiveEntry,
	mimeType: string,
	signal?: AbortSignal,
): Promise<ScapeExtractedBlob> {
	if (typeof entry.getData !== 'function') throw new Error(`The .scape archive is missing ${entry.filename}.`);
	const digest = sha256.create();
	const chunks: ArrayBuffer[] = [];
	let size = 0;
	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			throwIfScapeAborted(signal);
			const bytes = toBytes(chunk).slice();
			digest.update(bytes);
			size += bytes.byteLength;
			chunks.push(exactArrayBuffer(bytes));
		},
	});
	await awaitScapeOperation(entry.getData(writable, { signal, strictness: 'strict' }), signal);
	return {
		blob: new Blob(chunks, { type: mimeType || 'application/octet-stream' }),
		digest: scapeHex(digest.digest()),
		size,
	};
}

export async function extractScapeAudio(
	entry: ScapeArchiveEntry,
	sourceWriter: ScapeSourceWriter,
	source: ScapeAudioSource,
	signal?: AbortSignal,
): Promise<ScapeExtractedAsset> {
	if (typeof entry.getData !== 'function') throw new Error(`The .scape archive is missing ${entry.filename}.`);
	const digest = sha256.create();
	let size = 0;
	let pending = new Uint8Array(0);
	let writtenFrames = 0;
	const writable = new WritableStream<Uint8Array>({
		async write(chunk) {
			throwIfScapeAborted(signal);
			const bytes = toBytes(chunk);
			digest.update(bytes);
			size += bytes.byteLength;
			pending = concatBytes(pending, bytes);
			while (pending.byteLength >= 4) {
				throwIfScapeAborted(signal);
				const frameCount = new DataView(pending.buffer, pending.byteOffset, 4).getUint32(0, true);
				if (!frameCount) throw new Error(`Audio source ${source.id} contains an empty chunk.`);
				const chunkBytes = 4 + frameCount * source.channelCount * Float32Array.BYTES_PER_ELEMENT;
				if (pending.byteLength < chunkBytes) break;
				const channels: Float32Array[] = [];
				let offset = 4;
				for (let channel = 0; channel < source.channelCount; channel += 1) {
					channels.push(littleEndianBytesToFloat32(pending.subarray(offset, offset + frameCount * 4)));
					offset += frameCount * 4;
				}
				await sourceWriter.write(channels, { signal });
				throwIfScapeAborted(signal);
				writtenFrames += frameCount;
				pending = pending.slice(chunkBytes);
			}
		},
	});
	await awaitScapeOperation(entry.getData(writable, { signal, strictness: 'strict' }), signal);
	if (pending.byteLength) throw new Error(`Audio source ${source.id} ends with an incomplete chunk.`);
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
	throw new TypeError('A .scape asset emitted a non-byte chunk.');
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
	const result = new Uint8Array(left.byteLength + right.byteLength);
	result.set(left);
	result.set(right, left.byteLength);
	return result;
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
