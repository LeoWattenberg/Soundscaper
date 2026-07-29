/* SPDX-License-Identifier: AGPL-3.0-only */

export const SCAPE_INSPECTION_CAPACITY_CODE = 'SCAPE_INSPECTION_CAPACITY' as const;
export const SCAPE_INSPECTION_SETTLEMENT_TIMEOUT_CODE = 'SCAPE_INSPECTION_SETTLEMENT_TIMEOUT' as const;

export interface ScapeInspectionQuiescenceLimits {
	readonly maximumActiveInspections: number;
	readonly settlementTimeoutMs: number;
}

export const SCAPE_INSPECTION_QUIESCENCE_HARD_LIMITS: Readonly<ScapeInspectionQuiescenceLimits> = Object.freeze({
	maximumActiveInspections: 8,
	settlementTimeoutMs: 30_000,
});

export interface ScapeInspectionQuiescenceOptions {
	readonly limits?: Partial<ScapeInspectionQuiescenceLimits>;
	readonly setTimeout?: (callback: () => void, delayMs: number) => unknown;
	readonly clearTimeout?: (handle: unknown) => void;
}

export class ScapeInspectionCapacityError extends Error {
	readonly code = SCAPE_INSPECTION_CAPACITY_CODE;
	readonly limit: number;
	readonly activeInspections: number;

	constructor(limit: number, activeInspections: number) {
		super(`Scape inspection capacity is limited to ${limit} active inspections.`);
		this.name = 'ScapeInspectionCapacityError';
		this.limit = limit;
		this.activeInspections = activeInspections;
	}
}

export class ScapeInspectionSettlementTimeoutError extends Error {
	readonly code = SCAPE_INSPECTION_SETTLEMENT_TIMEOUT_CODE;
	readonly timeoutMs: number;
	readonly pendingInspections: number;

	constructor(timeoutMs: number, pendingInspections: number) {
		super(`${pendingInspections} Scape inspection${pendingInspections === 1 ? '' : 's'} did not settle within ${timeoutMs} milliseconds.`);
		this.name = 'TimeoutError';
		this.timeoutMs = timeoutMs;
		this.pendingInspections = pendingInspections;
	}
}

export type ScapeInspectionOutcome = Readonly<
	| { status: 'fulfilled' }
	| { status: 'rejected'; reason: unknown }
>;

export interface ScapeInspectionAdmission {
	readonly signal: AbortSignal;
	cancel(reason: unknown): void;
	retain(settlement: PromiseLike<unknown>): void;
	finish(outcome: ScapeInspectionOutcome): void;
}

export interface ScapeInspectionFence {
	wait(): Promise<void>;
	release(): void;
}

export interface ScapeInspectionQuiescence {
	admit(): ScapeInspectionAdmission;
	beginFence(reason: unknown): ScapeInspectionFence;
	close(reason: unknown): void;
	drain(): Promise<void>;
}

interface ActiveInspection {
	readonly controller: AbortController;
	readonly outcome: Promise<ScapeInspectionOutcome>;
	readonly deadline: Promise<void>;
	armDeadline(): void;
	deadlineExpired(): boolean;
	recordedOutcome(): ScapeInspectionOutcome | null;
}

type InspectionWaitResult = Readonly<
	| { status: 'settled'; outcome: ScapeInspectionOutcome }
	| { status: 'timed-out' }
>;

export function resolveScapeInspectionQuiescenceLimits(
	overrides: Partial<ScapeInspectionQuiescenceLimits> = {},
): Readonly<ScapeInspectionQuiescenceLimits> {
	if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
		throw new TypeError('Scape inspection quiescence limits must be an object.');
	}
	for (const name of Object.keys(overrides)) {
		if (!Object.hasOwn(SCAPE_INSPECTION_QUIESCENCE_HARD_LIMITS, name)) {
			throw new TypeError(`Unsupported Scape inspection quiescence limit: ${name}.`);
		}
	}
	const limits = { ...SCAPE_INSPECTION_QUIESCENCE_HARD_LIMITS, ...overrides };
	for (const name of Object.keys(
		SCAPE_INSPECTION_QUIESCENCE_HARD_LIMITS,
	) as (keyof ScapeInspectionQuiescenceLimits)[]) {
		const value = limits[name];
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError(`Scape inspection ${name} must be a positive safe integer.`);
		}
		if (value > SCAPE_INSPECTION_QUIESCENCE_HARD_LIMITS[name]) {
			throw new RangeError(`Scape inspection ${name} cannot exceed its hard limit.`);
		}
	}
	return Object.freeze(limits);
}

