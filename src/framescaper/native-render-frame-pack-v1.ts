/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH,
} from '../common/editor/video-keyframe-encoder-admission.ts';

const MAGIC = new TextEncoder().encode('framescaper-rgba-frame-pack-v1\n');
const FILE_HEADER_BYTES = 59;
const FRAME_HEADER_BYTES = 32;
const DEFAULT_CHUNK_BYTES = 16 * 1024 * 1024;
const MINIMUM_CHUNK_BYTES = 32;

/** Matches the renderer-to-main selected-V20 staging admission. */
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
}

export interface FramescaperNativeRgbaFramePackV1 {
	readonly bytes: Blob;
	readonly byteLength: number;
	readonly sha256: string;
	readonly chunkCount: number;
}

/** Render and collect one canonical selected-V20 carrier without a frame schedule. */
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
		|| typeof request.renderFrame !== 'function') {
		throw new TypeError('Frame-pack production requires cancellation, currentness, and rendering authorities.');
	}
	const frameBytesBig = BigInt(width) * BigInt(height) * 4n;
	if (frameBytesBig > BigInt(VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES)) {
		throw new RangeError('The frame-pack picture exceeds the exact RGBA frame byte domain.');
	}
	const totalBytesBig = BigInt(FILE_HEADER_BYTES)
		+ BigInt(frameCount) * (BigInt(FRAME_HEADER_BYTES) + frameBytesBig);
	if (totalBytesBig > BigInt(FRAMESCAPER_RGBA_FRAME_PACK_MAXIMUM_BYTES)) {
		throw new RangeError('The frame-pack byte domain exceeds the selected V20 16 GiB stage.');
	}
	const totalBytes = Number(totalBytesBig);
	const frameBytes = Number(frameBytesBig);
	const collector = new BoundedBlobCollector(maximumChunkBytes);
	const pixels = new Uint8Array(frameBytes);
	try {
		assertReady(request);
		collector.append(fileHeader(width, height, frameCount, numerator, denominator));
		for (let ordinal = 0; ordinal < frameCount; ordinal += 1) {
			assertReady(request);
			pixels.fill(0);
			await request.renderFrame(ordinal, pixels);
			assertReady(request);
			collector.append(frameHeader(ordinal, frameBytes));
			collector.append(pixels);
		}
		assertReady(request);
		const completed = collector.complete('application/vnd.soundscaper.framescaper-rgba-frame-pack-v1');
		if (completed.bytes.size !== totalBytes || completed.byteLength !== totalBytes) {
			throw new Error('The exact RGBA frame pack completed with an inconsistent byte length.');
		}
		return completed;
	} catch (error) {
		collector.clear();
		throw error;
	} finally {
		pixels.fill(0);
	}
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
	const bytes = new Uint8Array(FILE_HEADER_BYTES);
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
	const bytes = new Uint8Array(FRAME_HEADER_BYTES);
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
