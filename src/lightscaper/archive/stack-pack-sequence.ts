/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoStackV1, type PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { measurePhotoStackPackRecordV1, PHOTO_STACK_PACK_LIMITS_V1 as LIMITS } from './stack-pack.ts';

/** One normalized record of lookahead, never a whole stack catalog. */
export class PhotoStackPackSequence {
	readonly #iterator: AsyncIterator<PhotoStackV1> | Iterator<PhotoStackV1>;
	#pending: Readonly<{ stack: PhotoStackV1; bytes: number }> | null = null;
	#done = false;
	#active = false;
	constructor(source: Iterable<PhotoStackV1> | AsyncIterable<PhotoStackV1>, readonly admit: (stack: PhotoStackV1) => void,
		readonly signal?: AbortSignal) {
		this.#iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
	}
	async nextPack(): Promise<AsyncIterable<PhotoStackV1> | null> {
		if (this.#active) throw new Error('Drain the previous stack pack before requesting another.');
		this.#pending ??= await this.#readNext(); if (!this.#pending) return null;
		this.#active = true; return this.#records();
	}
	async close(): Promise<void> {
		this.#pending = null; if (!this.#done) await this.#iterator.return?.(); this.#done = true;
	}
	async *#records(): AsyncGenerator<PhotoStackV1> {
		let bytes = 8, count = 0;
		try {
			while (this.#pending) {
				if (count >= LIMITS.maximumRecords || bytes + this.#pending.bytes > LIMITS.maximumPackBytes) break;
				const record = this.#pending; this.#pending = null; count += 1; bytes += record.bytes;
				yield record.stack; this.#pending = await this.#readNext();
			}
		} finally { this.#active = false; }
	}
	async #readNext(): Promise<Readonly<{ stack: PhotoStackV1; bytes: number }> | null> {
		this.signal?.throwIfAborted(); if (this.#done) return null;
		const next = await this.#iterator.next(); this.signal?.throwIfAborted();
		if (next.done) { this.#done = true; return null; }
		const stack = normalizePhotoStackV1(next.value), bytes = measurePhotoStackPackRecordV1(stack);
		this.admit(stack); return { stack, bytes };
	}
}
