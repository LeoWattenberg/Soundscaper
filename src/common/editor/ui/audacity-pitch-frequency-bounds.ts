/* SPDX-License-Identifier: AGPL-3.0-only */

/** The processor supports one octave in either direction. Alternate pitch
 * views must refuse a larger conversion instead of silently clamping it. */
export function pitchFrequencyBounds(other: number): readonly [number, number] {
	return [Math.max(1, other / 2), Math.min(100_000, other * 2)];
}

export function pitchFrequencyAvailable(other: number, next: number): boolean {
	const [minimum, maximum] = pitchFrequencyBounds(other);
	return next >= minimum && next <= maximum;
}

export function pitchOctaveBounds(other: number, zeroOctaveFrequency: number): readonly [number, number] {
	const [minimum, maximum] = pitchFrequencyBounds(other);
	return [Math.max(-1, Math.ceil(Math.log2(minimum / zeroOctaveFrequency) - 1e-10)),
		Math.min(9, Math.floor(Math.log2(maximum / zeroOctaveFrequency) + 1e-10))];
}
