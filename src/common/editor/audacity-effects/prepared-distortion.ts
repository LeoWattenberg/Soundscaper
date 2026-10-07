/* SPDX-License-Identifier: GPL-3.0-only */

import { interpolateDistortionSample } from './distortion-table.js';

/** Select the immutable shaping and output-mixing paths before visiting PCM. */
export function prepareDistortionShaper(table: Float64Array, mode: number, parameter1: number): (input: number) => number {
	if (mode !== 0) return (input) => interpolateDistortionSample(input, table) as number;
	const gain = 1 + parameter1 / 100;
	return (input) => interpolateDistortionSample(Math.fround(input * gain), table) as number;
}

export function prepareDistortionMixer(mode: number, parameter1: number, parameter2: number,
	makeupGain: number): (shaped: number, dry: number) => number {
	const p1 = parameter1 / 100;
	const p2 = parameter2 / 100;
	if (mode === 0 || mode === 1) {
		const gain = (1 - p2) + makeupGain * p2;
		return (shaped) => Math.fround(shaped * gain);
	}
	if (mode === 2 || mode === 3 || mode === 4 || mode === 5 || mode === 7) return (shaped) => Math.fround(shaped * p2);
	if (mode === 10) {
		const gain = p1 - p2;
		return (shaped, dry) => Math.fround(shaped * gain + dry * p2);
	}
	return (shaped) => Math.fround(shaped);
}
