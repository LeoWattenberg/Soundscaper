/* SPDX-License-Identifier: AGPL-3.0-only */

const DEFAULT_POLL_INTERVAL_MS = 100
const CONTENDED_LEASE_MESSAGE = /^Soundscaper desktop baseline writer lease is busy$/u
const CONTENDED_SQLITE_CODES: readonly number[] = [5, 6]

export interface SoundscaperDesktopProjectLibraryLeaseWaitOptions {
	readonly waitMs: number
	readonly pollIntervalMs?: number
}

/** Wait for an expired or released writer fence without masking non-contention failures. */
export async function acquireSoundscaperDesktopProjectLibraryLeaseWithWait<Lease>(
	acquire: () => Lease,
	options: SoundscaperDesktopProjectLibraryLeaseWaitOptions,
): Promise<Lease> {
	const waitMs = boundedMilliseconds(options.waitMs, 'lease wait')
	const pollIntervalMs = Math.max(
		10,
		Math.min(boundedMilliseconds(
			options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
			'lease poll interval',
		), 1_000),
	)
	const deadline = Date.now() + waitMs
	let leaseBusyError: Error | null = null
	for (;;) {
		try {
			return acquire()
		} catch (error) {
			const remaining = deadline - Date.now()
			if (!isLeaseContention(error)) throw error
			if (isWriterLeaseBusy(error)) leaseBusyError ??= error
			if (remaining <= 0) throw leaseBusyError ?? error
			await delay(Math.min(pollIntervalMs, remaining))
		}
	}
}

function isLeaseContention(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	if (isWriterLeaseBusy(error)) return true
	const { errcode } = error as { readonly errcode?: unknown }
	return typeof errcode === 'number' && CONTENDED_SQLITE_CODES.includes(errcode)
}

function isWriterLeaseBusy(error: unknown): error is Error {
	return error instanceof Error && CONTENDED_LEASE_MESSAGE.test(error.message)
}

function delay(durationMs: number): Promise<void> {
	return new Promise((resolve) => { setTimeout(resolve, durationMs) })
}

function boundedMilliseconds(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 600_000) {
		throw new RangeError(`${name} must be an integer from 0 through 600000 milliseconds`)
	}
	return value as number
}
