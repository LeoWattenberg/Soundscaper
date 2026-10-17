/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { preparePhotoSmartCollectionPackRecordV1, PHOTO_SMART_COLLECTION_PACK_LIMITS_V1 as LIMITS } from './smart-collection-pack-v1.ts';

type Source = Iterable<PhotoSmartCollectionV1> | AsyncIterable<PhotoSmartCollectionV1>;
type Iterator = AsyncIterator<PhotoSmartCollectionV1> | globalThis.Iterator<PhotoSmartCollectionV1>;
type Prepared = ReturnType<typeof preparePhotoSmartCollectionPackRecordV1>;
const nativeThrow = AbortSignal.prototype.throwIfAborted;
const NativeAbortController = AbortController;
const nativeAbort = NativeAbortController.prototype.abort;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** One canonical current recipe plus one boundary lookahead; byte measurement retains only a scalar. */
export class PhotoSmartCollectionPackSequence {
	#source: Source | null;
	#iterator: Iterator | null = null;
	#pending: Prepared | null = null;
	#opening: Promise<AsyncIterable<PhotoSmartCollectionV1> | null> | null = null;
	#next: Promise<IteratorResult<PhotoSmartCollectionV1>> | null = null;
	#pack: AsyncGenerator<PhotoSmartCollectionV1> | null = null;
	#active = false;
	#done = false;
	#closed = false;
	#closing: Promise<void> | null = null;
	#returning: Promise<void> | null = null;
	readonly #stop = new NativeAbortController();

	constructor(source: Source, readonly admit: (definition: PhotoSmartCollectionV1) => void, readonly signal?: AbortSignal) {
		if (typeof admit !== 'function') throw new TypeError('Saved pack sequence requires an identity admission callback.');
		if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
		this.#source = source;
	}

	nextPack(): Promise<AsyncIterable<PhotoSmartCollectionV1> | null> {
		if (this.#closed) return Promise.reject(new Error('Smart collection pack sequence is closed.'));
		if (this.#active || this.#opening !== null) return Promise.reject(new Error('Drain the previous or pending smart collection pack first.'));
		// Register ownership before native next/admission can reenter or await.
		const task = Promise.resolve().then(async () => {
			try {
				this.#pending ??= await this.#readNext(); this.#check();
				if (!this.#pending) return null;
				this.#active = true; const pack = this.#records(); this.#pack = pack; return pack;
			} catch (error) {
				this.#retire(); try { await this.#returnSource(); } catch (cleanup) { throw combined(error, cleanup, this.signal); } throw error;
			}
		}).finally(() => { if (this.#opening === task) this.#opening = null; });
		this.#opening = task; return task;
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#retire();
		const opening = this.#opening;
		this.#closing = Promise.resolve().then(async () => {
			// Never call return concurrently with an unsettled next, including native owners that ignore abort.
			await opening?.catch(() => {}); await this.#next?.catch(() => {});
			const pack = this.#pack; this.#pack = null;
			let failed = false, failure: unknown;
			try { await pack?.return(undefined); } catch (error) { failed = true; failure = error; }
			try { await this.#returnSource(); } catch (cleanup) { if (failed && failure !== cleanup) throw combined(failure, cleanup, this.signal); throw cleanup; }
			if (failed) throw failure;
		});
		return this.#closing;
	}

	async *#records(): AsyncGenerator<PhotoSmartCollectionV1> {
		let bytes = 8, count = 0, completed = false, failed = false, failure: unknown;
		try {
			while (this.#pending) {
				this.#check();
				if (count >= LIMITS.maximumRecords || bytes + this.#pending.byteLength > LIMITS.maximumPackBytes) break;
				const prepared = this.#pending; this.#pending = null; count += 1; bytes += prepared.byteLength;
				yield prepared.definition; this.#pending = await this.#readNext();
			}
			completed = true;
		} catch (error) { failed = true; failure = error; }
		finally {
			this.#active = false; this.#pack = null;
			if (!completed) {
				this.#retire();
				try { await this.#returnSource(); } catch (cleanup) { rethrowCleanup(failed, failure, cleanup, this.signal); }
			}
		}
		if (failed) throw failure;
	}

	async #readNext(): Promise<Prepared | null> {
		this.#check(); if (this.#done) return null;
		if (this.#iterator === null) {
			const source = this.#source;
			if (!source) throw new Error('Smart collection sequence has no live source.');
			this.#iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator](); this.#source = null;
		}
		const iterator = this.#iterator, next = Promise.resolve().then(() => iterator.next()); this.#next = next;
		let result: IteratorResult<PhotoSmartCollectionV1>;
		try { result = await next; } finally { if (this.#next === next) this.#next = null; }
		this.#check(); if (result.done) { this.#done = true; this.#iterator = null; return null; }
		const prepared = preparePhotoSmartCollectionPackRecordV1(result.value); this.#check();
		this.admit(prepared.definition); this.#check(); return prepared;
	}
	#returnSource(): Promise<void> {
		if (this.#returning) return this.#returning;
		const iterator = this.#iterator; this.#source = null;
		this.#returning = Promise.resolve().then(async () => { if (iterator && !this.#done) await iterator.return?.(); })
			.finally(() => { this.#done = true; this.#iterator = null; });
		return this.#returning;
	}
	#retire(): void {
		this.#closed = true; this.#pending = null; this.#active = false;
		Reflect.apply(nativeAbort, this.#stop, [new DOMException('Saved pack sequence was closed.', 'AbortError')]);
	}
	#check(): void {
		if (this.signal !== undefined) Reflect.apply(nativeThrow, this.signal, []);
		Reflect.apply(nativeThrow, this.#stop.signal, []);
	}
}
function combined(primary: unknown, cleanup: unknown, signal?: AbortSignal): AggregateError {
	const aggregate = new AggregateError([primary, cleanup], 'Smart collection enumeration and cleanup both failed.', { cause: primary });
	if (signal !== undefined && Reflect.apply(nativeAborted, signal, []) === true
		&& Object.is(primary, Reflect.apply(nativeReason, signal, []))) aggregate.name = 'AbortError';
	return aggregate;
}
function rethrowCleanup(failed: boolean, failure: unknown, cleanup: unknown, signal?: AbortSignal): never {
	throw failed ? combined(failure, cleanup, signal) : cleanup;
}
