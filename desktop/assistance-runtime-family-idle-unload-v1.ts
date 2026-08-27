/* SPDX-License-Identifier: AGPL-3.0-only */

/** Idle unloading for the lazy Milestone 7 runtime families, so nothing holds memory it is not using. */

export const ASSISTANCE_RUNTIME_FAMILY_IDLE_UNLOAD_MS = 120_000;
const MAXIMUM_IDLE_UNLOAD_MS = 3_600_000;

export interface AssistanceIdleUnloadSchedulerOptions {
	readonly idleUnloadMs: number;
	readonly setTimeoutImpl?: typeof setTimeout;
	readonly clearTimeoutImpl?: typeof clearTimeout;
}

export interface AssistanceIdleUnloadScheduler {
	/** Replaces any pending unload for this key with one armed from now. */
	schedule(key: string, unload: () => void): void;
	cancel(key: string): void;
	/** Cancels every pending unload without running any of them. */
	dispose(): void;
}

/**
 * A runtime family is spawned lazily and kept warm so a second job does not pay
 * the handshake again. Keeping it warm forever is the part that is impolite: an
 * idle inference process can hold gigabytes the editor would rather have. The
 * scheduler gives that memory back after a quiet period, and the next job simply
 * spawns again.
 */
export function createAssistanceIdleUnloadScheduler(
	options: AssistanceIdleUnloadSchedulerOptions,
): AssistanceIdleUnloadScheduler {
	const idleUnloadMs = validateIdleUnloadMs(options?.idleUnloadMs);
	const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
	const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	function cancel(key: string): void {
		const timer = timers.get(key);
		if (timer === undefined) return;
		timers.delete(key);
		clearTimeoutImpl(timer);
	}

	return Object.freeze({
		schedule(key: string, unload: () => void): void {
			if (typeof key !== 'string' || key === '' || typeof unload !== 'function') {
				throw new TypeError('The assistance idle-unload request is invalid.');
			}
			cancel(key);
			timers.set(key, setTimeoutImpl(() => {
				timers.delete(key);
				unload();
			}, idleUnloadMs));
		},
		cancel,
		dispose(): void {
			for (const timer of timers.values()) clearTimeoutImpl(timer);
			timers.clear();
		},
	});
}

function validateIdleUnloadMs(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1
		|| (value as number) > MAXIMUM_IDLE_UNLOAD_MS) {
		throw new RangeError('The assistance idle-unload interval is invalid.');
	}
	return value as number;
}
