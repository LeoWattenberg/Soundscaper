/* SPDX-License-Identifier: AGPL-3.0-only */
/** A failed delivery retains its exact cleanup capability until cleanup succeeds. */
export class MotionDeliveryCleanupFailure extends AggregateError {
	readonly #cleanup: () => Promise<void>;
	#pending = true; #retry: Promise<void> | null = null;
	constructor(errors: readonly unknown[], message: string, cleanup: () => Promise<void>) {
		super(errors, message); this.#cleanup = cleanup;
	}
	get cleanupRequired(): boolean { return this.#pending; }
	completeCleanup(): void { this.#pending = false; }
	retryCleanup(): Promise<void> {
		if (!this.#pending) return Promise.resolve();
		this.#retry ??= Promise.resolve().then(this.#cleanup).then(() => { this.#pending = false; }).finally(() => { this.#retry = null; });
		return this.#retry;
	}
}

/** Pipeline aggregates can nest failures; only locally owned cleanup capabilities are callable. */
export function pendingMotionDeliveryCleanup(error: unknown): readonly MotionDeliveryCleanupFailure[] {
	const found = new Set<MotionDeliveryCleanupFailure>(); const visited = new Set<unknown>(); const pending = [error];
	while (pending.length) {
		const value = pending.pop(); if (visited.has(value)) continue; visited.add(value);
		if (value instanceof MotionDeliveryCleanupFailure && value.cleanupRequired) found.add(value);
		if (value instanceof AggregateError) {
			const errors: unknown = Object.getOwnPropertyDescriptor(value, 'errors')?.value;
			if (Array.isArray(errors)) for (const child of errors as unknown[]) pending.push(child);
		}
	}
	return [...found];
}
