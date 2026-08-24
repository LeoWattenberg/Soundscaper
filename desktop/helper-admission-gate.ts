/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded, abort-aware FIFO admission for one-job helper supervisors. */

import { HelperSupervisionError } from './helper-supervision-state.ts';

export const HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS = 8;

interface GateWaiter {
	readonly signal: AbortSignal | undefined;
	resolve: (release: () => void) => void;
	reject: (error: Error) => void;
	abortListener: (() => void) | null;
	settled: boolean;
}

export class HelperAdmissionGate {
	readonly #waiters: GateWaiter[] = [];
	#active = false;
	#holders = 0;
	#disposed = false;

	acquire(signal?: AbortSignal): Promise<() => void> | (() => void) {
		if (this.#disposed) return Promise.reject(disposedError());
		if (signal?.aborted) return Promise.reject(cancelledError());
		if (this.#holders >= HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS) {
			return Promise.reject(capacityError());
		}
		this.#holders += 1;
		if (!this.#active) {
			this.#active = true;
			return this.#releaseOnce();
		}
		return new Promise<() => void>((resolve, reject) => {
			const waiter: GateWaiter = {
				signal, resolve, reject, abortListener: null, settled: false,
			};
			waiter.abortListener = () => this.#reject(waiter, cancelledError());
			this.#waiters.push(waiter);
			signal?.addEventListener('abort', waiter.abortListener, { once: true });
			if (signal?.aborted) waiter.abortListener();
		});
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const waiter of this.#waiters.splice(0)) this.#reject(waiter, disposedError());
	}

	#release(): void {
		if (!this.#active) return;
		this.#holders -= 1;
		for (;;) {
			const waiter = this.#waiters.shift();
			if (!waiter) {
				this.#active = false;
				return;
			}
			if (waiter.settled) continue;
			waiter.settled = true;
			if (waiter.abortListener) waiter.signal?.removeEventListener('abort', waiter.abortListener);
			waiter.resolve(this.#releaseOnce());
			return;
		}
	}

	#releaseOnce(): () => void {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#release();
		};
	}

	#reject(waiter: GateWaiter, error: Error): void {
		if (waiter.settled) return;
		waiter.settled = true;
		const index = this.#waiters.indexOf(waiter);
		if (index >= 0) this.#waiters.splice(index, 1);
		this.#holders -= 1;
		if (waiter.abortListener) waiter.signal?.removeEventListener('abort', waiter.abortListener);
		waiter.reject(error);
	}
}

function capacityError(): HelperSupervisionError {
	return new HelperSupervisionError(
		'capacity',
		`The helper admission gate holds at most ${String(HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS)} jobs.`,
	);
}

function cancelledError(): HelperSupervisionError {
	return new HelperSupervisionError('cancelled', 'The queued helper job was cancelled.');
}

function disposedError(): HelperSupervisionError {
	return new HelperSupervisionError('disposed', 'The helper supervisor is disposed.');
}
