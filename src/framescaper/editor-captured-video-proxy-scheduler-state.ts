/* SPDX-License-Identifier: AGPL-3.0-only */

const DEFAULT_MAXIMUM_LINEAGES = 64;
const DEFAULT_MAXIMUM_LANDED = 16;
const DEFAULT_MAXIMUM_RECONCILIATION_ATTEMPTS = 3;

export interface CapturedVideoProxySchedulerPolicy {
	readonly maximumLineageEntries: number;
	readonly maximumLandedEntries: number;
	readonly maximumReconciliationAttempts: number;
}

export function capturedVideoProxySchedulerPolicy(
	value: Readonly<Record<string, unknown>>,
): Readonly<CapturedVideoProxySchedulerPolicy> {
	return Object.freeze({
		maximumLineageEntries: boundedInteger(
			value.maximumLineageEntries, DEFAULT_MAXIMUM_LINEAGES, 1, 256, 'lineage capacity',
		),
		maximumLandedEntries: boundedInteger(
			value.maximumLandedEntries, DEFAULT_MAXIMUM_LANDED, 1, 64, 'landed capacity',
		),
		maximumReconciliationAttempts: boundedInteger(
			value.maximumReconciliationAttempts,
			DEFAULT_MAXIMUM_RECONCILIATION_ATTEMPTS,
			1,
			8,
			'reconciliation attempts',
		),
	});
}

/** Strict-capacity durable-transition evidence; only success or disposal releases it. */
export class CapturedVideoProxyBoundedState<Value> {
	readonly #entries = new Map<string, Value>();
	readonly #maximum: number;
	readonly #evictOldest: boolean;

	constructor(maximum: number, evictOldest = false) {
		this.#maximum = maximum;
		this.#evictOldest = evictOldest;
	}

	get(key: string): Value | null { return this.#entries.get(key) ?? null; }

	assertCapacity(key: string): void {
		if (!this.#entries.has(key) && this.#entries.size >= this.#maximum) {
			throw new Error('The captured proxy landed reconciliation capacity is occupied.');
		}
	}

	set(key: string, value: Value): void {
		this.#entries.delete(key);
		if (this.#entries.size >= this.#maximum) {
			if (!this.#evictOldest) this.assertCapacity(key);
			const oldest = this.#entries.keys().next().value as string | undefined;
			if (oldest !== undefined) this.#entries.delete(oldest);
		}
		this.#entries.set(key, value);
	}

	delete(key: string): void { this.#entries.delete(key); }
	clear(): void { this.#entries.clear(); }
}

/** Bounded microtask attempts; exhaustion never discards the separately owned transition evidence. */
export class CapturedVideoProxyAutomaticReconciliation<Request> {
	readonly #attempts = new Map<string, number>();
	readonly #queued = new Set<string>();
	readonly #maximumAttempts: number;
	readonly #isPending: (key: string) => boolean;
	readonly #execute: (request: Request) => Promise<void>;
	readonly #onExhausted: (key: string) => void;
	#disposed = false;

	constructor(options: Readonly<{
		readonly maximumAttempts: number;
		isPending(key: string): boolean;
		execute(request: Request): Promise<void>;
		onExhausted(key: string): void;
	}>) {
		this.#maximumAttempts = options.maximumAttempts;
		this.#isPending = options.isPending;
		this.#execute = options.execute;
		this.#onExhausted = options.onExhausted;
	}

	afterFailure(key: string, request: Request): void {
		if (this.#disposed || this.#queued.has(key) || !this.#isPending(key)) return;
		const attempts = this.#attempts.get(key) ?? 0;
		if (attempts >= this.#maximumAttempts) {
			this.#finish(key, true);
			return;
		}
		this.#queued.add(key);
		queueMicrotask(() => {
			this.#queued.delete(key);
			if (this.#disposed || !this.#isPending(key)) return;
			this.#attempts.set(key, attempts + 1);
			void this.#execute(request).then(
				() => { this.complete(key); },
				() => { this.afterFailure(key, request); },
			);
		});
	}

	complete(key: string): void {
		this.#attempts.delete(key);
		this.#queued.delete(key);
	}

	dispose(): void {
		this.#disposed = true;
		this.#attempts.clear();
		this.#queued.clear();
	}

	#finish(key: string, exhausted: boolean): void {
		this.complete(key);
		if (exhausted) this.#onExhausted(key);
	}
}

function boundedInteger(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
	name: string,
): number {
	const candidate = value === undefined ? fallback : value;
	if (!Number.isSafeInteger(candidate) || Number(candidate) < minimum || Number(candidate) > maximum) {
		throw new RangeError(`The captured proxy ${name} is invalid.`);
	}
	return Number(candidate);
}
