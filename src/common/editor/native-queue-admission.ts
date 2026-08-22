/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * How many queued jobs may run at once, and which ones.
 *
 * Concurrency is a user setting between one and four, defaulting to two, but it
 * is a ceiling rather than a target: CPU, process-tree RSS, hardware, scratch,
 * and minimum-free-space reservations may all lower it. Admitting a job whose
 * reservation the machine cannot honour is worse than deferring it — it turns a
 * queue that would have finished slowly into one that thrashes, fills the
 * user's disk, or fails halfway through several jobs at once.
 *
 * Order is FIFO by the user's own arrangement, and a deferral never reorders
 * the queue: a job that does not fit right now stays where it is and says why,
 * rather than being skipped over silently while smaller jobs overtake it.
 */

import type { NativeQueueRecordV1 } from './native-queue-record.ts';

export const NATIVE_QUEUE_MINIMUM_CONCURRENCY = 1;
export const NATIVE_QUEUE_MAXIMUM_CONCURRENCY = 4;
export const NATIVE_QUEUE_DEFAULT_CONCURRENCY = 2;

export const NATIVE_QUEUE_DEFERRAL_REASONS = Object.freeze([
	'concurrency-limit',
	'cpu-reservation',
	'rss-reservation',
	'scratch-reservation',
	'free-space-reservation',
	'hardware-busy',
] as const);

export type NativeQueueDeferralReason = (typeof NATIVE_QUEUE_DEFERRAL_REASONS)[number];

export interface NativeQueueCapacityV1 {
	/** The user's chosen ceiling. Clamped into [1, 4]; the default is two. */
	readonly configuredConcurrency?: number;
	readonly availableCpuCores: number;
	readonly availableProcessTreeRssBytes: number;
	readonly availableScratchBytes: number;
	readonly volumeFreeBytes: number;
	/** Space that must remain free on the scratch volume after admission. */
	readonly reservedFreeBytes: number;
	readonly busyHardwareBackends?: readonly string[];
}

export interface NativeQueueDeferralV1 {
	readonly jobId: string;
	readonly reason: NativeQueueDeferralReason;
}

export interface NativeQueueAdmissionV1 {
	readonly concurrencyCeiling: number;
	readonly admitted: readonly string[];
	readonly deferred: readonly NativeQueueDeferralV1[];
}

export class NativeQueueAdmissionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeQueueAdmissionError';
	}
}

const CAPACITY_REQUIRED_FIELDS = Object.freeze([
	'availableCpuCores',
	'availableProcessTreeRssBytes',
	'availableScratchBytes',
	'volumeFreeBytes',
	'reservedFreeBytes',
] as const);
const CAPACITY_OPTIONAL_FIELDS = Object.freeze([
	'configuredConcurrency', 'busyHardwareBackends',
] as const);
const HARDWARE_BACKEND = /^[a-z][a-z0-9-]{0,63}$/u;
const MAXIMUM_BUSY_HARDWARE_BACKENDS = 1_024;

/** Close and freeze one main-owned capacity observation before queue admission. */
export function nativeQueueCapacitySnapshotV1(value: unknown): NativeQueueCapacityV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new NativeQueueAdmissionError('A native queue capacity snapshot must be a plain record.');
	}
	const record = value as Record<string, unknown>;
	const allowed = new Set<string>([...CAPACITY_REQUIRED_FIELDS, ...CAPACITY_OPTIONAL_FIELDS]);
	const fields = Reflect.ownKeys(record);
	if (fields.some((field) => typeof field !== 'string' || !allowed.has(field))
		|| CAPACITY_REQUIRED_FIELDS.some((field) => !Object.hasOwn(record, field))) {
		throw new NativeQueueAdmissionError('A native queue capacity snapshot has missing or unsupported fields.');
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(record, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new NativeQueueAdmissionError('A native queue capacity snapshot must contain enumerable data fields.');
		}
	}
	const snapshot: {
		configuredConcurrency?: number;
		availableCpuCores: number;
		availableProcessTreeRssBytes: number;
		availableScratchBytes: number;
		volumeFreeBytes: number;
		reservedFreeBytes: number;
		busyHardwareBackends?: readonly string[];
	} = {
		availableCpuCores: nonNegativeInteger(record.availableCpuCores, 'availableCpuCores'),
		availableProcessTreeRssBytes: nonNegativeInteger(
			record.availableProcessTreeRssBytes, 'availableProcessTreeRssBytes',
		),
		availableScratchBytes: nonNegativeInteger(record.availableScratchBytes, 'availableScratchBytes'),
		volumeFreeBytes: nonNegativeInteger(record.volumeFreeBytes, 'volumeFreeBytes'),
		reservedFreeBytes: nonNegativeInteger(record.reservedFreeBytes, 'reservedFreeBytes'),
	};
	if (Object.hasOwn(record, 'configuredConcurrency')) {
		clampConcurrency(record.configuredConcurrency as number | undefined);
		if (record.configuredConcurrency !== undefined) {
			snapshot.configuredConcurrency = record.configuredConcurrency as number;
		}
	}
	if (Object.hasOwn(record, 'busyHardwareBackends')) {
		if (!Array.isArray(record.busyHardwareBackends)
			|| record.busyHardwareBackends.length > MAXIMUM_BUSY_HARDWARE_BACKENDS) {
			throw new NativeQueueAdmissionError('A native queue capacity snapshot has an invalid hardware backend list.');
		}
		const backends: string[] = [];
		const seen = new Set<string>();
		for (const backend of record.busyHardwareBackends as readonly unknown[]) {
			if (typeof backend !== 'string' || !HARDWARE_BACKEND.test(backend)) {
				throw new NativeQueueAdmissionError('A native queue capacity snapshot names an invalid hardware backend.');
			}
			if (seen.has(backend)) {
				throw new NativeQueueAdmissionError('A native queue capacity snapshot names the same hardware backend twice.');
			}
			seen.add(backend);
			backends.push(backend);
		}
		snapshot.busyHardwareBackends = Object.freeze(backends);
	}
	return Object.freeze(snapshot);
}

