/* SPDX-License-Identifier: AGPL-3.0-only */

/** Visual frame custody with independent semantic-source and model-raster geometry. */

import {
	ASSISTANCE_BINARY_MAXIMUM_BYTES,
	ASSISTANCE_FRAME_PACK_MAXIMUM_CHUNK_BYTES,
	reviewAssistanceFramePackV1,
} from './binary-formats-v1.ts';

export const ASSISTANCE_VISUAL_FRAME_PACK_SCHEMA_VERSION = 2 as const;

const MAGIC = new TextEncoder().encode('soundscaper-assistance-frame-pack-v2\n');
const HEADER_BYTES = MAGIC.byteLength + 28;
const FRAME_HEADER_BYTES = 16;
const MAXIMUM_FRAME_COUNT = 100_000;
const MAXIMUM_DIMENSION = 4_096;
const MAXIMUM_TIMESCALE = 0x7fff_ffff;
const MAXIMUM_UINT32 = 0xffff_ffff;
const MAXIMUM_TICK = 0x7fff_ffff_ffff_ffffn;
const CANONICAL_TICK = /^(?:0|[1-9]\d*)$/u;

export interface AssistanceVisualFramePackV2FrameDraft {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly rgba: Uint8Array;
}

export interface AssistanceVisualFramePackV2Draft {
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly rasterWidth: number;
	readonly rasterHeight: number;
	readonly timescale: number;
	readonly frames: readonly AssistanceVisualFramePackV2FrameDraft[];
	readonly maximumChunkBytes?: number;
}

export interface AssistanceVisualFramePackFrame {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly rgba: Uint8Array;
}

export interface AssistanceVisualFramePackTiming {
	readonly sourceFrame: number;
	readonly presentationTick: string;
}

export interface ReviewedAssistanceVisualFramePack {
	readonly schemaVersion: 1 | typeof ASSISTANCE_VISUAL_FRAME_PACK_SCHEMA_VERSION;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly rasterWidth: number;
	readonly rasterHeight: number;
	readonly timescale: number;
	readonly frameCount: number;
	/** Returns timing metadata without copying the RGBA body. */
	readonly frameTiming: (ordinal: number) => AssistanceVisualFramePackTiming;
	/** Returns an isolated RGBA copy; callers cannot mutate reviewed custody. */
	readonly frame: (ordinal: number) => AssistanceVisualFramePackFrame;
}

export interface ReviewedAssistanceVisualFramePackV2 extends ReviewedAssistanceVisualFramePack {
	readonly schemaVersion: typeof ASSISTANCE_VISUAL_FRAME_PACK_SCHEMA_VERSION;
}

/** Encode RGBA rasters while retaining their independent full-source semantic geometry. */
export function createAssistanceVisualFramePackV2(
	draft: AssistanceVisualFramePackV2Draft,
): readonly Uint8Array[] {
	const sourceWidth = integer(draft?.sourceWidth, 1, MAXIMUM_DIMENSION,
		'visual frame-pack source width');
	const sourceHeight = integer(draft?.sourceHeight, 1, MAXIMUM_DIMENSION,
		'visual frame-pack source height');
	const rasterWidth = integer(draft?.rasterWidth, 1, MAXIMUM_DIMENSION,
		'visual frame-pack raster width');
	const rasterHeight = integer(draft?.rasterHeight, 1, MAXIMUM_DIMENSION,
		'visual frame-pack raster height');
	const timescale = integer(draft?.timescale, 1, MAXIMUM_TIMESCALE,
		'visual frame-pack timescale');
	if (!Array.isArray(draft?.frames) || draft.frames.length > MAXIMUM_FRAME_COUNT) {
		throw new RangeError('The visual frame-pack inventory exceeds its exact bound.');
	}
	const maximumChunkBytes = integer(draft.maximumChunkBytes ?? 1024 * 1024, 1,
		ASSISTANCE_FRAME_PACK_MAXIMUM_CHUNK_BYTES, 'visual frame-pack chunk bound');
	const rgbaBytes = safeProduct(rasterWidth, rasterHeight, 4,
		'visual frame-pack RGBA length');
	framePackByteLength(draft.frames.length, rgbaBytes);
	const writer = new ChunkWriter(maximumChunkBytes);
	writer.write(MAGIC);
	writer.writeUint32(ASSISTANCE_VISUAL_FRAME_PACK_SCHEMA_VERSION);
	writer.writeUint32(sourceWidth);
	writer.writeUint32(sourceHeight);
	writer.writeUint32(rasterWidth);
	writer.writeUint32(rasterHeight);
	writer.writeUint32(timescale);
	writer.writeUint32(draft.frames.length);
	let priorSourceFrame = -1;
	let priorTick = -1n;
	for (const [index, candidate] of draft.frames.entries()) {
		const sourceFrame = integer(candidate?.sourceFrame, 0, MAXIMUM_UINT32,
			`visual frame-pack frame ${String(index)} source ordinal`);
		const tick = canonicalTick(candidate?.presentationTick,
			`visual frame-pack frame ${String(index)}`);
		if (sourceFrame <= priorSourceFrame) {
			throw new RangeError('Visual frame-pack source ordinals must be strictly increasing.');
		}
		if (tick <= priorTick) {
			throw new RangeError('Visual frame-pack presentation ticks must be strictly increasing.');
		}
		if (!(candidate?.rgba instanceof Uint8Array) || candidate.rgba.byteLength !== rgbaBytes) {
			throw new RangeError(
				`Visual frame-pack frame ${String(index)} has an invalid exact RGBA length.`,
			);
		}
		writer.writeUint32(sourceFrame);
		writer.writeUint64(tick);
		writer.writeUint32(rgbaBytes);
		writer.write(candidate.rgba);
		priorSourceFrame = sourceFrame;
		priorTick = tick;
	}
	return writer.complete();
}

