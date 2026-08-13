/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';

import type {
	FfmpegOutputFileSource,
	FfmpegOutputSink,
} from './ffmpeg-output-stream.ts';
import type { VideoKeyframeEncoderFormat } from './video-keyframe-encoder-admission.ts';

const MAXIMUM_ELEMENTS = 65_536;
const MAXIMUM_READ_BYTES = 1024 * 1024;
const WEBM_EBML = 0x1a45dfa3;
const WEBM_SEGMENT = 0x18538067;
const WEBM_DOCTYPE = 0x4282;
const WEBM_TRACKS = 0x1654ae6b;
const WEBM_CLUSTER = 0x1f43b675;

export interface VideoKeyframeContainerFileEvidence {
	readonly byteLength: number;
	readonly blockBytes: number;
	readonly blockDigests: readonly string[];
	readonly sha256: string;
}

const CONTAINER_FILE_EVIDENCE = new WeakSet<object>();

export async function assertFiniteVideoKeyframeContainerFile(
	source: FfmpegOutputFileSource,
	path: string,
	format: VideoKeyframeEncoderFormat,
	options: Readonly<{
		maximumBytes?: number;
		signal?: AbortSignal;
		assertCurrent?: () => void;
	}> = {},
): Promise<VideoKeyframeContainerFileEvidence> {
	assertReady(options);
	const maximumBytes = options.maximumBytes ?? Number.MAX_SAFE_INTEGER;
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
		throw new RangeError('Video keyframe container maximumBytes must be a positive safe integer.');
	}
	const stat = await source.statFile(path, signalOptions(options.signal));
	assertReady(options);
	if (!Number.isSafeInteger(stat.size) || stat.size <= 0 || stat.size > maximumBytes) {
		throw new RangeError(
			`Video keyframe export output must be 1 through ${String(maximumBytes)} bytes.`,
		);
	}
	const evidence = await captureFileEvidence(source, path, stat.size, options);
	const reader = createReader(source, path, evidence, options);
	if (format === 'mp4') await assertMp4(reader, stat.size);
	else await assertWebm(reader, stat.size);
	assertReady(options);
	CONTAINER_FILE_EVIDENCE.add(evidence);
	return evidence;
}

/** Bind a second bounded read pass to the exact bytes structurally authenticated above. */
export function sourceForVideoKeyframeContainerEvidence(
	source: FfmpegOutputFileSource,
	path: string,
	evidenceValue: VideoKeyframeContainerFileEvidence,
): FfmpegOutputFileSource {
	assertEvidence(evidenceValue);
	const evidence = evidenceValue;
	return Object.freeze({
		async statFile(requestPath: string, options?: Readonly<{ signal?: AbortSignal }>) {
			assertEvidencePath(requestPath, path);
			const stat = await source.statFile(requestPath, options);
			if (!Number.isSafeInteger(stat.size) || stat.size !== evidence.byteLength) {
				throw new Error('Video keyframe output changed size after container validation.');
			}
			return Object.freeze({ size: stat.size });
		},
		async readFileRange(
			requestPath: string,
			offset: number,
			maximumBytes: number,
			options?: Readonly<{ signal?: AbortSignal }>,
		) {
			assertEvidencePath(requestPath, path);
			return source.readFileRange(requestPath, offset, maximumBytes, options);
		},
	});
}