/**
 * Choose which queued jobs to dispatch now.
 *
 * Running jobs are counted against the ceiling and their reservations are
 * assumed already deducted from the supplied capacity, so a caller reports what
 * is *left*, not what the machine has in total.
 */
export function admitNativeQueueJobs(
	queued: readonly NativeQueueRecordV1[],
	runningCount: number,
	capacity: NativeQueueCapacityV1,
): NativeQueueAdmissionV1 {
	const concurrencyCeiling = clampConcurrency(capacity.configuredConcurrency);
	const running = nonNegativeInteger(runningCount, 'runningCount');
	let cpuCores = nonNegativeInteger(capacity.availableCpuCores, 'availableCpuCores');
	let rssBytes = nonNegativeInteger(capacity.availableProcessTreeRssBytes, 'availableProcessTreeRssBytes');
	let scratchBytes = nonNegativeInteger(capacity.availableScratchBytes, 'availableScratchBytes');
	let freeBytes = nonNegativeInteger(capacity.volumeFreeBytes, 'volumeFreeBytes');
	let reservedFreeBytes = nonNegativeInteger(capacity.reservedFreeBytes, 'reservedFreeBytes');
	const busyHardware = new Set(capacity.busyHardwareBackends ?? []);

	const admitted: string[] = [];
	const deferred: NativeQueueDeferralV1[] = [];
	for (const record of fifo(queued)) {
		if (record.state !== 'queued') continue;
		if (running + admitted.length >= concurrencyCeiling) {
			deferred.push(deferral(record.jobId, 'concurrency-limit'));
			continue;
		}
		const reason = firstUnmetReservation(record, {
			cpuCores, rssBytes, scratchBytes, freeBytes, reservedFreeBytes, busyHardware,
		});
		if (reason !== null) {
			deferred.push(deferral(record.jobId, reason));
			continue;
		}
		cpuCores -= record.reservations.cpuCores;
		rssBytes -= record.reservations.processTreeRssBytes;
		scratchBytes -= record.reservations.scratchBytes;
		freeBytes -= record.reservations.scratchBytes;
		// An admitted job holds its declared floor for as long as it runs, so the
		// floor joins the volume's own reserve and the jobs behind it must leave
		// it alone too.
		reservedFreeBytes = Math.max(reservedFreeBytes, record.reservations.minimumFreeBytes);
		if (record.reservations.hardwareBackend !== null) {
			busyHardware.add(record.reservations.hardwareBackend);
		}
		admitted.push(record.jobId);
	}
	return Object.freeze({
		concurrencyCeiling,
		admitted: Object.freeze(admitted),
		deferred: Object.freeze(deferred),
	});
}

/** Clamp a user-chosen concurrency into the supported range. */
export function clampNativeQueueConcurrency(value: unknown): number {
	return clampConcurrency(value as number | undefined);
}

interface Budget {
	readonly cpuCores: number;
	readonly rssBytes: number;
	readonly scratchBytes: number;
	readonly freeBytes: number;
	readonly reservedFreeBytes: number;
	readonly busyHardware: ReadonlySet<string>;
}

function firstUnmetReservation(
	record: NativeQueueRecordV1,
	budget: Budget,
): NativeQueueDeferralReason | null {
	const reservations = record.reservations;
	if (reservations.cpuCores > budget.cpuCores) return 'cpu-reservation';
	if (reservations.processTreeRssBytes > budget.rssBytes) return 'rss-reservation';
	if (reservations.scratchBytes > budget.scratchBytes) return 'scratch-reservation';
	// The minimum-free rule is whichever floor is higher: the volume's own
	// reserve or the one this job declared for itself.
	const floor = Math.max(budget.reservedFreeBytes, reservations.minimumFreeBytes);
	if (budget.freeBytes - reservations.scratchBytes < floor) return 'free-space-reservation';
	if (reservations.hardwareBackend !== null && budget.busyHardware.has(reservations.hardwareBackend)) {
		return 'hardware-busy';
	}
	return null;
}

function fifo(queued: readonly NativeQueueRecordV1[]): readonly NativeQueueRecordV1[] {
	return [...queued].sort((left, right) => (
		left.position - right.position
		|| left.createdAtMs - right.createdAtMs
		|| (left.jobId < right.jobId ? -1 : left.jobId > right.jobId ? 1 : 0)
	));
}

function deferral(jobId: string, reason: NativeQueueDeferralReason): NativeQueueDeferralV1 {
	return Object.freeze({ jobId, reason });
}

function clampConcurrency(value: number | undefined): number {
	if (value === undefined) return NATIVE_QUEUE_DEFAULT_CONCURRENCY;
	if (!Number.isSafeInteger(value)) {
		throw new NativeQueueAdmissionError('Native queue concurrency must be a safe integer.');
	}
	return Math.min(NATIVE_QUEUE_MAXIMUM_CONCURRENCY, Math.max(NATIVE_QUEUE_MINIMUM_CONCURRENCY, value));
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new NativeQueueAdmissionError(`Native queue capacity ${label} must be a non-negative safe integer.`);
	}
	return value as number;
}
