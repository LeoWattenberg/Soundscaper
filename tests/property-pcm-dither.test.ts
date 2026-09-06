/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Property coverage for the shared dither noise source.
 *
 * The amplitudes this module documents are what every PCM encoder and the
 * bitcrusher rely on to keep quantization error uncorrelated with the signal,
 * and the seeded generator is what lets a render match playback bit for bit.
 * Both are claims about every input, not about one example, so they are checked
 * over generated ones under a fixed seed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import {
	PCM_ENCODER_DITHER_MODES,
	createSeededRandom,
	ditherFromUniforms,
	normalizePcmEncoderDither,
	pcmDitherNoise,
} from '../src/common/editor/pcm-dither.js';

const SEED = 20_260_906;
const RUNS = 200;

type DitherMode = 'none' | 'rectangular' | 'triangular' | 'triangular-highpass';

/** The peak amplitude each mode's header documents, in LSB. */
const DOCUMENTED_PEAK: Readonly<Record<DitherMode, number>> = Object.freeze({
	none: 0,
	rectangular: 0.5,
	triangular: 1,
	'triangular-highpass': 1,
});

const modeArbitrary = fc.constantFrom<DitherMode>('none', 'rectangular', 'triangular', 'triangular-highpass');
const seedArbitrary = fc.integer({ min: -2_147_483_648, max: 2_147_483_647 });
const uniformArbitrary = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });

function noiseOf(mode: DitherMode, random: () => number, channel: number, state: Float64Array): number {
	return pcmDitherNoise(mode, random, channel, state) as number;
}

function noiseFromUniforms(
	mode: DitherMode,
	first: number,
	second: number,
	channel: number,
	state: Float64Array,
): number {
	return ditherFromUniforms(mode, first, second, channel, state) as number;
}

test('every encoder dither option resolves to a mode the encoders offer', () => {
	fc.assert(
		fc.property(fc.oneof(fc.anything(), modeArbitrary, fc.constantFrom(false, true, 'none')), (value) => {
			const resolved = normalizePcmEncoderDither(value) as string;
			assert.ok(
				(PCM_ENCODER_DITHER_MODES as readonly string[]).includes(resolved),
				`"${resolved}" is not one of ${PCM_ENCODER_DITHER_MODES.join(', ')}`,
			);
			// Resolving an already-resolved option must not move it again, or a
			// setting would drift every time it passed through a writer.
			assert.equal(normalizePcmEncoderDither(resolved), resolved);
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('a seeded generator is deterministic and stays inside [0, 1)', () => {
	fc.assert(
		fc.property(seedArbitrary, fc.integer({ min: 1, max: 256 }), (seed, draws) => {
			const first = createSeededRandom(seed) as () => number;
			const second = createSeededRandom(seed) as () => number;
			// The seed is coerced through `>>> 0`, so a seed a full period apart is
			// the same seed and has to produce the same stream.
			const wrapped = createSeededRandom(seed + 2 ** 32) as () => number;
			for (let draw = 0; draw < draws; draw += 1) {
				const value = first();
				assert.ok(value >= 0 && value < 1, `draw ${String(draw)} was ${String(value)}`);
				assert.equal(second(), value, 'the same seed must replay the same stream');
				assert.equal(wrapped(), value, 'the seed is a 32-bit value');
			}
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('a seeded generator is uniform over [0, 1)', () => {
	const BUCKETS = 10;
	const DRAWS = 20_000;
	fc.assert(
		fc.property(seedArbitrary, (seed) => {
			const random = createSeededRandom(seed) as () => number;
			const counts = new Array<number>(BUCKETS).fill(0);
			let total = 0;
			for (let draw = 0; draw < DRAWS; draw += 1) {
				const value = random();
				counts[Math.floor(value * BUCKETS)] += 1;
				total += value;
			}
			const expected = DRAWS / BUCKETS;
			counts.forEach((count, bucket) => {
				assert.ok(
					Math.abs(count - expected) <= expected * 0.15,
					`bucket ${String(bucket)} held ${String(count)} of an expected ${String(expected)}`,
				);
			});
			assert.ok(Math.abs(total / DRAWS - 0.5) <= 0.01, `mean was ${String(total / DRAWS)}`);
		}),
		{ seed: SEED, numRuns: 20 },
	);
});

test('each mode stays inside the amplitude its header documents', () => {
	fc.assert(
		fc.property(
			modeArbitrary,
			seedArbitrary,
			fc.integer({ min: 1, max: 4 }),
			fc.integer({ min: 1, max: 400 }),
			(mode, seed, channelCount, samples) => {
				const random = createSeededRandom(seed) as () => number;
				const state = new Float64Array(channelCount);
				const peak = DOCUMENTED_PEAK[mode];
				for (let sample = 0; sample < samples; sample += 1) {
					const channel = sample % channelCount;
					const noise = noiseOf(mode, random, channel, state);
					assert.ok(Number.isFinite(noise), `mode ${mode} produced ${String(noise)}`);
					assert.ok(Math.abs(noise) <= peak, `mode ${mode} reached ${String(noise)} past ${String(peak)} LSB`);
					// The high-pass variant differences against the previous triangular
					// draw, so its carried state has to stay a triangular value.
					assert.ok(Math.abs(state[channel]) <= 1, `carried state reached ${String(state[channel])}`);
				}
				if (mode === 'none') assert.equal(state.every((value) => value === 0), true);
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('the uniform-fed entry point produces exactly what the drawing one does', () => {
	fc.assert(
		fc.property(
			modeArbitrary,
			fc.array(fc.tuple(uniformArbitrary, uniformArbitrary), { minLength: 1, maxLength: 64, size: 'max' }),
			fc.integer({ min: 1, max: 3 }),
			(mode, uniforms, channelCount) => {
				const drawnState = new Float64Array(channelCount);
				const suppliedState = new Float64Array(channelCount);
				uniforms.forEach(([first, second], index) => {
					const channel = index % channelCount;
					const queue = [first, second];
					const drawn = noiseOf(mode, () => queue.shift() ?? 0, channel, drawnState);
					const supplied = noiseFromUniforms(mode, first, second, channel, suppliedState);
					assert.equal(drawn, supplied, `mode ${mode} disagreed at index ${String(index)}`);
					assert.ok(Math.abs(supplied) <= DOCUMENTED_PEAK[mode]);
				});
				// A real-time processor draws unconditionally so the stream stays in
				// step; only the modes that consume two uniforms may leave the state
				// carrying anything.
				if (mode !== 'triangular-highpass') {
					assert.equal(suppliedState.every((value) => value === 0), true);
				}
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('the noise a mode adds is centred on zero', () => {
	const SAMPLES = 40_000;
	fc.assert(
		fc.property(modeArbitrary, seedArbitrary, (mode, seed) => {
			const random = createSeededRandom(seed) as () => number;
			const state = new Float64Array(1);
			let total = 0;
			for (let sample = 0; sample < SAMPLES; sample += 1) total += noiseOf(mode, random, 0, state);
			assert.ok(
				Math.abs(total / SAMPLES) <= 0.01,
				`mode ${mode} averaged ${String(total / SAMPLES)} LSB, which would bias the quantizer`,
			);
		}),
		{ seed: SEED, numRuns: 12 },
	);
});
