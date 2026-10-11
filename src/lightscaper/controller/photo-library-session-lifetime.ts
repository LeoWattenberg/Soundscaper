/* SPDX-License-Identifier: AGPL-3.0-only */

const NativeController = AbortController;
const CHECK = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype, 'signal')!.get!;
const ABORT = AbortController.prototype.abort;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;

/** Private current Session ownership, independent of photo schema admission.
 * Each entire operation is joined before resource cleanup. One writer can
 * overlap admitted readers; no second writer or deferred mutation is queued.
 * Signals forward their first native reason into an independently owned
 * controller, with explicit listener retirement and no reason reflection. */
export class PhotoLibrarySessionLifetime {
	readonly #controller = new NativeController();
	readonly #pending = new Set<Promise<unknown>>();
	#writing = false;
	#closed = false;
	#closing: Promise<void> | null = null;

	get signal(): AbortSignal { return Reflect.apply(SIGNAL, this.#controller, []) as AbortSignal; }

	assertAccepting(): void {
		if (this.#closed) throw new Error('The photo library session is closed.');
	}

	operation<Result>(run: (signal: AbortSignal) => Promise<Result>, caller?: AbortSignal, admit?: () => void): Promise<Result> {
		try { this.assertAccepting(); } catch (error) { return Promise.reject(error); }
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
		const work = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; });
		this.#pending.add(work);
		let detach: () => void = () => undefined;
		let signal: AbortSignal | null = null;
		const settled = () => { detach(); this.#pending.delete(work); };
		void work.then(settled, settled);
		try {
			const joined = join(caller, this.signal); detach = joined.detach;
			signal = joined.signal;
			Reflect.apply(CHECK, signal, []);
			// Pin mutable inputs under the pending latch before the public call
			// returns. Resource work remains deferred so ready caches can settle.
			admit?.(); Reflect.apply(CHECK, signal, []);
			void Promise.resolve().then(() => {
				Reflect.apply(CHECK, joined.signal, []); return run(joined.signal);
			}).then(resolve, reject);
		} catch (error) {
			// Admission traps can cancel or Close and then throw another error.
			// The first native reason wins without inspecting that reason.
			if (signal !== null) {
				try { Reflect.apply(CHECK, signal, []); } catch (reason) { reject(reason); return work; }
			}
			reject(error);
		}
		return work;
	}

	mutation<Result>(run: (signal: AbortSignal) => Promise<Result>, caller?: AbortSignal, admit?: () => void): Promise<Result> {
		try { this.assertAccepting(); } catch (error) { return Promise.reject(error); }
		if (this.#writing) return Promise.reject(new Error('A photo library change is already pending.'));
		this.#writing = true;
		const work = this.operation(run, caller, admit), release = () => { this.#writing = false; };
		void work.then(release, release); return work;
	}

	close(cleanup: () => Promise<void>): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		let resolve!: () => void, reject!: (reason: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		// Cache before cancellation listeners can reenter Close or attempt new work.
		Reflect.apply(ABORT, this.#controller, []);
		void (async () => {
			await Promise.allSettled([...this.#pending]); await cleanup();
		})().then(resolve, reject);
		return this.#closing;
	}
}

function join(caller: AbortSignal | undefined, lifetime: AbortSignal): Readonly<{ signal: AbortSignal; detach: () => void }> {
	const controller = new NativeController(), signal = Reflect.apply(SIGNAL, controller, []) as AbortSignal;
	const sources = caller === undefined ? [lifetime] : [caller, lifetime];
	// Brand every caller before attaching any native listener.
	for (const source of sources) Reflect.apply(ABORTED, source, []);
	const listeners = sources.map(source => {
		const forward = () => {
			if (Reflect.apply(ABORTED, signal, []) === false) Reflect.apply(ABORT, controller, [Reflect.apply(REASON, source, [])]);
		};
		Reflect.apply(ADD, source, ['abort', forward, { once: true }]);
		if (Reflect.apply(ABORTED, source, []) === true) forward();
		return { source, forward };
	});
	return Object.freeze({ signal, detach() {
		for (const { source, forward } of listeners) Reflect.apply(REMOVE, source, ['abort', forward]);
	} });
}
