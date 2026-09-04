/* SPDX-License-Identifier: AGPL-3.0-only */

/** A caller waiting on the progress of one persistent delivery. */
export type PersistentProgressObserver = (progress: number) => unknown;

export interface PersistentExportProgressReporter {
	/** Report progress to the observer of the delivery currently running, if any. */
	readonly report: (value: unknown) => void;
	/** Begin reporting to a new observer, from zero. */
	readonly observe: (observer: PersistentProgressObserver | null) => void;
	/** Stop reporting to `observer`, unless a later delivery has already replaced it. */
	readonly release: (observer: PersistentProgressObserver | null) => void;
}

/**
 * Track the progress of a persistent audio delivery for the caller that asked for one.
 *
 * A delivery's progress must never appear to go backwards — the export pipeline reports
 * from several stages whose ranges overlap — so the reporter clamps to the unit interval
 * and keeps the highest value seen for the delivery in flight.
 */
export function createPersistentExportProgressReporter(): PersistentExportProgressReporter {
	let observer: PersistentProgressObserver | null = null;
	let reported = 0;
	return Object.freeze({
		report: (value: unknown) => {
			if (!observer || typeof value !== 'number' || !Number.isFinite(value)) return;
			const normalized = Math.max(0, Math.min(1, value));
			if (normalized < reported) return;
			reported = normalized;
			observer(normalized);
		},
		observe: (next: PersistentProgressObserver | null) => {
			reported = 0;
			observer = next;
		},
		release: (previous: PersistentProgressObserver | null) => {
			if (observer === previous) observer = null;
		},
	});
}
