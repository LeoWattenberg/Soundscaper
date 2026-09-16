/* SPDX-License-Identifier: AGPL-3.0-only */

export function audacityPitchParts(value: number): Readonly<{ semitones: number; cents: number }> {
	const rounded = Math.round(value * 100) / 100;
	const semitones = Math.floor(rounded);
	return { semitones, cents: Math.round((rounded - semitones) * 100) };
}

export function audacityPitchPercent(semitones: number): number {
	return (2 ** (semitones / 12) - 1) * 100;
}

export function audacitySemitonesFromPercent(percent: number): number {
	if (!Number.isFinite(percent) || percent <= -100) throw new RangeError('Pitch percentage must be greater than -100.');
	return 12 * Math.log2(1 + percent / 100);
}

export function audacitySemitonesFromFrequencies(from: number, to: number): number {
	if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) {
		throw new RangeError('Pitch frequencies must be positive.');
	}
	return 12 * Math.log2(to / from);
}

export function audacityVinylRateAvailable(from: number, to: number, range: readonly [number, number]): boolean {
	if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) return false;
	const percent = (to / from - 1) * 100;
	return percent >= range[0] && percent <= range[1];
}

interface NumericGesture {
	readonly onGestureBegin?: (value: number) => unknown;
	readonly onGesturePreview?: (value: number) => unknown;
	readonly onGestureCommit?: (value: number) => unknown;
	readonly onGestureCancel?: () => unknown;
}

/** A percentage slider still edits the owning semitone parameter in automation. */
export function audacityPitchPercentGesture(gesture: NumericGesture): NumericGesture {
	return {
		...(gesture.onGestureBegin && { onGestureBegin: (value: number) => gesture.onGestureBegin?.(audacitySemitonesFromPercent(value)) }),
		...(gesture.onGesturePreview && { onGesturePreview: (value: number) => gesture.onGesturePreview?.(audacitySemitonesFromPercent(value)) }),
		...(gesture.onGestureCommit && { onGestureCommit: (value: number) => gesture.onGestureCommit?.(audacitySemitonesFromPercent(value)) }),
		...(gesture.onGestureCancel && { onGestureCancel: () => gesture.onGestureCancel?.() }),
	};
}

/** Audacity's original Bass/Treble UpdateGain compensates a boost at half its
 * gain and a cut at one quarter. The editable output remains within +/-30dB. */
export function audacityLinkedToneGain(previous: number, next: number, output: number): number {
	const weighted = (value: number): number => value > 0 ? value / 2 : value / 4;
	return Math.min(30, Math.max(-30, output - (weighted(next) - weighted(previous))));
}

type NumericCommit = (value: number, automation: Readonly<{ controlValue: number }>) => unknown;

/** Preserve both controls' ordinary commit/automation paths, and compensate
 * only after the initiating edit finishes successfully. */
export async function commitAudacityLinkedTone(
	previous: number,
	next: number,
	output: number,
	commitTone: NumericCommit,
	commitOutput: NumericCommit,
): Promise<void> {
	if (await commitTone(next, { controlValue: next }) === false) return;
	const gain = audacityLinkedToneGain(previous, next, output);
	await commitOutput(gain, { controlValue: gain });
}
