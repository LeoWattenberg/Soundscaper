/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Property coverage for the two streaming resamplers.
 *
 * Both are stateful and bounded: they keep only a boundary between chunks, so
 * the thing worth checking is not one worked example but that the invariants
 * they promise hold whatever the rates, the signal and — above all — the
 * chunking are. Every run here is seeded, so a failure reproduces exactly.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import {
	createStreamingLinearResampler,
	createStreamingWindowedSincResampler,
} from '../src/common/editor/resample.js';

const SEED = 20_260_906;
const RUNS = 200;

/** The default `radius` the windowed-sinc resampler builds its kernel with. */
const SINC_RADIUS = 24;

/** Float32 storage rounds every written sample, so comparisons carry one ulp of slack. */
const FLOAT32_SLACK = 1e-6;

type Channels = readonly Float32Array[];

interface StreamingResampler {
	push(inputChannels: Channels): Channels;
	finish(requestedOutputFrames?: number | null): Channels;
}

function linearResampler(inputRate: number, outputRate: number, channelCount: number): StreamingResampler {
	return createStreamingLinearResampler(inputRate, outputRate, channelCount) as StreamingResampler;
}

function sincResampler(inputRate: number, outputRate: number, channelCount: number): StreamingResampler {
	return createStreamingWindowedSincResampler(inputRate, outputRate, channelCount) as StreamingResampler;
}

const rateArbitrary = fc.constantFrom(8000, 11_025, 16_000, 22_050, 32_000, 44_100, 48_000, 96_000);
const chunkPlanArbitrary = fc.array(fc.integer({ min: 1, max: 48 }), { minLength: 1, maxLength: 6, size: 'max' });
const sampleArbitrary = fc.float({ min: -1, max: 1, noNaN: true });
const signalArbitrary = fc.array(sampleArbitrary, { minLength: 1, maxLength: 160, size: 'max' });
const channelCountArbitrary = fc.integer({ min: 1, max: 2 });

/** One signal per channel, the second channel a distinct shape so a channel mix-up shows. */
function sourceOf(values: readonly number[], channelCount: number): Float32Array[] {
	return Array.from({ length: channelCount }, (_, channel) => (
		Float32Array.from(channel === 0 ? values : [...values].reverse())
	));
}

function driveResampler(
	resampler: StreamingResampler,
	source: readonly Float32Array[],
	plan: readonly number[],
): number[][] {
	const collected: number[][] = Array.from({ length: source.length }, () => []);
	const frameCount = source[0].length;
	let offset = 0;
	let step = 0;
	while (offset < frameCount) {
		const size = Math.min(plan[step % plan.length], frameCount - offset);
		step += 1;
		append(collected, resampler.push(source.map((channel) => channel.slice(offset, offset + size))));
		offset += size;
	}
	append(collected, resampler.finish());
	return collected;
}

function append(collected: number[][], produced: Channels): void {
	produced.forEach((channel, index) => {
		for (const value of channel) collected[index].push(value);
	});
}

function peakOf(values: readonly number[]): number {
	return values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
}

/**
 * The tightest factor by which the windowed-sinc kernel can amplify a unit-peak
 * input at the output positions this run actually samples.
 *
 * Each output is `sum(tap * sample) / sum(tap)`, so by the triangle inequality
 * its magnitude is at most the input peak times `sum(|tap|) / |sum(tap)|`. The
 * taps are dropped outside the input, which is why the bound is larger near the
 * edges than in the interior, and why it has to be recomputed per run rather
 * than fixed at one number.
 */
function windowedSincPeakGain(inputRate: number, outputRate: number, inputFrames: number): number {
	const step = inputRate / outputRate;
	const cutoff = Math.min(1, outputRate / inputRate) * 0.94;
	let bound = 1;
	for (let position = 0; position < inputFrames; position += step) {
		const center = Math.floor(position);
		let absolute = 0;
		let signed = 0;
		for (let frame = center - SINC_RADIUS + 1; frame <= center + SINC_RADIUS; frame += 1) {
			if (frame < 0 || frame >= inputFrames) continue;
			const distance = position - frame;
			const normalized = Math.abs(distance) / SINC_RADIUS;
			if (normalized >= 1) continue;
			const window = 0.5 + 0.5 * Math.cos(Math.PI * normalized);
			const argument = Math.PI * distance * cutoff;
			const sinc = argument === 0 ? 1 : Math.sin(argument) / argument;
			const weight = cutoff * sinc * window;
			absolute += Math.abs(weight);
			signed += weight;
		}
		if (signed !== 0) bound = Math.max(bound, absolute / Math.abs(signed));
	}
	return bound;
}

