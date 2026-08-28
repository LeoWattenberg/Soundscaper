/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	NATIVE_RGBA_FRAME_PACK_V1_FILE_HEADER_BYTES,
	NATIVE_RGBA_FRAME_PACK_V1_FRAME_HEADER_BYTES,
	nativeRgbaFramePackV1ByteLength,
} from '../common/editor/native-rgba-frame-pack-v1-contract.ts';
import {
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH,
} from '../common/editor/video-keyframe-encoder-admission.ts';

const MAGIC = new TextEncoder().encode('framescaper-rgba-frame-pack-v1\n');
const DEFAULT_CHUNK_BYTES = 16 * 1024 * 1024;
const MINIMUM_CHUNK_BYTES = 32;

/** Matches the renderer-to-main selected-baseline staging admission. */
export const FRAMESCAPER_RGBA_FRAME_PACK_MAXIMUM_BYTES = 16 * 1024 ** 3;

export interface FramescaperNativeRgbaFramePackV1Request {
	readonly width: number;
	readonly height: number;
	readonly frameCount: number;
	readonly frameRate: Readonly<{ readonly num: number; readonly den: number }>;
	readonly maximumChunkBytes?: number;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
	readonly renderFrame: (ordinal: number, output: Uint8Array) => PromiseLike<void> | void;
	readonly createCollector?: FramescaperNativeRgbaFramePackCollectorFactory;
}

export interface FramescaperNativeRgbaFramePackV1 {
	readonly bytes: Blob;
	readonly byteLength: number;
	readonly sha256: string;
	readonly chunkCount: number;
}

export interface FramescaperNativeRgbaFramePackV1StreamResult {
	readonly byteLength: number;
	readonly sha256: string;
	readonly chunkCount: number;
}

export interface FramescaperNativeRgbaFramePackV1Sink {
	write(bytes: Uint8Array): PromiseLike<void> | void;
}

export interface FramescaperNativeRgbaFramePackCollector {
	append(bytes: Uint8Array): PromiseLike<void> | void;
	complete(type: string): PromiseLike<FramescaperNativeRgbaFramePackV1> | FramescaperNativeRgbaFramePackV1;
	clear(): PromiseLike<void> | void;
}

export type FramescaperNativeRgbaFramePackCollectorFactory = (
	maximumChunkBytes: number,
	expectedByteLength: number,
	signal: AbortSignal,
) => PromiseLike<FramescaperNativeRgbaFramePackCollector> | FramescaperNativeRgbaFramePackCollector;

