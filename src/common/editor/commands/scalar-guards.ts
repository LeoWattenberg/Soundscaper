/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The safe-integer guards the timeline command modules validate their
 * deserialized payloads through.
 *
 * These had been copy-pasted into nine command modules and drifted apart: three
 * copies rejected negative zero and the rest quietly returned it, so the same
 * malformed frame index was accepted or refused depending on which module
 * happened to parse it first. Negative zero is out of range for a non-negative
 * or positive contract — it is not the zero a caller comparing with `Object.is`
 * expects — so it is refused there, and normalized away rather than propagated
 * by the plain signed guard. This matches the ruling already made for the
 * FFmpeg plan guards in `video-ffmpeg-plan-guards.ts`.
 *
 * The messages are load-bearing: callers assert on them, so they stay in the
 * one-RangeError-per-guard shape the command modules already used.
 */

export function safeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer.`);
	return Object.is(value, -0) ? 0 : Number(value);
}

export function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Object.is(value, -0) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

export function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
