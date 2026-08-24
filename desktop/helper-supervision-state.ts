/* SPDX-License-Identifier: AGPL-3.0-only */

/** Helper failure vocabulary, public state projection, and bounded crash ledger. */

export type HelperFailureCause =
	| 'binary-mismatch'
	| 'handshake'
	| 'invalid-request'
	| 'capacity'
	| 'unsupported-kind'
	| 'heartbeat'
	| 'malformed-message'
	| 'job-mismatch'
	| 'helper-error'
	| 'helper-exit'
	| 'cancelled'
	| 'cancellation-timeout'
	| 'resource-violation'
	| 'quarantined'
	| 'disposed';

export class HelperSupervisionError extends Error {
	readonly cause_: HelperFailureCause;

	constructor(cause: HelperFailureCause, message: string) {
		super(message);
		this.name = 'HelperSupervisionError';
		this.cause_ = cause;
	}
}

export type HelperSupervisorState = 'idle' | 'starting' | 'ready' | 'busy' | 'quarantined' | 'disposed';

export interface HelperSupervisorSnapshot {
	readonly state: HelperSupervisorState;
	readonly recentCrashes: number;
	readonly quarantined: boolean;
}

export interface HelperCrashLedgerOptions {
	readonly crashLimit: number;
	readonly windowMs: number;
	readonly now: () => number;
}

/**
 * A quarantine remains latched until an explicit clear. The rolling window is
 * used only to decide whether a new qualifying failure trips that latch.
 */
export class HelperCrashLedger {
	readonly #crashLimit: number;
	readonly #windowMs: number;
	readonly #now: () => number;
	#timestamps: number[] = [];
	#quarantined = false;

	constructor(options: HelperCrashLedgerOptions) {
		if (!Number.isSafeInteger(options.crashLimit) || options.crashLimit < 1) {
			throw new RangeError('A helper crash ledger requires a positive crash limit.');
		}
		if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) {
			throw new RangeError('A helper crash ledger requires a positive rolling window.');
		}
		this.#crashLimit = options.crashLimit;
		this.#windowMs = options.windowMs;
		this.#now = options.now;
	}

	get quarantined(): boolean { return this.#quarantined; }

	get recentCount(): number { return this.#recent(this.#now()).length; }

	record(): void {
		const now = this.#now();
		this.#timestamps = [...this.#recent(now), now];
		if (this.#timestamps.length >= this.#crashLimit) this.#quarantined = true;
	}

	clear(): void {
		this.#timestamps = [];
		this.#quarantined = false;
	}

	#recent(now: number): number[] {
		const cutoff = now - this.#windowMs;
		return this.#timestamps.filter((timestamp) => timestamp > cutoff);
	}
}