/** Render and collect one canonical selected-baseline carrier without a frame schedule. */
export async function createFramescaperNativeRgbaFramePackV1(
	request: FramescaperNativeRgbaFramePackV1Request,
): Promise<FramescaperNativeRgbaFramePackV1> {
	const width = integer(request.width, 1, VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH, 'frame-pack width');
	const height = integer(request.height, 1, VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT, 'frame-pack height');
	const frameCount = integer(
		request.frameCount, 1, VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT, 'frame-pack count',
	);
	const numerator = integer(request.frameRate?.num, 1, 0xffff_ffff, 'frame-pack rate numerator');
	const denominator = integer(request.frameRate?.den, 1, 0xffff_ffff, 'frame-pack rate denominator');
	const maximumChunkBytes = integer(
		request.maximumChunkBytes ?? DEFAULT_CHUNK_BYTES,
		MINIMUM_CHUNK_BYTES,
		DEFAULT_CHUNK_BYTES,
		'frame-pack chunk bound',
	);
	if (!(request.signal instanceof AbortSignal) || typeof request.assertCurrent !== 'function'
		|| typeof request.renderFrame !== 'function'
		|| (request.createCollector !== undefined && typeof request.createCollector !== 'function')) {
		throw new TypeError('Frame-pack production requires cancellation, currentness, and rendering authorities.');
	}
	const frameBytesBig = BigInt(width) * BigInt(height) * 4n;
	if (frameBytesBig > BigInt(VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES)) {
		throw new RangeError('The frame-pack picture exceeds the exact RGBA frame byte domain.');
	}
	const totalBytes = nativeRgbaFramePackV1ByteLength({ width, height, frameCount });
	if (totalBytes > FRAMESCAPER_RGBA_FRAME_PACK_MAXIMUM_BYTES) {
		throw new RangeError('The frame-pack byte domain exceeds the selected retime 16 GiB stage.');
	}
	const frameBytes = Number(frameBytesBig);
	const collector = request.createCollector
		? await request.createCollector(maximumChunkBytes, totalBytes, request.signal)
		: new BoundedBlobCollector(maximumChunkBytes);
	if (!collector || typeof collector.append !== 'function'
		|| typeof collector.complete !== 'function' || typeof collector.clear !== 'function') {
		throw new TypeError('Frame-pack production received an invalid direct collector.');
	}
	const pixels = new Uint8Array(frameBytes);
	try {
		assertReady(request);
		await collector.append(fileHeader(width, height, frameCount, numerator, denominator));
		for (let ordinal = 0; ordinal < frameCount; ordinal += 1) {
			assertReady(request);
			pixels.fill(0);
			await request.renderFrame(ordinal, pixels);
			assertReady(request);
			await collector.append(frameHeader(ordinal, frameBytes));
			await collector.append(pixels);
		}
		assertReady(request);
		const completed = await collector.complete('application/vnd.soundscaper.framescaper-rgba-frame-pack-v1');
		if (completed.bytes.size !== totalBytes || completed.byteLength !== totalBytes) {
			throw new Error('The exact RGBA frame pack completed with an inconsistent byte length.');
		}
		return completed;
	} catch (error) {
		await collector.clear();
		throw error;
	} finally {
		pixels.fill(0);
	}
}

/** Direct, one-frame-memory production for long-form V14 helper input. */
export async function streamFramescaperNativeRgbaFramePackV1(
	request: FramescaperNativeRgbaFramePackV1Request,
	sinkValue: FramescaperNativeRgbaFramePackV1Sink,
): Promise<FramescaperNativeRgbaFramePackV1StreamResult> {
	const width = integer(request.width, 1, VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH, 'frame-pack width');
	const height = integer(request.height, 1, VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT, 'frame-pack height');
	const frameCount = integer(request.frameCount, 1,
		VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT, 'frame-pack count');
	const numerator = integer(request.frameRate?.num, 1, 0xffff_ffff, 'frame-pack rate numerator');
	const denominator = integer(request.frameRate?.den, 1, 0xffff_ffff, 'frame-pack rate denominator');
	const maximumChunkBytes = integer(request.maximumChunkBytes ?? DEFAULT_CHUNK_BYTES,
		MINIMUM_CHUNK_BYTES, DEFAULT_CHUNK_BYTES, 'frame-pack chunk bound');
	if (!(request.signal instanceof AbortSignal) || typeof request.assertCurrent !== 'function'
		|| typeof request.renderFrame !== 'function' || !sinkValue
		|| typeof sinkValue.write !== 'function') {
		throw new TypeError('Frame-pack streaming requires cancellation, rendering, and one exact sink.');
	}
	const byteLength = nativeRgbaFramePackV1ByteLength({ width, height, frameCount });
	const frameBytes = width * height * 4;
	const hash = sha256.create();
	let chunkCount = 0;
	const write = async (bytes: Uint8Array): Promise<void> => {
		for (let offset = 0; offset < bytes.byteLength; offset += maximumChunkBytes) {
			assertReady(request);
			const part = bytes.subarray(offset, Math.min(bytes.byteLength, offset + maximumChunkBytes));
			hash.update(part); await sinkValue.write(part); chunkCount += 1;
		}
	};
	const pixels = new Uint8Array(frameBytes);
	try {
		await write(fileHeader(width, height, frameCount, numerator, denominator));
		for (let ordinal = 0; ordinal < frameCount; ordinal += 1) {
			assertReady(request); pixels.fill(0); await request.renderFrame(ordinal, pixels);
			await write(frameHeader(ordinal, frameBytes)); await write(pixels);
		}
		assertReady(request);
		return Object.freeze({ byteLength, sha256: bytesToHex(hash.digest()), chunkCount });
	} finally { pixels.fill(0); }
}

