/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity 3.7.7's Bass and Treble shelving biquad, adapted from commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-builtin-effects/BassTrebleBase.cpp by Steve Daulton.
 * Audacity distributes that work under GPL; this modified TypeScript
 * adaptation was created for kw.media in 2026 and selects GPL version 3.
 */

import { iirReleaseBoundFrames, type NormalizedIirCoefficients } from '../first-party-effects/standard/filters-coefficients.ts';

export interface AudacityShelfCoefficients {
	readonly b0: number;
	readonly b1: number;
	readonly b2: number;
	readonly a0: number;
	readonly a1: number;
	readonly a2: number;
}

/** Pure coefficients shared by the runtime and its startup-safe release contract. */
export function audacityShelfCoefficients(
	frequency: number,
	slope: number,
	gainDb: number,
	sampleRate: number,
	highShelf: boolean,
): AudacityShelfCoefficients {
	const omega = 2 * Math.PI * frequency / sampleRate;
	const amplitude = Math.exp(Math.log(10) * gainDb / 40);
	const beta = Math.sqrt((amplitude * amplitude + 1) / slope - (amplitude - 1) ** 2);
	const sine = Math.sin(omega);
	const cosine = Math.cos(omega);
	if (!highShelf) return {
		b0: amplitude * ((amplitude + 1) - (amplitude - 1) * cosine + beta * sine),
		b1: 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosine),
		b2: amplitude * ((amplitude + 1) - (amplitude - 1) * cosine - beta * sine),
		a0: (amplitude + 1) + (amplitude - 1) * cosine + beta * sine,
		a1: -2 * ((amplitude - 1) + (amplitude + 1) * cosine),
		a2: (amplitude + 1) + (amplitude - 1) * cosine - beta * sine,
	};
	return {
		b0: amplitude * ((amplitude + 1) + (amplitude - 1) * cosine + beta * sine),
		b1: -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosine),
		b2: amplitude * ((amplitude + 1) + (amplitude - 1) * cosine - beta * sine),
		a0: (amplitude + 1) - (amplitude - 1) * cosine + beta * sine,
		a1: 2 * ((amplitude - 1) - (amplitude + 1) * cosine),
		a2: (amplitude + 1) - (amplitude - 1) * cosine - beta * sine,
	};
}

function normalizeSection(coefficients: AudacityShelfCoefficients): NormalizedIirCoefficients {
	const { b0, b1, b2, a0, a1, a2 } = coefficients;
	return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function releaseFrames(coefficients: readonly NormalizedIirCoefficients[], gainDb: number): number {
	if (!coefficients.length) return 0;
	const gain = Math.exp(Math.log(10) * gainDb / 20);
	const [b0, b1, b2, a1, a2] = coefficients[0]!;
	return iirReleaseBoundFrames([[b0 * gain, b1 * gain, b2 * gain, a1, a2], ...coefficients.slice(1)]) + 128;
}

/** Stationary shelves and fixed Wahwah use their actual normalized poles.
 * The binomial cascade envelope bounds unit-peak input below -80 dB and leaves
 * one quiet render quantum. An active Wahwah LFO changes the recurrence; a
 * fixed-pole estimate cannot bound that state. Its caller retains the existing
 * combined ten-second rack budget instead of declaring an absent release.
 */
export function audacityResidualFilterTailFrames(
	type: string,
	sampleRate: number,
	params: Readonly<Record<string, unknown>>,
): number | null {
	if (type === 'audacity-phaser') return phaserReleaseFrames(params);
	if (type === 'audacity-bass-treble') {
		const sections: NormalizedIirCoefficients[] = [];
		const slope = Math.fround(.4);
		if (Number(params.bassDb) !== 0) {
			sections.push(normalizeSection(audacityShelfCoefficients(250, slope, Number(params.bassDb), sampleRate, false)));
		}
		// At the supported 8 kHz native clock, the 4 kHz shelf is the identity
		// transfer at Nyquist; its cancelling unit poles carry no audible release.
		if (Number(params.trebleDb) !== 0 && sampleRate > 8000) {
			sections.push(normalizeSection(audacityShelfCoefficients(4000, slope, Number(params.trebleDb), sampleRate, true)));
		}
		return releaseFrames(sections, Number(params.volumeDb));
	}
	if (type !== 'audacity-wahwah') return null;
	const offset = Number(params.frequencyOffsetPercent) / 100;
	if (offset === 1) return 0;
	if (Number(params.depthPercent) !== 0) return Number.MAX_SAFE_INTEGER;
	const omega = Math.PI * Math.exp((offset - 1) * 6);
	const cosine = Math.cos(omega);
	const alpha = Math.sin(omega) / (2 * Number(params.resonance));
	const a0 = 1 + alpha;
	return releaseFrames([[(1 - cosine) / (2 * a0), (1 - cosine) / a0,
		(1 - cosine) / (2 * a0), -2 * cosine / a0, (1 - alpha) / a0]], Number(params.outputGainDb));
}

/** At zero depth, the even all-pass cascade is identity but its feedback still
 * delays one sample. Bound that independent pole and its accumulated gain.
 * With modulation, held all-pass coefficients change the network recurrence;
 * retain the caller's existing ten-second rack budget rather than claim a
 * stationary pole bound. A dry-only output has no audible release in either case.
 */
function phaserReleaseFrames(params: Readonly<Record<string, unknown>>): number {
	const wet = Number(params.dryWet) / 255;
	if (wet === 0) return 0;
	if (Number(params.depth) !== 0) return Number.MAX_SAFE_INTEGER;
	const pole = Math.abs(Number(params.feedbackPercent) / 101);
	if (pole === 0) return 0;
	const gain = wet * 10 ** (Number(params.outputGainDb) / 20);
	const headroom = Math.max(1, gain / (1 - pole));
	return Math.ceil(Math.log(.0001 / headroom) / Math.log(pole)) + 128;
}
