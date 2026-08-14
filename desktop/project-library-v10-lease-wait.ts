/* SPDX-License-Identifier: AGPL-3.0-only */

const DEFAULT_POLL_INTERVAL_MS = 100;

export interface ProjectLibraryV10LeaseWaitOptions {
	readonly waitMs: number;
	readonly pollIntervalMs?: number;
}

/**
 * Acquire a writer lease, waiting out a lease an earlier process left behind.
 *
 * A crash or force quit leaves the previous owner's lease unexpired, and acquisition
 * refuses any unexpired lease. Without a wait the application exits before it shows a
 * window, and relaunching keeps failing until the lease ages out. Waiting rather than
 * pre-empting keeps a genuinely live owner safe: only expiry proves the holder is gone.
 */
export async function acquireProjectLibraryV10LeaseWithWait<Lease>(
	acquire: () => Lease,
	options: ProjectLibraryV10LeaseWaitOptions,
): Promise<Lease> {
	const waitMs = boundedMilliseconds(options.waitMs, 'lease wait');
	const pollIntervalMs = Math.max(
		10,
		Math.min(boundedMilliseconds(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, 'lease poll interval'), 1_000),
	);
	const deadline = Date.now() + waitMs;
	for (;;) {
		try {
			return acquire();
		} catch (error) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) throw error;
			await delay(Math.min(pollIntervalMs, remaining));
		}
	}
}

function delay(durationMs: number): Promise<void> {
	return new Promise((resolve) => { setTimeout(resolve, durationMs); });
}

function boundedMilliseconds(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 600_000) {
		throw new RangeError(`${name} must be an integer from 0 through 600000 milliseconds`);
	}
	return value as number;
}