/** Strictly review v2 bytes and retain an isolated, immutable metadata/body snapshot. */
export function reviewAssistanceVisualFramePackV2(
	value: Uint8Array | readonly Uint8Array[],
): ReviewedAssistanceVisualFramePackV2 {
	const cursor = new ChunkCursor(framePackChunks(value));
	if (!sameBytes(cursor.read(MAGIC.byteLength, 'visual frame-pack magic'), MAGIC)) {
		throw new TypeError('The visual frame-pack magic is unsupported.');
	}
	if (cursor.uint32('visual frame-pack version') !== ASSISTANCE_VISUAL_FRAME_PACK_SCHEMA_VERSION) {
		throw new TypeError('The visual frame-pack version is unsupported.');
	}
	const sourceWidth = integer(cursor.uint32('visual frame-pack source width'), 1,
		MAXIMUM_DIMENSION, 'visual frame-pack source width');
	const sourceHeight = integer(cursor.uint32('visual frame-pack source height'), 1,
		MAXIMUM_DIMENSION, 'visual frame-pack source height');
	const rasterWidth = integer(cursor.uint32('visual frame-pack raster width'), 1,
		MAXIMUM_DIMENSION, 'visual frame-pack raster width');
	const rasterHeight = integer(cursor.uint32('visual frame-pack raster height'), 1,
		MAXIMUM_DIMENSION, 'visual frame-pack raster height');
	const timescale = integer(cursor.uint32('visual frame-pack timescale'), 1,
		MAXIMUM_TIMESCALE, 'visual frame-pack timescale');
	const frameCount = integer(cursor.uint32('visual frame-pack count'), 0,
		MAXIMUM_FRAME_COUNT, 'visual frame-pack count');
	const rgbaBytes = safeProduct(rasterWidth, rasterHeight, 4,
		'visual frame-pack RGBA length');
	const expected = framePackByteLength(frameCount, rgbaBytes);
	if (cursor.totalBytes !== expected) {
		throw new RangeError(cursor.totalBytes < expected
			? 'The visual frame-pack is truncated.'
			: 'The visual frame-pack contains trailing data.');
	}
	const frames: AssistanceVisualFramePackFrame[] = [];
	let priorSourceFrame = -1;
	let priorTick = -1n;
	for (let index = 0; index < frameCount; index += 1) {
		const sourceFrame = cursor.uint32(`visual frame-pack frame ${String(index)} source ordinal`);
		const tick = cursor.uint64(`visual frame-pack frame ${String(index)} presentation tick`);
		const byteLength = cursor.uint32(`visual frame-pack frame ${String(index)} byte length`);
		if (sourceFrame <= priorSourceFrame) {
			throw new RangeError('Visual frame-pack source ordinals must be strictly increasing.');
		}
		if (tick <= priorTick) {
			throw new RangeError('Visual frame-pack presentation ticks must be strictly increasing.');
		}
		if (tick > MAXIMUM_TICK || byteLength !== rgbaBytes) {
			throw new RangeError(
				`Visual frame-pack frame ${String(index)} exceeds its timing or RGBA authority.`,
			);
		}
		frames.push(Object.freeze({ sourceFrame, presentationTick: tick.toString(),
			rgba: cursor.read(rgbaBytes, `visual frame-pack frame ${String(index)} RGBA body`) }));
		priorSourceFrame = sourceFrame;
		priorTick = tick;
	}
	if (cursor.remaining !== 0) throw new RangeError('The visual frame-pack contains trailing data.');
	return reviewedPack(ASSISTANCE_VISUAL_FRAME_PACK_SCHEMA_VERSION, sourceWidth, sourceHeight,
		rasterWidth, rasterHeight, timescale, frames);
}

