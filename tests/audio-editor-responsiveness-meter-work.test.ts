/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import { readMasterMeter } from '../src/common/editor/engine/engine-meter-reading.ts';
import { reconcileEngineChannelMeters } from '../src/common/editor/engine/engine-channel-meter-aggregate.ts';
import { createSessionStripMeterStore, stereoCorrelation } from '../src/common/editor/production-audio/strip-meter-session.ts';
import { sampleProductionMeterSessionV21, resetProductionMeterSessionV21 } from '../src/common/editor/engine/production-meter-runtime-session-v21.ts';

test('spectrum bucket geometry is reused until the analyser geometry changes', () => {
	const values = new Float32Array(2_048);
	for (let index = 0; index < values.length; index += 1) values[index] = -index % 121;
	const analyser = {
		frequencyBinCount: values.length,
		getFloatFrequencyData(output: Float32Array): void { output.set(values.subarray(0, output.length)); },
	} as unknown as AnalyserNode;
	const tap = { spectrum: analyser, splitter: null, stereo: [] };
	const initial = readMasterMeter(null, tap).spectrumDb;
	const original = Math.floor;
	let floors = 0;
	Math.floor = value => { floors += 1; return original(value); };
	try {
		assert.deepEqual(readMasterMeter(null, tap).spectrumDb, initial);
		assert.equal(floors, 0, 'a warm sample computes no logarithmic bucket boundaries');
		Object.defineProperty(analyser, 'frequencyBinCount', { value: 1_024 });
		readMasterMeter(null, tap);
		assert.equal(floors, 128, 'changed geometry rebuilds all boundaries once');
	} finally { Math.floor = original; }
});

test('master scope and correlation share a sample traversal and preserve published values', () => {
	for (const length of [1, 2, 63, 64, 65, 256, 4_096]) {
		const left = Float32Array.from({ length }, (_, index) => Math.sin(index * 0.47));
		const right = Float32Array.from({ length }, (_, index) => Math.cos(index * 0.83));
		const reading = readMasterMeter(null, {
			spectrum: null, splitter: null, stereo: [analyser(left), analyser(right)],
		});
		assert.equal(reading.stereoCorrelation, stereoCorrelation([left, right]));
		assert.deepEqual(reading.stereoScope, referenceScope(left, right));
		assert.ok(Object.isFrozen(reading.stereoScope));
	}
});

test('strip snapshot array is retained between publications and invalidated on update/reset', () => {
	const store = createSessionStripMeterStore({ maximumStrips: 2 });
	const empty = store.snapshot();
	assert.equal(store.snapshot(), empty);
	const input = { channels: [Float32Array.of(0.5)], channelLabels: ['M'] };
	store.update({ kind: 'track', id: 'a' }, input);
	const first = store.snapshot();
	assert.equal(store.snapshot(), first);
	store.update({ kind: 'track', id: 'b' }, input);
	store.update({ kind: 'track', id: 'c' }, input);
	assert.deepEqual(first.map(({ strip }) => strip), [{ kind: 'track', id: 'a' }]);
	assert.deepEqual(store.snapshot().map(({ strip }) => strip), [
		{ kind: 'track', id: 'b' }, { kind: 'track', id: 'c' },
	]);
	assert.ok(Object.isFrozen(first));
	store.reset();
	assert.deepEqual(store.snapshot(), []);
	assert.equal(store.snapshot(), store.snapshot());
});

test('channel aggregate retains scalar arithmetic without mapped channel arrays', () => {
	const channels = [{ label: 'L', peak: 0.5, rms: 0.25 }, { label: 'R', peak: 1, rms: 0.75 }];
	channels.map = () => { throw new Error('aggregation allocated a mapped array'); };
	const master = { peak: 0, rms: 0, dbfs: -Infinity };
	reconcileEngineChannelMeters({ master, tracks: {}, groups: {}, sends: {}, productionMeters: [{
		strip: { kind: 'master' }, channels, channelCount: 2, sequence: 1, correlation: null, phaseDegrees: null,
	}] });
	assert.deepEqual(master, { peak: 1, rms: Math.sqrt(0.625 / 2), dbfs: 0 });
});

test('unchanged loudness readings retain the published history instead of copying it every meter tick', () => {
	const owner = {};
	const project = {};
	const reading = { peak: 0.5, rms: 0.25, dbfs: -6, loudness: {
		standard: 'EBU R128', momentaryLufs: -20, shortTermLufs: -20, integratedLufs: -20,
		maximumMomentaryLufs: -20, maximumShortTermLufs: -20, loudnessRangeLu: null,
		loudnessRangeStable: false, truePeakDbtp: -6, maximumTruePeakDbtp: -6,
		measuredSeconds: 1, state: 'measuring',
	} };
	const first = sampleProductionMeterSessionV21(owner, project, null, reading).productionLoudnessHistory;
	assert.ok(first);
	for (let tick = 0; tick < 10; tick += 1) {
		assert.equal(sampleProductionMeterSessionV21(owner, project, null, reading).productionLoudnessHistory, first);
	}
	const next = sampleProductionMeterSessionV21(owner, project, null, {
		...reading, loudness: { ...reading.loudness, measuredSeconds: 2 },
	}).productionLoudnessHistory;
	assert.equal(first.history.length, 1);
	assert.equal(next?.history.length, 2);
	resetProductionMeterSessionV21(owner);
	assert.equal(sampleProductionMeterSessionV21(owner, project, null, null).productionLoudnessHistory, undefined);
});

function analyser(samples: Float32Array): AnalyserNode {
	return { fftSize: samples.length, getFloatTimeDomainData(output: Float32Array): void { output.set(samples); } } as unknown as AnalyserNode;
}

function referenceScope(left: Float32Array, right: Float32Array) {
	const points = [];
	const step = Math.max(1, Math.ceil(left.length / 64));
	for (let start = 0; start < left.length; start += step) {
		let selected = start;
		let amplitude = 0;
		for (let frame = start; frame < Math.min(left.length, start + step); frame += 1) {
			const value = Math.abs(left[frame]!) + Math.abs(right[frame]!);
			if (value > amplitude) { amplitude = value; selected = frame; }
		}
		if (amplitude === 0) continue;
		points.push({ x: Math.max(-1, Math.min(1, (left[selected]! - right[selected]!) / 2)),
			y: Math.max(-1, Math.min(1, (left[selected]! + right[selected]!) / 2)) });
	}
	return points;
}