/** Verify the delivery pass before delegating the destination's publishing close. */
export function sinkForVideoKeyframeContainerEvidence<Output>(
	sink: FfmpegOutputSink<Output>,
	evidenceValue: VideoKeyframeContainerFileEvidence,
): FfmpegOutputSink<Output> {
	assertEvidence(evidenceValue);
	const evidence = evidenceValue;
	const digestState = sha256.create();
	let byteLength = 0;
	return Object.freeze({
		async open(exactByteLength: number): Promise<void> {
			if (exactByteLength !== evidence.byteLength) {
				throw new Error('Video keyframe output changed size after container validation.');
			}
			await sink.open(exactByteLength);
		},
		async write(chunk: Uint8Array): Promise<void> {
			if (byteLength + chunk.byteLength > evidence.byteLength) {
				throw new Error('Video keyframe output exceeded its authenticated byte length.');
			}
			digestState.update(chunk);
			byteLength += chunk.byteLength;
			await sink.write(chunk);
		},
		async close(): Promise<Output> {
			if (byteLength !== evidence.byteLength
				|| hex(digestState.digest()) !== evidence.sha256) {
				throw new Error('Video keyframe output bytes changed after container validation.');
			}
			return sink.close();
		},
		async abort(reason?: unknown): Promise<void> {
			await sink.abort(reason);
		},
	});
}

async function captureFileEvidence(
	source: FfmpegOutputFileSource,
	path: string,
	byteLength: number,
	options: Readonly<{ signal?: AbortSignal; assertCurrent?: () => void }>,
): Promise<VideoKeyframeContainerFileEvidence> {
	const blockDigests: string[] = [];
	const fileDigest = sha256.create();
	for (let offset = 0; offset < byteLength; offset += MAXIMUM_READ_BYTES) {
		assertReady(options);
		const requested = Math.min(MAXIMUM_READ_BYTES, byteLength - offset);
		const bytes = await readExactRange(source, path, offset, requested, options.signal);
		assertReady(options);
		blockDigests.push(digest(bytes));
		fileDigest.update(bytes);
	}
	return Object.freeze({
		byteLength,
		blockBytes: MAXIMUM_READ_BYTES,
		blockDigests: Object.freeze(blockDigests),
		sha256: hex(fileDigest.digest()),
	});
}

async function assertMp4(reader: Reader, size: number): Promise<void> {
	let offset = 0;
	let boxes = 0;
	let hasFtyp = false;
	let hasMovie = false;
	let hasMedia = false;
	while (offset < size) {
		boxes += 1;
		if (boxes > MAXIMUM_ELEMENTS || size - offset < 8) invalid('mp4');
		const header = await reader.read(offset, Math.min(16, size - offset));
		const compactSize = uint32(header, 0);
		const type = ascii(header, 4, 4);
		let headerBytes = 8;
		let boxBytes: number;
		if (compactSize === 1) {
			if (header.byteLength < 16) invalid('mp4');
			headerBytes = 16;
			boxBytes = safeBigEndianInteger(header, 8, 8, () => invalid('mp4'));
		} else if (compactSize === 0) boxBytes = size - offset;
		else boxBytes = compactSize;
		if (boxBytes < headerBytes || boxBytes > size - offset) invalid('mp4');
		const payloadBytes = boxBytes - headerBytes;
		if (boxes === 1) {
			if (type !== 'ftyp' || payloadBytes < 8) invalid('mp4');
			hasFtyp = true;
		} else if (type === 'ftyp') invalid('mp4');
		if ((type === 'moov' || type === 'moof') && payloadBytes > 0) hasMovie = true;
		if (type === 'mdat' && payloadBytes > 0) hasMedia = true;
		offset += boxBytes;
	}
	if (!hasFtyp || !hasMovie || !hasMedia || offset !== size) invalid('mp4');
}