test('the output length follows the rate ratio whatever the chunking', () => {
	fc.assert(
		fc.property(rateArbitrary, rateArbitrary, signalArbitrary, chunkPlanArbitrary, (
			inputRate,
			outputRate,
			values,
			plan,
		) => {
			const source = sourceOf(values, 1);
			const expected = Math.round(values.length * outputRate / inputRate);
			const linear = driveResampler(linearResampler(inputRate, outputRate, 1), source, plan);
			assert.ok(
				Math.abs(linear[0].length - expected) <= 1,
				`linear produced ${String(linear[0].length)} frames for an expected ${String(expected)}`,
			);
			const sinc = driveResampler(sincResampler(inputRate, outputRate, 1), source, plan);
			assert.equal(sinc[0].length, expected, 'the windowed-sinc resampler lands on the ratio exactly');
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('the same signal resamples identically however it is chunked', () => {
	fc.assert(
		fc.property(
			rateArbitrary,
			rateArbitrary,
			signalArbitrary,
			channelCountArbitrary,
			chunkPlanArbitrary,
			chunkPlanArbitrary,
			(inputRate, outputRate, values, channelCount, firstPlan, secondPlan) => {
				const source = sourceOf(values, channelCount);
				for (const make of [linearResampler, sincResampler]) {
					const first = driveResampler(make(inputRate, outputRate, channelCount), source, firstPlan);
					const second = driveResampler(make(inputRate, outputRate, channelCount), source, secondPlan);
					assert.deepEqual(second, first, 'chunking must not change a single output sample');
				}
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('a constant input stays that constant, and silence stays silent', () => {
	fc.assert(
		fc.property(
			rateArbitrary,
			rateArbitrary,
			sampleArbitrary,
			fc.integer({ min: 1, max: 160 }),
			chunkPlanArbitrary,
			(inputRate, outputRate, level, frameCount, plan) => {
				const constant = sourceOf(new Array<number>(frameCount).fill(level), 1);
				const silence = sourceOf(new Array<number>(frameCount).fill(0), 1);
				for (const make of [linearResampler, sincResampler]) {
					for (const value of driveResampler(make(inputRate, outputRate, 1), constant, plan)[0]) {
						assert.ok(
							Math.abs(value - level) <= FLOAT32_SLACK,
							`constant ${String(level)} resampled to ${String(value)}`,
						);
					}
					for (const value of driveResampler(make(inputRate, outputRate, 1), silence, plan)[0]) {
						assert.equal(value, 0, 'silence in, silence out');
					}
				}
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('neither resampler exceeds the peak its filter can produce', () => {
	fc.assert(
		fc.property(rateArbitrary, rateArbitrary, signalArbitrary, chunkPlanArbitrary, (
			inputRate,
			outputRate,
			values,
			plan,
		) => {
			const source = sourceOf(values, 1);
			const peak = peakOf(values);
			// Linear interpolation is a convex combination of two neighbours, so it
			// overshoots by nothing at all.
			const linear = driveResampler(linearResampler(inputRate, outputRate, 1), source, plan)[0];
			assert.ok(
				peakOf(linear) <= peak + FLOAT32_SLACK,
				`linear resampling raised the peak from ${String(peak)} to ${String(peakOf(linear))}`,
			);
			const bound = peak * windowedSincPeakGain(inputRate, outputRate, values.length) + FLOAT32_SLACK;
			const sinc = driveResampler(sincResampler(inputRate, outputRate, 1), source, plan)[0];
			assert.ok(
				peakOf(sinc) <= bound,
				`windowed-sinc resampling reached ${String(peakOf(sinc))} past its ${String(bound)} bound`,
			);
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});
