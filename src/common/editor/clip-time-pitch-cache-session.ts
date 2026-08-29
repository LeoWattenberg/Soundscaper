/* SPDX-License-Identifier: AGPL-3.0-only */

type Awaitable<Value> = PromiseLike<Value> | Value;

interface DrainableCacheJob {
	readonly controller: Readonly<{ abort(): void }>;
	readonly interests: Readonly<{ clear(): void }>;
	readonly promise: PromiseLike<unknown>;
}

interface CacheSessionFenceOptions {
	readonly createAbortError: () => unknown;
	readonly createDisposedError: () => unknown;
}

/** Fence asynchronous cache work when a controller session is cleared or disposed. */
export class ClipTimePitchCacheSessionFence {
	readonly #createAbortError: () => unknown;
	readonly #createDisposedError: () => unknown;
	#epoch = 0;
	#clearPromise: Promise<void> | null = null;
	#disposed = false;
	#disposePromise: Promise<void> | null = null;

	constructor(options: CacheSessionFenceOptions) {
		this.#createAbortError = options.createAbortError;
		this.#createDisposedError = options.createDisposedError;
	}

	capture(): number {
		this.assertActive();
		return this.#epoch;
	}

	assertActive(): void {
		if (this.#disposed) throw this.#createDisposedError();
		if (this.#clearPromise) throw this.#createAbortError();
	}

	assertCurrent(epoch: number): void {
		if (epoch !== this.#epoch) throw this.#createAbortError();
		this.assertActive();
	}

	clear(jobsValue: Iterable<DrainableCacheJob>, reset: () => void): Promise<void> {
		if (this.#clearPromise) return this.#clearPromise;
		const jobs = [...jobsValue];
		const clearing = Promise.allSettled(jobs.map((job) => job.promise)).then(() => {
			if (this.#clearPromise === clearing) this.#clearPromise = null;
		});
		this.#clearPromise = clearing;
		this.#epoch += 1;
		for (const job of jobs) {
			job.interests.clear();
			job.controller.abort();
		}
		reset();
		return clearing;
	}

	dispose(
		jobs: Iterable<DrainableCacheJob>,
		reset: () => void,
		disposeResource?: () => Awaitable<unknown>,
	): Promise<void> {
		if (this.#disposePromise) return this.#disposePromise;
		if (this.#disposed) return Promise.resolve();
		this.#disposed = true;
		const clearing = this.clear(jobs, reset);
		let resourceDisposal: Promise<unknown>;
		try {
			resourceDisposal = Promise.resolve(disposeResource?.());
		} catch (error) {
			resourceDisposal = Promise.reject(error);
		}
		this.#disposePromise = Promise.allSettled([clearing, resourceDisposal]).then((results) => {
			const failure = results.find((result) => result.status === 'rejected');
			if (failure?.status === 'rejected') throw failure.reason;
		});
		return this.#disposePromise;
	}
}