/** Retains every inspection generation until its cleanup and registered continuations settle. */
export function createScapeInspectionQuiescence(
	options: ScapeInspectionQuiescenceOptions = {},
): ScapeInspectionQuiescence {
	if (!options || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('Scape inspection quiescence options must be an object.');
	}
	const limits = resolveScapeInspectionQuiescenceLimits(
		options.limits === undefined ? {} : options.limits,
	);
	if (options.setTimeout !== undefined && typeof options.setTimeout !== 'function') {
		throw new TypeError('Scape inspection setTimeout must be a function.');
	}
	if (options.clearTimeout !== undefined && typeof options.clearTimeout !== 'function') {
		throw new TypeError('Scape inspection clearTimeout must be a function.');
	}
	const scheduleTimeout = options.setTimeout
		?? ((callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs));
	const cancelTimeout = options.clearTimeout
		?? ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));
	const active = new Set<ActiveInspection>();
	const fences = new Map<object, unknown>();
	let closed = false;
	let closedReason: unknown;

	return Object.freeze({ admit, beginFence, close, drain });

	function admit(): ScapeInspectionAdmission {
		assertAdmissionOpen();
		if (active.size >= limits.maximumActiveInspections) {
			throw new ScapeInspectionCapacityError(limits.maximumActiveInspections, active.size);
		}
		const controller = new AbortController();
		let settle: (outcome: ScapeInspectionOutcome) => void = () => undefined;
		const outcome = new Promise<ScapeInspectionOutcome>((resolve) => { settle = resolve; });
		let expireDeadline: () => void = () => undefined;
		const deadline = new Promise<void>((resolve) => { expireDeadline = resolve; });
		let deadlineArmed = false;
		let deadlineExpired = false;
		let deadlineHandle: unknown;
		let settled = false;
		let finished = false;
		let retained = 0;
		let recordedOutcome: ScapeInspectionOutcome | null = null;
		const inspection: ActiveInspection = Object.freeze({
			controller,
			outcome,
			deadline,
			armDeadline() {
				if (deadlineArmed || settled) return;
				deadlineArmed = true;
				try {
					deadlineHandle = scheduleTimeout(() => {
						if (settled || deadlineExpired) return;
						deadlineExpired = true;
						deadlineHandle = undefined;
						expireDeadline();
					}, limits.settlementTimeoutMs);
					unrefTimer(deadlineHandle);
				} catch (error) {
					deadlineArmed = false;
					throw error;
				}
			},
			deadlineExpired: () => deadlineExpired,
			recordedOutcome: () => recordedOutcome,
		});
		active.add(inspection);
		const settleIfReady = (): void => {
			if (settled || !finished || retained !== 0 || !recordedOutcome) return;
			settled = true;
			active.delete(inspection);
			if (deadlineArmed && !deadlineExpired) {
				try { cancelTimeout(deadlineHandle); } catch { /* Timer cleanup is best effort. */ }
				deadlineHandle = undefined;
			}
			settle(recordedOutcome);
		};
		return Object.freeze({
			signal: controller.signal,
			cancel(reason: unknown) {
				if (settled) return;
				inspection.armDeadline();
				if (!finished) controller.abort(reason);
			},
			retain(settlement: PromiseLike<unknown>) {
				if (finished) throw new Error('Cannot retain work after a Scape inspection has finished.');
				retained += 1;
				const release = (): void => {
					retained -= 1;
					settleIfReady();
				};
				void Promise.resolve(settlement).then(release, release);
			},
			finish(result: ScapeInspectionOutcome) {
				if (finished) return;
				finished = true;
				recordedOutcome = Object.freeze({ ...result });
				settleIfReady();
			},
		});
	}

	function beginFence(reason: unknown): ScapeInspectionFence {
		if (closed) throw closedReason;
		const token = Object.freeze({});
		fences.set(token, reason);
		const inspections = Object.freeze([...active]);
		for (const inspection of inspections) {
			inspection.armDeadline();
			inspection.controller.abort(reason);
		}
		let waiting: Promise<void> | null = null;
		let released = false;
		return Object.freeze({
			wait() {
				waiting ??= waitFor(inspections);
				return waiting;
			},
			release() {
				if (released) return;
				released = true;
				fences.delete(token);
			},
		});
	}

	function close(reason: unknown): void {
		if (closed) return;
		closed = true;
		closedReason = reason;
		for (const inspection of active) {
			inspection.armDeadline();
			inspection.controller.abort(reason);
		}
	}

	function drain(): Promise<void> {
		return waitFor([...active]);
	}

	function assertAdmissionOpen(): void {
		if (closed) throw closedReason;
		if (!fences.size) return;
		let reason: unknown;
		for (const fenceReason of fences.values()) reason = fenceReason;
		throw reason;
	}

	async function waitFor(inspections: readonly ActiveInspection[]): Promise<void> {
		for (const inspection of inspections) inspection.armDeadline();
		const results = await Promise.all(inspections.map<Promise<InspectionWaitResult>>((inspection) => {
			if (inspection.deadlineExpired()) {
				return Promise.resolve(Object.freeze({ status: 'timed-out' as const }));
			}
			return Promise.race([
				inspection.outcome.then((inspectionOutcome) => Object.freeze({
					status: 'settled' as const,
					outcome: inspectionOutcome,
				})),
				inspection.deadline.then(() => Object.freeze({ status: 'timed-out' as const })),
			]);
		}));
		const failures: unknown[] = [];
		let pendingInspections = 0;
		for (let index = 0; index < results.length; index += 1) {
			const result = results[index];
			const inspection = inspections[index];
			if (!result || !inspection) continue;
			if (result.status === 'timed-out') pendingInspections += 1;
			const inspectionOutcome = result.status === 'settled'
				? result.outcome
				: inspection.recordedOutcome();
			if (inspectionOutcome?.status !== 'rejected') continue;
			if (inspection.controller.signal.aborted
				&& Object.is(inspectionOutcome.reason, inspection.controller.signal.reason)) continue;
			failures.push(inspectionOutcome.reason);
		}
		if (pendingInspections > 0) {
			failures.push(new ScapeInspectionSettlementTimeoutError(
				limits.settlementTimeoutMs,
				pendingInspections,
			));
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Multiple .scape inspections failed while draining cleanup.');
		}
	}
}

function unrefTimer(timer: unknown): void {
	if (!timer || typeof timer !== 'object' || !('unref' in timer)) return;
	const unref = (timer as { readonly unref?: unknown }).unref;
	if (typeof unref === 'function') unref.call(timer);
}
