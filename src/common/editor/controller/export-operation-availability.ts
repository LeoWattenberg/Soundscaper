/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ExportOperationAvailability {
	readonly available: () => boolean;
	readonly whenAvailable: () => Promise<void>;
	readonly notifyIfAvailable: () => void;
}

/** Coordinate callers waiting for an export owner that settles outside their service. */
export function createExportOperationAvailability(
	available: () => boolean,
): ExportOperationAvailability {
	const waiters = new Set<() => void>();
	const whenAvailable = () => available()
		? Promise.resolve()
		: new Promise<void>((resolve) => { waiters.add(resolve); });
	const notifyIfAvailable = () => {
		if (!available()) return;
		for (const resolve of waiters) resolve();
		waiters.clear();
	};
	return Object.freeze({ available, whenAvailable, notifyIfAvailable });
}
