/* SPDX-License-Identifier: GPL-3.0-only */

/*
 * The logarithmic histogram spacing and gates of the Audacity loudness
 * adaptation in basic-loudness.js. Powers above the original array's upper
 * bound need bins too: K weighting can put ordinary, unclipped audio there.
 * Keep those bins sparse and the original bins and summation order intact.
 */

const BIN_COUNT = 65_536;
const ABSOLUTE_GATE = (-70 + 0.691) / 10;

export interface LoudnessPowerHistogram {
	add(power: number): 0 | 1;
	meanPower(): number;
}

export function createLoudnessPowerHistogram(): LoudnessPowerHistogram {
	const regular = new Uint32Array(BIN_COUNT);
	const high = new Map<number, number>();
	return {
		add(power) {
			if (!(power > 0)) return 0;
			const index = powerIndex(power);
			if (index < 0) return 0;
			if (index < BIN_COUNT) regular[index] = regular[index]! + 1;
			else high.set(index, (high.get(index) ?? 0) + 1);
			return 1;
		},
		meanPower() {
			const absolute = sums(0);
			if (absolute.count === 0 || absolute.power === 0) return 0;
			const relativeIndex = powerIndex(absolute.power / absolute.count / 10);
			const gated = sums(Math.max(0, relativeIndex + 1));
			return gated.count === 0 ? 0 : gated.power / gated.count;
		},
	};

	function sums(startIndex: number): { power: number; count: number } {
		let power = 0;
		let count = 0;
		for (let index = startIndex; index < BIN_COUNT; index += 1) {
			const entries = regular[index]!;
			if (entries === 0) continue;
			power += binPower(index) * entries;
			count += entries;
		}
		for (const index of [...high.keys()].sort((first, second) => first - second)) {
			if (index < startIndex) continue;
			const entries = high.get(index)!;
			power += binPower(index) * entries;
			count += entries;
		}
		return { power, count };
	}
}

function powerIndex(power: number): number {
	return Math.round((Math.log10(power) - ABSOLUTE_GATE) * BIN_COUNT / -ABSOLUTE_GATE - 1);
}

function binPower(index: number): number {
	return 10 ** (-ABSOLUTE_GATE / BIN_COUNT * (index + 1) + ABSOLUTE_GATE);
}