async function assertWebm(reader: Reader, size: number): Promise<void> {
	let elements = 0;
	const count = (): void => {
		elements += 1;
		if (elements > MAXIMUM_ELEMENTS) invalid('webm');
	};
	const header = await ebmlElement(reader, 0, size, count);
	if (header.id !== WEBM_EBML || header.payloadBytes === 0) invalid('webm');
	let hasDocType = false;
	await forEachChild(reader, header, count, async (child) => {
		if (child.id === WEBM_DOCTYPE && child.payloadBytes === 4) {
			hasDocType = ascii(await reader.read(child.payloadOffset, 4), 0, 4) === 'webm';
		}
	});
	if (!hasDocType) invalid('webm');
	const segment = await ebmlElement(reader, header.end, size, count);
	if (segment.id !== WEBM_SEGMENT || segment.end !== size) invalid('webm');
	let hasTracks = false;
	let hasCluster = false;
	await forEachChild(reader, segment, count, (child) => {
		if (child.id === WEBM_TRACKS && child.payloadBytes > 0) hasTracks = true;
		if (child.id === WEBM_CLUSTER && child.payloadBytes > 0) hasCluster = true;
	});
	if (!hasTracks || !hasCluster) invalid('webm');
}

interface Element {
	readonly id: number;
	readonly payloadOffset: number;
	readonly payloadBytes: number;
	readonly end: number;
}

async function ebmlElement(reader: Reader, offset: number, limit: number, count: () => void) {
	count();
	const prefix = await reader.read(offset, Math.min(12, limit - offset));
	const id = ebmlVint(prefix, 0, prefix.byteLength, false);
	const size = ebmlVint(prefix, id.length, prefix.byteLength, true);
	if (size.unknown) invalid('webm');
	const payloadOffset = offset + id.length + size.length;
	if (size.value > limit - payloadOffset) invalid('webm');
	return Object.freeze({
		id: id.value,
		payloadOffset,
		payloadBytes: size.value,
		end: payloadOffset + size.value,
	});
}

async function forEachChild(
	reader: Reader,
	parent: Element,
	count: () => void,
	visit: (child: Element) => Promise<void> | void,
): Promise<void> {
	let offset = parent.payloadOffset;
	while (offset < parent.end) {
		const child = await ebmlElement(reader, offset, parent.end, count);
		await visit(child);
		offset = child.end;
	}
	if (offset !== parent.end) invalid('webm');
}

interface Reader { read(offset: number, byteLength: number): Promise<Uint8Array> }

function createReader(
	source: FfmpegOutputFileSource,
	path: string,
	evidence: VideoKeyframeContainerFileEvidence,
	options: Readonly<{ signal?: AbortSignal; assertCurrent?: () => void }>,
): Reader {
	let cachedBlockIndex = -1;
	let cachedBlock: Uint8Array | null = null;
	const loadBlock = async (blockIndex: number): Promise<Uint8Array> => {
		if (cachedBlockIndex === blockIndex && cachedBlock) return cachedBlock;
		assertReady(options);
		const block = await readVerifiedBlock(
			source, path, evidence, blockIndex, signalOptions(options.signal),
		);
		assertReady(options);
		cachedBlockIndex = blockIndex;
		cachedBlock = block;
		return block;
	};
	return Object.freeze({
		async read(offset: number, byteLength: number): Promise<Uint8Array> {
			if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(byteLength)
				|| offset < 0 || byteLength < 1 || byteLength > MAXIMUM_READ_BYTES
				|| byteLength > evidence.byteLength - offset) invalid('webm');
			const result = new Uint8Array(byteLength);
			let resultOffset = 0;
			while (resultOffset < result.byteLength) {
				const absoluteOffset = offset + resultOffset;
				const blockIndex = Math.floor(absoluteOffset / evidence.blockBytes);
				const block = await loadBlock(blockIndex);
				const blockOffset = absoluteOffset % evidence.blockBytes;
				const copied = Math.min(block.byteLength - blockOffset, result.byteLength - resultOffset);
				result.set(block.subarray(blockOffset, blockOffset + copied), resultOffset);
				resultOffset += copied;
			}
			return result;
		},
	});
}

