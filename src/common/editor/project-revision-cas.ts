/* SPDX-License-Identifier: AGPL-3.0-only */

/** A persisted project revision: a non-negative safe integer. */
export function isProjectRevision(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The compare-and-swap rule every project publication path shares. A coalesced
 * autosave commits more than once before it persists, so a replacement may
 * advance to any strictly higher revision over its exact base rather than only
 * the next one; the safe-integer ceiling leaves no revision above it.
 */
export function isStrictlyHigherProjectRevision(nextValue: unknown, currentValue: unknown): boolean {
	return isProjectRevision(nextValue) && isProjectRevision(currentValue) && nextValue > currentValue;
}
