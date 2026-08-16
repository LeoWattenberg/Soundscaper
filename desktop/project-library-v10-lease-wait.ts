/* SPDX-License-Identifier: AGPL-3.0-only */

const DEFAULT_POLL_INTERVAL_MS = 100;
/** Both catalogs raise a held lease as `<product> desktop V10 writer lease is busy`. */
const CONTENDED_LEASE_MESSAGE = / desktop V10 writer lease is busy$/u;
/** SQLITE_BUSY and SQLITE_LOCKED, as node:sqlite reports them on `errcode`. */
const CONTENDED_SQLITE_CODES: readonly number[] = [5, 6];

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
 *
 * Only contention clears on its own. Every other failure — a corrupt lease row, a
 * database the schema cannot open — repeats identically, so it is reported at once
 * rather than after a wait long enough to look like a hung launch.
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
			if (remaining <= 0 || !isLeaseContention(error)) throw error;
			await delay(Math.min(pollIntervalMs, remaining));
		}
	}
}

function isLeaseContention(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if (CONTENDED_LEASE_MESSAGE.test(error.message)) return true;
	const { errcode } = error as { readonly errcode?: unknown };
	return typeof errcode === 'number' && CONTENDED_SQLITE_CODES.includes(errcode);
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
