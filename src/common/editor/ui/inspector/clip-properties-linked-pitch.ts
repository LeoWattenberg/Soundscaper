/* SPDX-License-Identifier: AGPL-3.0-only */

/** Linked pitch describes playback speed while independent pitch stays on the clip. */
export function clipLinkedPitchSpeed(value: unknown, unit: 'semitones' | 'percent', rangeMessage: string): number {
	const text = String(value ?? '').trim();
	const amount = Number(text);
	const speedRatio = unit === 'percent' ? 1 + amount / 100 : 2 ** (amount / 12);
	const tolerance = Number.EPSILON * Math.max(1, Math.abs(speedRatio)) * 4;
	if (!text || !Number.isFinite(amount) || !Number.isFinite(speedRatio) || speedRatio < 0.001 - tolerance || speedRatio > 1000 + tolerance) {
		throw new RangeError(rangeMessage);
	}
	return Math.max(0.001, Math.min(1000, speedRatio));
}
