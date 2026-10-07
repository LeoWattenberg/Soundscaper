/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface Histogram { push(energy: number): void; integratedLufs(): number | null; loudnessRangeLu(): number | null; reset(): void }
interface TruePeak { readonly history: Float64Array; writeIndex: number; peak: number }
interface InstrumentedLoudness {
	createLoudnessHistogram(): Histogram;
	createTruePeakState(): TruePeak;
	pushTruePeak(state: TruePeak, sample: number): number;
	readonly work: { taps: number; bins: number; ranks: number };
}

async function instrument(): Promise<InstrumentedLoudness> {
	const source = await readFile(new URL('../src/common/editor/ebu-r128.js', import.meta.url), 'utf8');
	const counted = source.replace('interpolated += state.history[index]', 'work.taps++; interpolated += state.history[index]')
		.replace('function binLoudness(index) {', 'function binLoudness(index) { work.bins++;')
		.replaceAll('visited += counts[index];', 'work.ranks++; visited += counts[index];');
	return await import(`data:text/javascript,${encodeURIComponent(`const work = { taps: 0, bins: 0, ranks: 0 };\n${counted}\nexport { work, createLoudnessHistogram, createTruePeakState, pushTruePeak };`)}`) as InstrumentedLoudness;
}

test('zero true-peak history performs no FIR tap multiplications after exact history drains', async () => {
	const module = await instrument(); const state = module.createTruePeakState();
	module.work.taps = 0;
	for (let frame = 0; frame < 997; frame++) assert.equal(module.pushTruePeak(state, frame % 2 ? 0 : -0), 0);
	assert.equal(module.work.taps, 0);
	module.pushTruePeak(state, .7);
	assert.equal(module.work.taps, 48);
	for (let frame = 0; frame < 12; frame++) module.pushTruePeak(state, 0);
	const drained = module.work.taps;
	module.pushTruePeak(state, -0);
	assert.equal(module.work.taps, drained);
	assert.ok(state.history.every(sample => sample === 0));
});

test('unchanged loudness histograms reuse summaries and invalidate only real mutations', async () => {
	const module = await instrument(); const histogram = module.createLoudnessHistogram();
	for (const energy of [.0001, .01, .1, .7]) histogram.push(energy);
	const first = [histogram.integratedLufs(), histogram.loudnessRangeLu()]; module.work.bins = 0;
	for (let repeat = 0; repeat < 100; repeat++) assert.deepEqual([histogram.integratedLufs(), histogram.loudnessRangeLu()], first);
	assert.equal(module.work.bins, 0);
	histogram.push(0); histogram.push(NaN);
	assert.deepEqual([histogram.integratedLufs(), histogram.loudnessRangeLu()], first);
	assert.equal(module.work.bins, 0, 'rejected energies do not mutate the histogram');
	histogram.push(.91);
	assert.notDeepEqual([histogram.integratedLufs(), histogram.loudnessRangeLu()], first);
	assert.ok(module.work.bins > 0);
	histogram.reset();
	assert.deepEqual([histogram.integratedLufs(), histogram.loudnessRangeLu()], [null, null]);
});

test('loudness gating avoids empty-bin conversion and resolves percentile ranks in one traversal', async () => {
	const module = await instrument(); const sparse = module.createLoudnessHistogram();
	sparse.push(10 ** (-61 / 10)); sparse.push(10 ** (-1 / 10));
	module.work.bins = 0; sparse.integratedLufs();
	assert.ok(module.work.bins <= 2, `only occupied bins need loudness conversion, got ${String(module.work.bins)}`);
	const histogram = module.createLoudnessHistogram();
	for (let bin = 0; bin < 100; bin++) histogram.push(10 ** ((bin * .1 - 11) / 10));
	module.work.ranks = 0;
	assert.ok((histogram.loudnessRangeLu() ?? 0) > 0);
	assert.ok(module.work.ranks <= 100, `four percentile ranks share one bin traversal, got ${String(module.work.ranks)}`);
});
