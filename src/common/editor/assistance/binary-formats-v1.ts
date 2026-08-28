/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic binary custody formats for assistance tensors and sampled frames. */

export const ASSISTANCE_EMBEDDING_MATRIX_SCHEMA_VERSION = 1;
export const ASSISTANCE_FRAME_PACK_SCHEMA_VERSION = 1;
export const ASSISTANCE_BINARY_MAXIMUM_BYTES = 512 * 1024 * 1024;
export const ASSISTANCE_FRAME_PACK_MAXIMUM_CHUNK_BYTES = 16 * 1024 * 1024;

const EMBEDDING_MAGIC = new TextEncoder().encode('soundscaper-embedding-matrix-v1\n');
const FRAME_PACK_MAGIC = new TextEncoder().encode('soundscaper-assistance-frame-pack-v1\n');
const EMBEDDING_HEADER_BYTES = EMBEDDING_MAGIC.byteLength + 16;
const FRAME_PACK_HEADER_BYTES = FRAME_PACK_MAGIC.byteLength + 20;
const FRAME_RECORD_HEADER_BYTES = 16;
const FLOAT32_LE_SCALAR = 1;
const MAXIMUM_EMBEDDING_ROWS = 1_000_000;
const MAXIMUM_EMBEDDING_DIMENSIONS = 8_192;
const MAXIMUM_FRAME_COUNT = 100_000;
const MAXIMUM_FRAME_DIMENSION = 4_096;
const MAXIMUM_TIMESCALE = 0x7fff_ffff;
const MAXIMUM_UINT32 = 0xffff_ffff;
const MAXIMUM_TICK = 0x7fff_ffff_ffff_ffffn;
const CANONICAL_TICK = /^(?:0|[1-9]\d*)$/u;
const UNIT_NORM_TOLERANCE = 1e-4;

export interface AssistanceEmbeddingMatrixV1Draft {
	readonly dimensions: number;
	readonly vectors: readonly ArrayLike<number>[];
}

export interface ReviewedAssistanceEmbeddingMatrixV1 {
	readonly schemaVersion: typeof ASSISTANCE_EMBEDDING_MATRIX_SCHEMA_VERSION;
	readonly rowCount: number;
	readonly dimensions: number;
	/** Returns an isolated row copy; callers cannot mutate reviewed custody. */
	readonly vector: (row: number) => Float32Array;
}

export interface AssistanceFramePackV1DraftFrame {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly rgba: Uint8Array;
}

export interface AssistanceFramePackV1Draft {
	readonly width: number;
	readonly height: number;
	readonly timescale: number;
	readonly frames: readonly AssistanceFramePackV1DraftFrame[];
	readonly maximumChunkBytes?: number;
}

export interface AssistanceFramePackV1Frame {
	readonly sourceFrame: number;
	readonly presentationTick: string;
	readonly rgba: Uint8Array;
}

export interface ReviewedAssistanceFramePackV1 {
	readonly schemaVersion: typeof ASSISTANCE_FRAME_PACK_SCHEMA_VERSION;
	readonly width: number;
	readonly height: number;
	readonly timescale: number;
	readonly frameCount: number;
	/** Returns an isolated RGBA copy; callers cannot mutate reviewed custody. */
	readonly frame: (ordinal: number) => AssistanceFramePackV1Frame;
}

/** Encode row-major, little-endian Float32 vectors after enforcing unit L2 norm. */
export function createAssistanceEmbeddingMatrixV1(
	draft: AssistanceEmbeddingMatrixV1Draft,
): Uint8Array<ArrayBuffer> {
	const dimensions = integer(draft?.dimensions, 1, MAXIMUM_EMBEDDING_DIMENSIONS,
		'embedding dimension');
	if (!Array.isArray(draft?.vectors) || draft.vectors.length > MAXIMUM_EMBEDDING_ROWS) {
		throw new RangeError('The embedding row inventory exceeds its exact bound.');
	}
	const byteLength = embeddingByteLength(draft.vectors.length, dimensions);
	const result = new Uint8Array(byteLength);
	result.set(EMBEDDING_MAGIC);
	const header = new DataView(result.buffer, result.byteOffset, result.byteLength);
	header.setUint32(EMBEDDING_MAGIC.byteLength,
		ASSISTANCE_EMBEDDING_MATRIX_SCHEMA_VERSION, true);
	header.setUint32(EMBEDDING_MAGIC.byteLength + 4, draft.vectors.length, true);
	header.setUint32(EMBEDDING_MAGIC.byteLength + 8, dimensions, true);
	header.setUint32(EMBEDDING_MAGIC.byteLength + 12, FLOAT32_LE_SCALAR, true);
	let offset = EMBEDDING_HEADER_BYTES;
	for (const [rowIndex, vector] of draft.vectors.entries()) {
		if (!vector || typeof vector.length !== 'number' || vector.length !== dimensions) {
			throw new RangeError(`Embedding row ${String(rowIndex)} disagrees with its exact dimension.`);
		}
		const row = new Float32Array(dimensions);
		for (let column = 0; column < dimensions; column += 1) {
			const value = vector[column];
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				throw new RangeError(`Embedding row ${String(rowIndex)} contains a non-finite value.`);
			}
			row[column] = value === 0 ? 0 : Math.fround(value);
		}
		assertNormalized(row, rowIndex);
		for (const value of row) {
			header.setFloat32(offset, value, true);
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
	}
	return result;
}

