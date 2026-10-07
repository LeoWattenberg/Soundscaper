/* SPDX-License-Identifier: AGPL-3.0-only */

/** Retains one bounded borrowed source chunk, with bounded exact header reads. */
export class PhotoPackCursor {
	readonly #iterator: AsyncIterator<Uint8Array>;
	#chunk: Uint8Array = new Uint8Array();
	#offset = 0;
	#received = 0;
	#done = false;
	consumedBytes = 0;

	constructor(source: AsyncIterable<Uint8Array>, readonly maximumBytes: number,
		readonly maximumChunkBytes: number, readonly signal?: AbortSignal) {
		this.#iterator = source[Symbol.asyncIterator]();
	}

	async hasBytes(): Promise<boolean> {
		this.signal?.throwIfAborted();
		if (this.#offset < this.#chunk.byteLength) return true;
		if (this.#done) return false;
		const next = await this.#iterator.next();
		this.signal?.throwIfAborted();
		if (next.done) { this.#done = true; this.#chunk = new Uint8Array(); return false; }
		const chunk = next.value;
		if (!(chunk instanceof Uint8Array) || Object.getPrototypeOf(chunk) !== Uint8Array.prototype
			|| ['buffer', 'byteLength', 'byteOffset', 'length'].some((key) => Object.hasOwn(chunk, key))) {
			throw new TypeError('Photo pack source requires intrinsic byte chunks.');
		}
		if (!(chunk.buffer instanceof ArrayBuffer) || Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get?.call(chunk.buffer) === true) {
			throw new TypeError('Photo pack source requires fixed byte buffers.');
		}
		if (chunk.byteLength < 1 || chunk.byteLength > this.maximumChunkBytes) {
			throw new RangeError('Photo pack source chunk exceeds its bounded chunk limit.');
		}
		this.#received += chunk.byteLength;
		if (this.#received > this.maximumBytes) throw new RangeError('Photo pack exceeds its pack byte limit.');
		// Borrow the bytes through our own intrinsic view; caller methods and
		// constructor species must never participate in subsequent slicing.
		this.#chunk = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength); this.#offset = 0;
		return true;
	}

	async take(maximum: number): Promise<Uint8Array> {
		if (!await this.hasBytes()) throw new RangeError('Photo pack record is truncated.');
		const length = Math.min(maximum, this.#chunk.byteLength - this.#offset);
		const result = this.#chunk.subarray(this.#offset, this.#offset + length);
		this.#offset += length; this.consumedBytes += length;
		return result;
	}

	async exact(length: number): Promise<Uint8Array<ArrayBuffer>> {
		const result = new Uint8Array(length);
		let offset = 0;
		while (offset < length) {
			const chunk = await this.take(length - offset);
			result.set(chunk, offset); offset += chunk.byteLength;
		}
		return result;
	}

	async close(): Promise<void> {
		this.#chunk = new Uint8Array();
		if (!this.#done) await this.#iterator.return?.();
		this.#done = true;
	}
}
