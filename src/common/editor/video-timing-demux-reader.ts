/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Bounded random access over a video Blob for the container timing demuxers.
 *
 * A timing probe only needs headers and per-frame index entries, which are tiny
 * beside the media they describe. Reading through ranged slices keeps a probe of
 * a multi-gigabyte source proportional to its index rather than to its bytes,
 * and caps how much any one read may pull into memory.
 */

/** Largest single ranged read a container walker may ask for: 64 MiB. */
export const VIDEO_TIMING_DEMUX_MAXIMUM_READ_BYTES = 64 * 1024 * 1024;

/** Largest number of bytes one probe may read in total: 256 MiB. */
export const VIDEO_TIMING_DEMUX_MAXIMUM_TOTAL_BYTES = 256 * 1024 * 1024;

export interface VideoTimingDemuxReader {
	/** Total size of the source in bytes. */
	readonly byteLength: number;
	/** Read exactly `length` bytes at `offset`, or throw if they are not there. */
	read(offset: number, length: number): Promise<Uint8Array>;
	/** Read up to `length` bytes at `offset`, stopping at the end of the source. */
	readAtMost(offset: number, length: number): Promise<Uint8Array>;
}

export interface VideoTimingDemuxReaderOptions {
	readonly signal?: AbortSignal;
	readonly maximumTotalBytes?: number;
}

class BlobTimingReader implements VideoTimingDemuxReader {
	readonly byteLength: number;

	readonly #blob: Blob;
	readonly #signal: AbortSignal | undefined;
	readonly #maximumTotalBytes: number;
	#totalBytes = 0;

	constructor(blob: Blob, options: VideoTimingDemuxReaderOptions) {
		this.#blob = blob;
		this.byteLength = blob.size;
		this.#signal = options.signal;
		this.#maximumTotalBytes = options.maximumTotalBytes ?? VIDEO_TIMING_DEMUX_MAXIMUM_TOTAL_BYTES;
	}

	async read(offset: number, length: number): Promise<Uint8Array> {
		const bytes = await this.readAtMost(offset, length);
		if (bytes.byteLength !== length) {
			throw new RangeError('The video container ended inside a structure it declared.');
		}
		return bytes;
	}

	async readAtMost(offset: number, length: number): Promise<Uint8Array> {
		throwIfAborted(this.#signal);
		if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
			throw new RangeError('A video container read requires a non-negative safe range.');
		}
		if (length > VIDEO_TIMING_DEMUX_MAXIMUM_READ_BYTES) {
			throw new RangeError('A video container structure exceeds the bounded read size.');
		}
		if (offset >= this.byteLength || length === 0) return new Uint8Array(0);
		const end = Math.min(this.byteLength, offset + length);
		this.#totalBytes += end - offset;
		if (this.#totalBytes > this.#maximumTotalBytes) {
			throw new RangeError('Reading the video container exceeded the bounded timing-probe budget.');
		}
		const buffer = await this.#blob.slice(offset, end).arrayBuffer();
		throwIfAborted(this.#signal);
		return new Uint8Array(buffer);
	}
}

/** Wrap a Blob as the bounded reader the container walkers consume. */
export function createVideoTimingDemuxReader(
	blob: Blob,
	options: VideoTimingDemuxReaderOptions = {},
): VideoTimingDemuxReader {
	if (!(blob instanceof Blob)) throw new TypeError('A video Blob is required for timing demux.');
	return new BlobTimingReader(blob, options);
}

/** Read a big-endian unsigned integer of one to eight bytes. */
export function bigEndianUnsigned(bytes: Uint8Array, start: number, end: number): bigint {
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0
		|| end > bytes.byteLength || end - start < 0 || end - start > 8) {
		throw new RangeError('A container integer must span one to eight readable bytes.');
	}
	let value = 0n;
	for (let offset = start; offset < end; offset += 1) value = value << 8n | BigInt(bytes[offset]!);
	return value;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