/** Authenticate a complete exact matrix before exposing isolated row copies. */
export function reviewAssistanceEmbeddingMatrixV1(
	value: ArrayBuffer | ArrayBufferView,
): ReviewedAssistanceEmbeddingMatrixV1 {
	const bytes = binary(value, 'embedding matrix');
	if (bytes.byteLength < EMBEDDING_HEADER_BYTES || !hasMagic(bytes, EMBEDDING_MAGIC)) {
		throw new TypeError('The embedding matrix magic or format is unsupported.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = view.getUint32(EMBEDDING_MAGIC.byteLength, true);
	const rowCount = view.getUint32(EMBEDDING_MAGIC.byteLength + 4, true);
	const dimensions = view.getUint32(EMBEDDING_MAGIC.byteLength + 8, true);
	const scalar = view.getUint32(EMBEDDING_MAGIC.byteLength + 12, true);
	if (version !== ASSISTANCE_EMBEDDING_MATRIX_SCHEMA_VERSION || scalar !== FLOAT32_LE_SCALAR) {
		throw new TypeError('The embedding matrix version or scalar format is unsupported.');
	}
	integer(rowCount, 0, MAXIMUM_EMBEDDING_ROWS, 'embedding row count');
	integer(dimensions, 1, MAXIMUM_EMBEDDING_DIMENSIONS, 'embedding dimension');
	if (bytes.byteLength !== embeddingByteLength(rowCount, dimensions)) {
		throw new RangeError('The embedding matrix length is truncated or contains trailing data.');
	}
	const values = new Float32Array(rowCount * dimensions);
	let offset = EMBEDDING_HEADER_BYTES;
	for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
		const row = values.subarray(rowIndex * dimensions, (rowIndex + 1) * dimensions);
		for (let column = 0; column < dimensions; column += 1) {
			const item = view.getFloat32(offset, true);
			if (!Number.isFinite(item) || Object.is(item, -0)) {
				throw new RangeError(`Embedding row ${String(rowIndex)} is noncanonical or non-finite.`);
			}
			row[column] = item;
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
		assertNormalized(row, rowIndex);
	}
	return Object.freeze({
		schemaVersion: ASSISTANCE_EMBEDDING_MATRIX_SCHEMA_VERSION,
		rowCount,
		dimensions,
		vector(rowValue: number): Float32Array {
			const row = integer(rowValue, 0, rowCount - 1, 'embedding row ordinal');
			return values.slice(row * dimensions, (row + 1) * dimensions);
		},
	});
}

/**
 * Encode fixed-geometry RGBA model frames into bounded chunks suitable for the
 * existing assistance data plane. Source ordinals and presentation ticks are
 * independent, so VFR authority is retained exactly.
 */
export function createAssistanceFramePackV1(
	draft: AssistanceFramePackV1Draft,
): readonly Uint8Array[] {
	const width = integer(draft?.width, 1, MAXIMUM_FRAME_DIMENSION, 'frame-pack width');
	const height = integer(draft?.height, 1, MAXIMUM_FRAME_DIMENSION, 'frame-pack height');
	const timescale = integer(draft?.timescale, 1, MAXIMUM_TIMESCALE, 'frame-pack timescale');
	if (!Array.isArray(draft?.frames) || draft.frames.length > MAXIMUM_FRAME_COUNT) {
		throw new RangeError('The frame-pack inventory exceeds its exact bound.');
	}
	const maximumChunkBytes = integer(draft.maximumChunkBytes ?? 1024 * 1024, 1,
		ASSISTANCE_FRAME_PACK_MAXIMUM_CHUNK_BYTES, 'frame-pack chunk bound');
	const rgbaBytes = safeProduct(width, height, 4, 'frame-pack RGBA length');
	framePackByteLength(draft.frames.length, rgbaBytes);
	const writer = new ChunkWriter(maximumChunkBytes);
	writer.write(FRAME_PACK_MAGIC);
	writer.writeUint32(ASSISTANCE_FRAME_PACK_SCHEMA_VERSION);
	writer.writeUint32(width);
	writer.writeUint32(height);
	writer.writeUint32(timescale);
	writer.writeUint32(draft.frames.length);
	let priorSourceFrame = -1;
	let priorTick = -1n;
	for (const [index, candidate] of draft.frames.entries()) {
		const sourceFrame = integer(candidate?.sourceFrame, 0, MAXIMUM_UINT32,
			`frame-pack frame ${String(index)} source ordinal`);
		const tick = canonicalTick(candidate?.presentationTick, `frame-pack frame ${String(index)}`);
		if (sourceFrame <= priorSourceFrame) {
			throw new RangeError('Frame-pack source ordinals must be strictly increasing.');
		}
		if (tick <= priorTick) {
			throw new RangeError('Frame-pack presentation ticks must be strictly increasing.');
		}
		if (!(candidate?.rgba instanceof Uint8Array) || candidate.rgba.byteLength !== rgbaBytes) {
			throw new RangeError(`Frame-pack frame ${String(index)} has an invalid exact RGBA length.`);
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

/** Parse arbitrary bounded chunk splits and retain only an isolated reviewed snapshot. */
export function reviewAssistanceFramePackV1(
	value: Uint8Array | readonly Uint8Array[],
): ReviewedAssistanceFramePackV1 {
	const chunks = framePackChunks(value);
	const cursor = new ChunkCursor(chunks);
	if (!sameBytes(cursor.read(FRAME_PACK_MAGIC.byteLength, 'frame-pack magic'), FRAME_PACK_MAGIC)) {
		throw new TypeError('The assistance frame-pack magic is unsupported.');
	}
	const version = cursor.uint32('frame-pack version');
	if (version !== ASSISTANCE_FRAME_PACK_SCHEMA_VERSION) {
		throw new TypeError('The assistance frame-pack version is unsupported.');
	}
	const width = integer(cursor.uint32('frame-pack width'), 1, MAXIMUM_FRAME_DIMENSION,
		'frame-pack width');
	const height = integer(cursor.uint32('frame-pack height'), 1, MAXIMUM_FRAME_DIMENSION,
		'frame-pack height');
	const timescale = integer(cursor.uint32('frame-pack timescale'), 1, MAXIMUM_TIMESCALE,
		'frame-pack timescale');
	const frameCount = integer(cursor.uint32('frame-pack count'), 0, MAXIMUM_FRAME_COUNT,
		'frame-pack count');
	const rgbaBytes = safeProduct(width, height, 4, 'frame-pack RGBA length');
	const expected = framePackByteLength(frameCount, rgbaBytes);
	if (cursor.totalBytes !== expected) {
		throw new RangeError(cursor.totalBytes < expected
			? 'The assistance frame-pack is truncated.'
			: 'The assistance frame-pack contains trailing data.');
	}
	const frames: AssistanceFramePackV1Frame[] = [];
	let priorSourceFrame = -1;
	let priorTick = -1n;
	for (let index = 0; index < frameCount; index += 1) {
		const sourceFrame = cursor.uint32(`frame-pack frame ${String(index)} source ordinal`);
		const tick = cursor.uint64(`frame-pack frame ${String(index)} presentation tick`);
		const byteLength = cursor.uint32(`frame-pack frame ${String(index)} byte length`);
		if (sourceFrame <= priorSourceFrame) {
			throw new RangeError('Frame-pack source ordinals must be strictly increasing.');
		}
		if (tick <= priorTick) {
			throw new RangeError('Frame-pack presentation ticks must be strictly increasing.');
		}
		if (tick > MAXIMUM_TICK || byteLength !== rgbaBytes) {
			throw new RangeError(`Frame-pack frame ${String(index)} exceeds its timing or RGBA authority.`);
		}
		frames.push(Object.freeze({
			sourceFrame,
			presentationTick: tick.toString(),
			rgba: cursor.read(rgbaBytes, `frame-pack frame ${String(index)} RGBA body`),
		}));
		priorSourceFrame = sourceFrame;
		priorTick = tick;
	}
	if (cursor.remaining !== 0) throw new RangeError('The assistance frame-pack contains trailing data.');
	return Object.freeze({
		schemaVersion: ASSISTANCE_FRAME_PACK_SCHEMA_VERSION,
		width,
		height,
		timescale,
		frameCount,
		frame(ordinalValue: number): AssistanceFramePackV1Frame {
			const ordinal = integer(ordinalValue, 0, frameCount - 1, 'frame-pack frame ordinal');
			const source = frames[ordinal];
			if (!source) throw new RangeError('The assistance frame-pack frame is unavailable.');
			return Object.freeze({
				sourceFrame: source.sourceFrame,
				presentationTick: source.presentationTick,
				rgba: source.rgba.slice(),
			});
		},
	});
}

class ChunkWriter {
	readonly #maximum: number;
	readonly #chunks: Uint8Array[] = [];
	#current: Uint8Array;
	#offset = 0;

	constructor(maximum: number) {
		this.#maximum = maximum;
		this.#current = new Uint8Array(maximum);
	}

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
			const chunk = this.#chunks[this.#chunkIndex];
			if (!chunk) throw new RangeError(`The ${label} is truncated.`);
			const available = chunk.byteLength - this.#chunkOffset;
			const count = Math.min(available, length - resultOffset);
			result.set(chunk.subarray(this.#chunkOffset, this.#chunkOffset + count), resultOffset);
			resultOffset += count;
			this.#chunkOffset += count;
			if (this.#chunkOffset === chunk.byteLength) {
				this.#chunkIndex += 1;
				this.#chunkOffset = 0;
			}
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
			throw new RangeError('The assistance frame-pack exceeds its exact byte bound.');
		}
		// A staged file has already flattened the producer's bounded transport
		// chunks. Its complete authenticated body is still one valid frame pack.
		return Object.freeze([value]);
	}
	const chunks = value;
	if (!Array.isArray(chunks) || chunks.length < 1) {
		throw new TypeError('An assistance frame-pack needs bounded binary chunks.');
	}
	let total = 0;
	for (const chunk of chunks) {
		if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1
			|| chunk.byteLength > ASSISTANCE_FRAME_PACK_MAXIMUM_CHUNK_BYTES) {
			throw new RangeError('An assistance frame-pack chunk exceeds its exact bound.');
		}
		total += chunk.byteLength;
		if (!Number.isSafeInteger(total) || total > ASSISTANCE_BINARY_MAXIMUM_BYTES) {
			throw new RangeError('The assistance frame-pack exceeds its exact byte bound.');
		}
	}
	return chunks;
}

function embeddingByteLength(rowCount: number, dimensions: number): number {
	const byteLength = BigInt(EMBEDDING_HEADER_BYTES)
		+ BigInt(rowCount) * BigInt(dimensions) * BigInt(Float32Array.BYTES_PER_ELEMENT);
	return boundedByteLength(byteLength, 'embedding matrix');
}

function framePackByteLength(frameCount: number, rgbaBytes: number): number {
	const byteLength = BigInt(FRAME_PACK_HEADER_BYTES)
		+ BigInt(frameCount) * (BigInt(FRAME_RECORD_HEADER_BYTES) + BigInt(rgbaBytes));
	return boundedByteLength(byteLength, 'assistance frame-pack');
}

function boundedByteLength(value: bigint, label: string): number {
	if (value > BigInt(ASSISTANCE_BINARY_MAXIMUM_BYTES) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`The ${label} exceeds its exact byte bound.`);
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

function assertNormalized(row: Float32Array, rowIndex: number): void {
	let sum = 0;
	for (const value of row) sum += value * value;
	if (!Number.isFinite(sum) || Math.abs(Math.sqrt(sum) - 1) > UNIT_NORM_TOLERANCE) {
		throw new RangeError(`Embedding row ${String(rowIndex)} is not L2-normalized.`);
	}
}

function binary(value: ArrayBuffer | ArrayBufferView, label: string): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	throw new TypeError(`The ${label} must be exact binary bytes.`);
}

function hasMagic(value: Uint8Array, magic: Uint8Array): boolean {
	return magic.every((byte, index) => value[index] === byte);
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
