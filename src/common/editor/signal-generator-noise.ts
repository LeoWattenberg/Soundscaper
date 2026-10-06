/* SPDX-License-Identifier: AGPL-3.0-only */

type NoiseColor = 'white' | 'pink' | 'brown';

function xorshift(state: number): number {
	state ^= state << 13;
	state ^= state >>> 17;
	state ^= state << 5;
	return state >>> 0;
}

function transform(matrix: Uint32Array, state: number): number {
	let result = 0;
	for (let bit = 0; bit < 32; bit += 1) if ((state >>> bit) & 1) result ^= matrix[bit]!;
	return result >>> 0;
}

function compose(left: Uint32Array, right: Uint32Array): Uint32Array {
	return Uint32Array.from(right, (column) => transform(left, column));
}

/** One GF(2) matrix jumps across a whole preceding channel in logarithmic work. */
function channelJump(frames: number): Uint32Array {
	let result: Uint32Array = Uint32Array.from({ length: 32 }, (_, bit) => (1 << bit) >>> 0);
	let power: Uint32Array = Uint32Array.from(result, xorshift);
	for (let remaining = frames; remaining > 0; remaining = Math.floor(remaining / 2)) {
		if (remaining % 2) result = compose(power, result);
		power = compose(power, power);
	}
	return result;
}

export function createNoiseBlockRenderer(frameCount: number, channelCount: number, amplitude: number,
	color: NoiseColor, seed: number): (frames: number) => Float32Array[] {
	const jump = channelCount > 1 ? channelJump(frameCount) : null;
	let initial = seed;
	const states = Array.from({ length: channelCount }, () => {
		const state = { random: initial, brown: 0, pinkBins: new Float64Array(7), pinkTotal: 0, counter: 0 };
		if (jump) initial = transform(jump, initial);
		return state;
	});
	return (frames) => states.map((state) => {
		const output = new Float32Array(frames);
		let random = state.random;
		let brown = state.brown;
		let counter = state.counter;
		let pinkTotal = state.pinkTotal;
		const pinkBins = state.pinkBins;
		for (let frame = 0; frame < frames; frame += 1) {
			random = xorshift(random);
			const white = random / 0x8000_0000 - 1;
			if (color === 'white') output[frame] = white * amplitude;
			else if (color === 'brown') {
				brown = Math.max(-1, Math.min(1, brown * 0.995 + white * 0.05));
				output[frame] = brown * amplitude;
			} else {
				counter += 1;
				let zeroes = 0;
				let value = counter;
				while ((value & 1) === 0 && zeroes < pinkBins.length) { zeroes += 1; value >>= 1; }
				if (zeroes < pinkBins.length) {
					pinkTotal += white - pinkBins[zeroes]!;
					pinkBins[zeroes] = white;
				}
				output[frame] = Math.max(-1, Math.min(1, (pinkTotal + white) / 4)) * amplitude;
			}
		}
		state.random = random;
		state.brown = brown;
		state.counter = counter;
		state.pinkTotal = pinkTotal;
		return output;
	});
}