async function readVerifiedBlock(
	source: FfmpegOutputFileSource,
	path: string,
	evidence: VideoKeyframeContainerFileEvidence,
	blockIndex: number,
	options?: Readonly<{ signal?: AbortSignal }>,
): Promise<Uint8Array> {
	const offset = blockIndex * evidence.blockBytes;
	const requested = Math.min(evidence.blockBytes, evidence.byteLength - offset);
	if (!Number.isSafeInteger(blockIndex) || blockIndex < 0 || requested < 1
		|| blockIndex >= evidence.blockDigests.length) {
		throw new Error('Video keyframe output evidence block is outside its admitted file.');
	}
	const bytes = await readExactRange(source, path, offset, requested, options?.signal);
	if (digest(bytes) !== evidence.blockDigests[blockIndex]) {
		throw new Error('Video keyframe output bytes changed after container validation.');
	}
	return bytes;
}

async function readExactRange(
	source: FfmpegOutputFileSource,
	path: string,
	offset: number,
	byteLength: number,
	signal: AbortSignal | undefined,
): Promise<Uint8Array> {
	const value = await source.readFileRange(path, offset, byteLength, signalOptions(signal));
	if (!(value instanceof Uint8Array) || value.byteLength !== byteLength) {
		throw new Error('Video keyframe container validation received an inexact bounded range.');
	}
	return value.slice();
}

function digest(bytes: Uint8Array): string {
	return hex(sha256(bytes));
}

function hex(bytes: Uint8Array): string {
	let result = '';
	for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
	return result;
}

function assertEvidence(value: unknown): asserts value is VideoKeyframeContainerFileEvidence {
	if (!value || typeof value !== 'object' || !CONTAINER_FILE_EVIDENCE.has(value)) {
		throw new TypeError('Authenticated video keyframe container file evidence is required.');
	}
}

function assertEvidencePath(value: string, expected: string): void {
	if (value !== expected) {
		throw new TypeError('Video keyframe output evidence is bound to one exact MEMFS path.');
	}
}

function ebmlVint(bytes: Uint8Array, offset: number, limit: number, isSize: boolean) {
	if (offset >= limit) invalid('webm');
	const first = bytes[offset]!;
	let marker = 0x80;
	let length = 1;
	while (length <= 8 && (first & marker) === 0) { marker >>= 1; length += 1; }
	if (length > (isSize ? 8 : 4) || offset + length > limit) invalid('webm');
	let value = BigInt(isSize ? first & (marker - 1) : first);
	for (let index = 1; index < length; index += 1) {
		value = (value << 8n) | BigInt(bytes[offset + index]!);
	}
	const unknown = isSize && value === (1n << BigInt(7 * length)) - 1n;
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid('webm');
	return Object.freeze({ length, value: Number(value), unknown });
}

function uint32(bytes: Uint8Array, offset: number): number {
	return (bytes[offset]! * 0x1000000) + (bytes[offset + 1]! * 0x10000)
		+ (bytes[offset + 2]! * 0x100) + bytes[offset + 3]!;
}

function safeBigEndianInteger(
	bytes: Uint8Array,
	offset: number,
	length: number,
	invalid_: () => never,
): number {
	let value = 0n;
	for (let index = 0; index < length; index += 1) {
		value = (value << 8n) | BigInt(bytes[offset + index]!);
	}
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid_();
	return Number(value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	let result = '';
	for (let index = 0; index < length; index += 1) {
		const value = bytes[offset + index]!;
		if (value < 0x20 || value > 0x7e) return '';
		result += String.fromCharCode(value);
	}
	return result;
}

function assertReady(options: Readonly<{ signal?: AbortSignal; assertCurrent?: () => void }>): void {
	if (options.signal?.aborted) throw options.signal.reason ?? abortError();
	options.assertCurrent?.();
}

function signalOptions(signal: AbortSignal | undefined): Readonly<{ signal?: AbortSignal }> | undefined {
	return signal ? { signal } : undefined;
}

function invalid(format: VideoKeyframeEncoderFormat): never {
	throw new TypeError(
		`Video keyframe export is not a finite ${format === 'mp4' ? 'MP4' : 'WebM'} container with media structure.`,
	);
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