class BoundedBlobCollector {
	readonly #maximum: number;
	readonly #hash = sha256.create();
	readonly #parts: Uint8Array<ArrayBuffer>[] = [];
	#current: Uint8Array<ArrayBuffer>;
	#offset = 0;
	#byteLength = 0;
	#complete = false;

	constructor(maximum: number) {
		this.#maximum = maximum;
		this.#current = new Uint8Array(maximum);
	}

	append(bytes: Uint8Array): void {
		if (this.#complete) throw new Error('The frame-pack collector is closed.');
		this.#hash.update(bytes);
		this.#byteLength += bytes.byteLength;
		for (let sourceOffset = 0; sourceOffset < bytes.byteLength;) {
			const count = Math.min(bytes.byteLength - sourceOffset, this.#maximum - this.#offset);
			this.#current.set(bytes.subarray(sourceOffset, sourceOffset + count), this.#offset);
			this.#offset += count;
			sourceOffset += count;
			if (this.#offset === this.#maximum) this.#flush(false);
		}
	}

	complete(type: string): FramescaperNativeRgbaFramePackV1 {
		if (this.#complete) throw new Error('The frame-pack collector is closed.');
		this.#complete = true;
		this.#flush(true);
		const blob = new Blob(this.#parts, { type });
		const result = Object.freeze({
			bytes: blob,
			byteLength: this.#byteLength,
			sha256: bytesToHex(this.#hash.digest()),
			chunkCount: this.#parts.length,
		});
		this.clear();
		return result;
	}

	clear(): void {
		this.#current.fill(0);
		for (const part of this.#parts) part.fill(0);
		this.#parts.length = 0;
		this.#offset = 0;
	}

	#flush(partial: boolean): void {
		if (this.#offset === 0) return;
		const part = partial ? this.#current.slice(0, this.#offset) : this.#current;
		this.#parts.push(part);
		this.#current = new Uint8Array(this.#maximum);
		this.#offset = 0;
	}
}

function fileHeader(
	width: number,
	height: number,
	frameCount: number,
	numerator: number,
	denominator: number,
): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(NATIVE_RGBA_FRAME_PACK_V1_FILE_HEADER_BYTES);
	bytes.set(MAGIC);
	const view = new DataView(bytes.buffer);
	view.setUint32(31, 1, true);
	view.setUint32(35, width, true);
	view.setUint32(39, height, true);
	view.setBigUint64(43, BigInt(frameCount), true);
	// The record timestamps use one output-cadence tick, so its time base is 1/rate.
	view.setUint32(51, denominator, true);
	view.setUint32(55, numerator, true);
	return bytes;
}

function frameHeader(ordinal: number, frameBytes: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(NATIVE_RGBA_FRAME_PACK_V1_FRAME_HEADER_BYTES);
	const view = new DataView(bytes.buffer);
	view.setBigUint64(0, BigInt(ordinal), true);
	view.setBigInt64(8, BigInt(ordinal), true);
	view.setBigInt64(16, 1n, true);
	view.setBigUint64(24, BigInt(frameBytes), true);
	return bytes;
}

function assertReady(request: FramescaperNativeRgbaFramePackV1Request): void {
	if (request.signal.aborted) {
		throw request.signal.reason ?? new DOMException('Frame-pack production was cancelled.', 'AbortError');
	}
	request.assertCurrent();
}

function integer(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} must be an integer from ${String(minimum)} through ${String(maximum)}.`);
	}
	return value;
}
