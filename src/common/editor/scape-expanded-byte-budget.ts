/* SPDX-License-Identifier: AGPL-3.0-only */

export const SCAPE_MAXIMUM_AUDIO_CHUNKS = 65_536;

/** One cumulative counter for semantic PCM chunks across an entire archive. */
export class ScapeAudioChunkBudget {
	readonly #maximumChunks: number;
	#usedChunks = 0;

	constructor(maximumChunks = SCAPE_MAXIMUM_AUDIO_CHUNKS) {
		if (!Number.isSafeInteger(maximumChunks) || maximumChunks < 1) {
			throw new RangeError('The Scape audio-chunk limit must be a positive safe integer.');
		}
		if (maximumChunks > SCAPE_MAXIMUM_AUDIO_CHUNKS) {
			throw new RangeError('The Scape audio-chunk limit cannot exceed the hard limit.');
		}
		this.#maximumChunks = maximumChunks;
	}

	get maximumChunks(): number {
		return this.#maximumChunks;
	}

	get usedChunks(): number {
		return this.#usedChunks;
	}

	consume(label: string): void {
		this.consumeMany(1, label);
	}

	consumeMany(chunkCount: number, label: string): void {
		if (!Number.isSafeInteger(chunkCount) || chunkCount < 0) {
			throw new RangeError(`Audio source ${label} has an invalid Scape PCM chunk count.`);
		}
		if (chunkCount > this.#maximumChunks - this.#usedChunks) {
			throw new RangeError(`Audio source ${label} exceeds the Scape archive PCM chunk limit.`);
		}
		this.#usedChunks += chunkCount;
	}
}

/** One cumulative counter for bytes actually emitted by every archive entry. */
export class ScapeExpandedByteBudget {
	readonly #maximumBytes: number;
	#usedBytes = 0;

	constructor(maximumBytes: number) {
		if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
			throw new RangeError('The Scape actual expanded-byte limit must be a positive safe integer.');
		}
		this.#maximumBytes = maximumBytes;
	}

	get maximumBytes(): number {
		return this.#maximumBytes;
	}

	get usedBytes(): number {
		return this.#usedBytes;
	}

	consume(byteLength: number, label: string): void {
		if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
			throw new RangeError(`The Scape entry ${label} emitted an invalid byte count.`);
		}
		if (byteLength > this.#maximumBytes - this.#usedBytes) {
			throw new RangeError('The Scape archive exceeds the cumulative actual expanded-byte limit.');
		}
		this.#usedBytes += byteLength;
	}
}
