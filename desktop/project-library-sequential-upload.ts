/* SPDX-License-Identifier: AGPL-3.0-only */

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	readonly reject: (reason?: unknown) => void;
	readonly resolve: (value: Value | PromiseLike<Value>) => void;
}

/** One-chunk-at-a-time producer/consumer rendezvous for renderer uploads. */
export class SequentialUploadInput implements AsyncIterable<Uint8Array> {
	#failed: unknown = null;
	#finished = false;
	#inFlight: Deferred<void> | null = null;
	#pending: Readonly<{ bytes: Uint8Array; consumed: Deferred<void> }> | null = null;
	#waiting: Deferred<IteratorResult<Uint8Array>> | null = null;

	write(bytes: Uint8Array): Promise<void> {
		if (this.#failed) return Promise.reject(this.#failed);
		if (this.#finished) return Promise.reject(new Error('Desktop shared-source write is closed'));
		if (this.#pending) return Promise.reject(new Error('Concurrent desktop shared-source writes are not allowed'));
		const consumed = deferred<void>();
		const pending = Object.freeze({ bytes, consumed });
		this.#pending = pending;
		if (this.#waiting) {
			const waiting = this.#waiting;
			this.#waiting = null;
			this.#pending = null;
			this.#inFlight = consumed;
			waiting.resolve({ done: false, value: bytes });
		}
		return consumed.promise;
	}

	finish(): void {
		if (this.#failed || this.#finished) throw new Error('Desktop shared-source write is closed');
		if (this.#pending) throw new Error('Desktop shared-source chunk is still being consumed');
		this.#finished = true;
		if (this.#waiting) {
			this.#waiting.resolve({ done: true, value: undefined });
			this.#waiting = null;
		}
	}

	fail(error: unknown): void {
		if (this.#failed || this.#finished) return;
		this.#failed = error;
		this.#inFlight?.reject(error);
		this.#inFlight = null;
		this.#pending?.consumed.reject(error);
		this.#pending = null;
		this.#waiting?.reject(error);
		this.#waiting = null;
	}

	[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
		return { next: () => this.#next() };
	}

	#next(): Promise<IteratorResult<Uint8Array>> {
		if (this.#inFlight) {
			this.#inFlight.resolve(undefined);
			this.#inFlight = null;
		}
		if (this.#pending) {
			const pending = this.#pending;
			this.#pending = null;
			this.#inFlight = pending.consumed;
			return Promise.resolve({ done: false, value: pending.bytes });
		}
		if (this.#failed) return Promise.reject(this.#failed);
		if (this.#finished) return Promise.resolve({ done: true, value: undefined });
		if (this.#waiting) return Promise.reject(new Error('Desktop shared-source consumer requested concurrent chunks'));
		this.#waiting = deferred<IteratorResult<Uint8Array>>();
		return this.#waiting.promise;
	}
}

function deferred<Value>(): Deferred<Value> {
	let resolve: Deferred<Value>['resolve'] = () => undefined;
	let reject: Deferred<Value>['reject'] = () => undefined;
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return Object.freeze({ promise, reject, resolve });
}