/** Review either legacy v1 or visual v2 bytes into one explicit geometry contract. */
export function reviewAssistanceVisualFramePack(
	value: Uint8Array | readonly Uint8Array[],
): ReviewedAssistanceVisualFramePack {
	if (startsWith(value, MAGIC)) return reviewAssistanceVisualFramePackV2(value);
	const legacy = reviewAssistanceFramePackV1(value);
	return Object.freeze({ schemaVersion: legacy.schemaVersion,
		sourceWidth: legacy.width, sourceHeight: legacy.height,
		rasterWidth: legacy.width, rasterHeight: legacy.height,
		timescale: legacy.timescale, frameCount: legacy.frameCount,
		frameTiming: (ordinal: number) => legacy.frameTiming(ordinal),
		frame: (ordinal: number) => legacy.frame(ordinal) });
}

function reviewedPack(
	schemaVersion: 2,
	sourceWidth: number,
	sourceHeight: number,
	rasterWidth: number,
	rasterHeight: number,
	timescale: number,
	frames: readonly AssistanceVisualFramePackFrame[],
): ReviewedAssistanceVisualFramePackV2 {
	return Object.freeze({ schemaVersion, sourceWidth, sourceHeight, rasterWidth, rasterHeight,
		timescale, frameCount: frames.length,
		frameTiming(ordinalValue: number) {
			const ordinal = integer(ordinalValue, 0, frames.length - 1,
				'visual frame-pack frame ordinal');
			const source = frames[ordinal]!;
			return Object.freeze({ sourceFrame: source.sourceFrame,
				presentationTick: source.presentationTick });
		},
		frame(ordinalValue: number) {
			const ordinal = integer(ordinalValue, 0, frames.length - 1,
				'visual frame-pack frame ordinal');
			const source = frames[ordinal]!;
			return Object.freeze({ sourceFrame: source.sourceFrame,
				presentationTick: source.presentationTick, rgba: source.rgba.slice() });
		},
	});
}

class ChunkWriter {
	readonly #maximum: number;
	readonly #chunks: Uint8Array[] = [];
	#current: Uint8Array;
	#offset = 0;

