/* SPDX-License-Identifier: AGPL-3.0-only */

/** Versioned battery, thermal, and scheduling etiquette for optional Milestone 7 inference. */

export const ASSISTANCE_POWER_ETIQUETTE_VERSION = 1;

/** The macOS thermal vocabulary Electron reports; every other platform reports `unknown`. */
export const ASSISTANCE_THERMAL_STATES = Object.freeze([
	'unknown', 'nominal', 'fair', 'serious', 'critical',
] as const);

export type AssistanceThermalState = (typeof ASSISTANCE_THERMAL_STATES)[number];

export type AssistancePowerHoldReason = 'on-battery' | 'thermal-pressure';

export interface AssistancePowerObservation {
	readonly onBatteryPower: boolean;
	readonly thermalState: AssistanceThermalState;
}

export type AssistancePowerAdmission =
	| Readonly<{ readonly admitted: true }>
	| Readonly<{
		readonly admitted: false;
		readonly reason: AssistancePowerHoldReason;
		readonly detail: string;
	}>;

export interface AssistancePowerEtiquettePort {
	observe(): AssistancePowerObservation;
	/** Registers a change listener and returns its exact removal. */
	subscribe(listener: () => void): () => void;
}

export interface AssistancePowerHoldOptions {
	readonly port: AssistancePowerEtiquettePort;
	readonly holdBudgetMs: number;
	readonly signal?: AbortSignal;
	readonly onHold?: (reason: AssistancePowerHoldReason) => void;
	readonly setTimeoutImpl?: typeof setTimeout;
	readonly clearTimeoutImpl?: typeof clearTimeout;
}

export type AssistancePowerHoldOutcome =
	| Readonly<{ readonly outcome: 'admitted' }>
	| Readonly<{ readonly outcome: 'cancelled' }>
	| Readonly<{
		readonly outcome: 'deferred';
		readonly reason: AssistancePowerHoldReason;
		readonly detail: string;
	}>;

export const ASSISTANCE_POWER_HOLD_BUDGET_MS = 120_000;
const MAXIMUM_HOLD_BUDGET_MS = 600_000;

/**
 * Optional inference is background work: it waits for mains power and a cool
 * machine rather than competing with the editor the user is actually driving.
 * A hold only ever delays admission of new work; nothing here cancels or
 * corrupts a job that already started.
 */
export function admitAssistancePower(value: unknown): AssistancePowerAdmission {
	const observation = validateAssistancePowerObservation(value);
	if (observation.thermalState === 'serious' || observation.thermalState === 'critical') {
		return Object.freeze({
			admitted: false as const,
			reason: 'thermal-pressure' as const,
			detail: `The system reports ${observation.thermalState} thermal pressure.`,
		});
	}
	if (observation.onBatteryPower) {
		return Object.freeze({
			admitted: false as const,
			reason: 'on-battery' as const,
			detail: 'The system is running on battery power.',
		});
	}
	return Object.freeze({ admitted: true as const });
}

/**
 * Platforms outside macOS report no thermal vocabulary at all, so anything the
 * host does not recognise reads as `unknown` rather than refusing the machine.
 */
export function normalizeAssistanceThermalState(value: unknown): AssistanceThermalState {
	return typeof value === 'string' && (ASSISTANCE_THERMAL_STATES as readonly string[]).includes(value)
		? value as AssistanceThermalState : 'unknown';
}

export function validateAssistancePowerObservation(value: unknown): AssistancePowerObservation {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('The assistance power observation must be one plain record.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	const keys = Object.keys(record).sort();
	if (JSON.stringify(keys) !== JSON.stringify(['onBatteryPower', 'thermalState'])
		|| typeof record.onBatteryPower !== 'boolean'
		|| typeof record.thermalState !== 'string'
		|| !(ASSISTANCE_THERMAL_STATES as readonly string[]).includes(record.thermalState)) {
		throw new TypeError('The assistance power observation is invalid.');
	}
	return Object.freeze({
		onBatteryPower: record.onBatteryPower,
		thermalState: record.thermalState as AssistanceThermalState,
	});
}

/**
 * Waits out a transient hold. The budget bounds the pause so a sustained
 * battery or thermal condition reports a typed deferral instead of hanging.
 */
export async function awaitAssistancePowerAdmission(
	options: AssistancePowerHoldOptions,
): Promise<AssistancePowerHoldOutcome> {
	const port = validatePort(options?.port);
	const holdBudgetMs = validateHoldBudget(options?.holdBudgetMs);
	const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
	const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
	if (options.onHold !== undefined && typeof options.onHold !== 'function') {
		throw new TypeError('The assistance power hold listener is invalid.');
	}
	// A power reading the host cannot supply must never stall the user's work.
	let admission: AssistancePowerAdmission;
	try { admission = admitAssistancePower(port.observe()); }
	catch { return Object.freeze({ outcome: 'admitted' as const }); }
	if (admission.admitted) return Object.freeze({ outcome: 'admitted' as const });
	if (options.signal?.aborted) return Object.freeze({ outcome: 'cancelled' as const });
	options.onHold?.(admission.reason);
	return await new Promise<AssistancePowerHoldOutcome>((resolve) => {
		let settled = false;
		const settle = (outcome: AssistancePowerHoldOutcome): void => {
			if (settled) return;
			settled = true;
			clearTimeoutImpl(timer);
			unsubscribe();
			options.signal?.removeEventListener('abort', onAbort);
			resolve(outcome);
		};
		const onAbort = (): void => settle(Object.freeze({ outcome: 'cancelled' as const }));
		const timer = setTimeoutImpl(() => {
			const held = admission as Extract<AssistancePowerAdmission, { admitted: false }>;
			settle(Object.freeze({
				outcome: 'deferred' as const, reason: held.reason, detail: held.detail,
			}));
		}, holdBudgetMs);
		const unsubscribe = port.subscribe(() => {
			let next: AssistancePowerAdmission;
			try { next = admitAssistancePower(port.observe()); }
			catch { return; }
			if (next.admitted) { settle(Object.freeze({ outcome: 'admitted' as const })); return; }
			admission = next;
		});
		if (typeof unsubscribe !== 'function') {
			throw new TypeError('The assistance power port returned no unsubscribe.');
		}
		options.signal?.addEventListener('abort', onAbort, { once: true });
		if (options.signal?.aborted) onAbort();
	});
}

/**
 * Drops one assistance helper process to background scheduling priority so its
 * CPU-only inference yields to the editor. Failure is never fatal: an operating
 * system that refuses the change simply keeps the inherited priority.
 */
export function applyAssistanceBackgroundPriority(
	pid: number,
	setPriority: (pid: number, priority: number) => void,
	priority: number,
): boolean {
	if (!Number.isSafeInteger(pid) || pid < 1 || typeof setPriority !== 'function'
		|| !Number.isSafeInteger(priority)) {
		throw new TypeError('The assistance background-priority request is invalid.');
	}
	try {
		setPriority(pid, priority);
		return true;
	} catch {
		return false;
	}
}

function validatePort(value: unknown): AssistancePowerEtiquettePort {
	const port = value as AssistancePowerEtiquettePort;
	if (!port || typeof port.observe !== 'function' || typeof port.subscribe !== 'function') {
		throw new TypeError('The assistance power etiquette port is invalid.');
	}
	return port;
}

function validateHoldBudget(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1
		|| (value as number) > MAXIMUM_HOLD_BUDGET_MS) {
		throw new RangeError('The assistance power hold budget is invalid.');
	}
	return value as number;
}
