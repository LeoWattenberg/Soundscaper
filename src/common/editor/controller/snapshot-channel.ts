/* SPDX-License-Identifier: AGPL-3.0-only */

export interface SnapshotChannel<Snapshot> {
	get(): Snapshot;
	publish(options?: Readonly<{ force?: boolean }>): boolean;
	subscribe(listener: () => void): () => void;
	clear(): void;
}

/**
 * Cached external-store channel used by React's useSyncExternalStore contract.
 * Subscriber failures are isolated so one extension cannot starve the rest.
 */
export function createSnapshotChannel<Snapshot>({
	build,
	canPublish = () => true,
	onListenerError = (error) => globalThis.reportError?.(error),
}: {
	readonly build: () => Snapshot;
	readonly canPublish?: () => boolean;
	readonly onListenerError?: (error: unknown) => void;
}): Readonly<SnapshotChannel<Snapshot>> {
	if (typeof build !== 'function') throw new TypeError('A snapshot builder is required.');
	const listeners = new Set<() => void>();
	let snapshot: Snapshot | undefined;
	return Object.freeze({
		get(): Snapshot {
			snapshot ??= build();
			return snapshot;
		},
		publish({ force = false } = {}): boolean {
			if (!force && !canPublish()) return false;
			snapshot = build();
			for (const listener of [...listeners]) {
				try {
					listener();
				} catch (error) {
					onListenerError(error);
				}
			}
			return true;
		},
		subscribe(listener: () => void): () => void {
			if (typeof listener !== 'function') throw new TypeError('Audio editor subscribers must be functions.');
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		clear(): void {
			listeners.clear();
		},
	});
}