	constructor(maximum: number) { this.#maximum = maximum; this.#current = new Uint8Array(maximum); }

	write(value: Uint8Array): void {
		let sourceOffset = 0;
		while (sourceOffset < value.byteLength) {
			if (this.#offset === this.#maximum) this.#flush();
			const length = Math.min(value.byteLength - sourceOffset, this.#maximum - this.#offset);
			this.#current.set(value.subarray(sourceOffset, sourceOffset + length), this.#offset);
			this.#offset += length;
			sourceOffset += length;
		}
	}

	writeUint32(value: number): void {
		const bytes = new Uint8Array(4);
		new DataView(bytes.buffer).setUint32(0, value, true);
		this.write(bytes);
	}

	writeUint64(value: bigint): void {
		const bytes = new Uint8Array(8);
		new DataView(bytes.buffer).setBigUint64(0, value, true);
		this.write(bytes);
	}

	complete(): readonly Uint8Array[] {
		if (this.#offset > 0) this.#flush();
		return Object.freeze(this.#chunks);
	}

	#flush(): void {
		this.#chunks.push(this.#current.slice(0, this.#offset));
		this.#current = new Uint8Array(this.#maximum);
		this.#offset = 0;
	}
}

class ChunkCursor {
	readonly #chunks: readonly Uint8Array[];
	#chunkIndex = 0;
	#chunkOffset = 0;
	#remaining: number;
	readonly totalBytes: number;

	constructor(chunks: readonly Uint8Array[]) {
		this.#chunks = chunks;
		this.totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
		this.#remaining = this.totalBytes;
	}

	get remaining(): number { return this.#remaining; }

	read(length: number, label: string): Uint8Array {
		if (!Number.isSafeInteger(length) || length < 0 || length > this.#remaining) {
			throw new RangeError(`The ${label} is truncated.`);
		}
		const result = new Uint8Array(length);
		let resultOffset = 0;
		while (resultOffset < length) {
			const chunk = this.#chunks[this.#chunkIndex]!;
			const available = chunk.byteLength - this.#chunkOffset;
			const count = Math.min(available, length - resultOffset);
			result.set(chunk.subarray(this.#chunkOffset, this.#chunkOffset + count), resultOffset);
			resultOffset += count;
			this.#chunkOffset += count;
			if (this.#chunkOffset === chunk.byteLength) { this.#chunkIndex += 1; this.#chunkOffset = 0; }
		}
		this.#remaining -= length;
		return result;
	}

	uint32(label: string): number {
		const bytes = this.read(4, label);
		return new DataView(bytes.buffer).getUint32(0, true);
	}

	uint64(label: string): bigint {
		const bytes = this.read(8, label);
		return new DataView(bytes.buffer).getBigUint64(0, true);
	}
}

function framePackChunks(value: Uint8Array | readonly Uint8Array[]): readonly Uint8Array[] {
	if (value instanceof Uint8Array) {
		if (value.byteLength < 1 || value.byteLength > ASSISTANCE_BINARY_MAXIMUM_BYTES) {
			throw new RangeError('The visual frame-pack exceeds its exact byte bound.');
		}
		return Object.freeze([value]);
	}
	if (!Array.isArray(value) || value.length < 1) {
		throw new TypeError('A visual frame-pack needs bounded binary chunks.');
	}
	let total = 0;
	for (const chunk of value) {
		if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1
			|| chunk.byteLength > ASSISTANCE_FRAME_PACK_MAXIMUM_CHUNK_BYTES) {
			throw new RangeError('A visual frame-pack chunk exceeds its exact bound.');
		}
		total += chunk.byteLength;
		if (!Number.isSafeInteger(total) || total > ASSISTANCE_BINARY_MAXIMUM_BYTES) {
			throw new RangeError('The visual frame-pack exceeds its exact byte bound.');
		}
	}
	return value;
}

function startsWith(value: Uint8Array | readonly Uint8Array[], prefix: Uint8Array): boolean {
	const chunks = value instanceof Uint8Array ? [value] : value;
	if (!Array.isArray(chunks)) return false;
	let compared = 0;
	for (const chunk of chunks) {
		if (!(chunk instanceof Uint8Array)) return false;
		for (const byte of chunk) {
			if (compared === prefix.byteLength) return true;
			if (byte !== prefix[compared]) return false;
			compared += 1;
		}
	}
	return compared === prefix.byteLength;
}

function framePackByteLength(frameCount: number, rgbaBytes: number): number {
	const value = BigInt(HEADER_BYTES)
		+ BigInt(frameCount) * (BigInt(FRAME_HEADER_BYTES) + BigInt(rgbaBytes));
	if (value > BigInt(ASSISTANCE_BINARY_MAXIMUM_BYTES) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('The visual frame-pack exceeds its exact byte bound.');
	}
	return Number(value);
}

function safeProduct(left: number, middle: number, right: number, label: string): number {
	const result = BigInt(left) * BigInt(middle) * BigInt(right);
	if (result > BigInt(Number.MAX_SAFE_INTEGER) || result > BigInt(MAXIMUM_UINT32)) {
		throw new RangeError(`The ${label} exceeds its exact integer bound.`);
	}
	return Number(result);
}

function canonicalTick(value: unknown, label: string): bigint {
	if (typeof value !== 'string' || !CANONICAL_TICK.test(value)) {
		throw new RangeError(`The ${label} presentation tick is noncanonical.`);
	}
	const tick = BigInt(value);
	if (tick > MAXIMUM_TICK) throw new RangeError(`The ${label} presentation tick is oversized.`);
	return tick;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is outside its exact integer bound.`);
	}
	return Number(value);
}
