/* SPDX-License-Identifier: GPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import {
	AUDACITY_LIVE_ANALYSIS_INTERVAL_SECONDS,
	AudacityLiveEffectProcessor,
} from '../src/common/editor/audacity-effects/live-worklet.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

const SAMPLE_RATE = 48_000;
const BLOCK = 128;

function runBlocks(processor, amplitude, blocks) {
	const readings = [];
	let phase = 0;
	for (let block = 0; block < blocks; block += 1) {
		const input = [new Float32Array(BLOCK)];
		for (let frame = 0; frame < BLOCK; frame += 1) {
			input[0][frame] = amplitude * Math.sin(2 * Math.PI * 220 * phase / SAMPLE_RATE);
			phase += 1;
		}
		const output = [new Float32Array(BLOCK)];
		processor.process(input, output, []);
		const analysis = processor.readAnalysis();
		if (analysis) readings.push(analysis);
	}
	return readings;
}

test('a live compressor reports the peaks and the reduction it applied', () => {
	const processor = createAudacityLiveProcessor('audacity-compressor', SAMPLE_RATE, {
		thresholdDb: -20, ratio: 4, kneeWidthDb: 0, makeupGainDb: 0,
		attackMs: 1, releaseMs: 10, lookaheadMs: 0,
	});
	// A signal well above the threshold must be reported as reduced, and the
	// reduction excludes makeup gain so it reads as what the curve took off.
	const loud = runBlocks(processor, 0.9, 40).at(-1);
	assert.ok(loud, 'the processor reported no analysis');
	assert.equal(loud.frames, BLOCK);
	assert.ok(loud.inputPeak > 0.8, `input peak was ${String(loud.inputPeak)}`);
	assert.ok(loud.reductionDb < -5, `reduction was ${String(loud.reductionDb)} dB`);
	assert.ok(loud.outputPeak < loud.inputPeak, 'the output was not attenuated');
});

test('a live compressor reports no reduction below its threshold', () => {
	const processor = createAudacityLiveProcessor('audacity-compressor', SAMPLE_RATE, {
		thresholdDb: -20, ratio: 4, kneeWidthDb: 0, makeupGainDb: 0,
		attackMs: 1, releaseMs: 10, lookaheadMs: 0,
	});
	const quiet = runBlocks(processor, 0.01, 40).at(-1);
	assert.ok(quiet);
	assert.equal(quiet.reductionDb, 0);
	assert.ok(Math.abs(quiet.outputPeak - quiet.inputPeak) < 1e-6, 'a quiet signal was altered');
});

test('makeup gain lifts the reported output without changing the reported reduction', () => {
	const settings = {
		thresholdDb: -20, ratio: 4, kneeWidthDb: 0,
		attackMs: 1, releaseMs: 10, lookaheadMs: 0,
	};
	const plain = createAudacityLiveProcessor('audacity-compressor', SAMPLE_RATE, { ...settings, makeupGainDb: 0 });
	const lifted = createAudacityLiveProcessor('audacity-compressor', SAMPLE_RATE, { ...settings, makeupGainDb: 6 });
	const plainReading = runBlocks(plain, 0.9, 40).at(-1);
	const liftedReading = runBlocks(lifted, 0.9, 40).at(-1);
	assert.ok(Math.abs(plainReading.reductionDb - liftedReading.reductionDb) < 1e-9);
	assert.ok(liftedReading.outputPeak > plainReading.outputPeak * 1.9, 'makeup gain was not reflected');
});

test('a live limiter reports its reduction and reading it clears the window', () => {
	const processor = createAudacityLiveProcessor('audacity-limiter', SAMPLE_RATE, {
		thresholdDb: -12, makeupTargetDb: -12, kneeWidthDb: 0, lookaheadMs: 0, releaseMs: 10,
	});
	const readings = runBlocks(processor, 0.9, 40);
	assert.ok(readings.at(-1).reductionDb < -5);
	// readAnalysis() reports one window and starts the next, so a read taken
	// without any intervening block has nothing to report.
	assert.equal(processor.readAnalysis(), null);
});

test('effects that cannot describe themselves report no analysis', () => {
	const processor = createAudacityLiveProcessor('audacity-invert', SAMPLE_RATE, {});
	const input = [new Float32Array(BLOCK)];
	const output = [new Float32Array(BLOCK)];
	processor.process(input, output, []);
	assert.equal(processor.readAnalysis(), null);
});

test('the live worklet reports dynamics analysis on its port at the display rate', () => {
	const posted = [];
	const processor = new AudacityLiveEffectProcessor({
		processorOptions: {
			sampleRate: SAMPLE_RATE,
			effectType: 'audacity-compressor',
			params: {
				thresholdDb: -20, ratio: 4, kneeWidthDb: 0, makeupGainDb: 0,
				attackMs: 1, releaseMs: 10, lookaheadMs: 0,
			},
		},
	});
	processor.port.postMessage = (message) => { posted.push(message); };
	const framesPerReport = Math.round(SAMPLE_RATE * AUDACITY_LIVE_ANALYSIS_INTERVAL_SECONDS);
	const blocksPerReport = Math.ceil(framesPerReport / BLOCK);
	for (let block = 0; block < blocksPerReport * 2; block += 1) {
		processor.process([[new Float32Array(BLOCK).fill(0.9)]], [[new Float32Array(BLOCK)]]);
	}
	const analyses = posted.filter((message) => message.type === 'analysis');
	assert.equal(analyses.length, 2, `posted ${String(analyses.length)} analysis messages`);
	// One report covers a whole display frame rather than a render quantum.
	assert.ok(analyses[0].frames >= framesPerReport);
	assert.ok(Math.abs(analyses[0].seconds - analyses[0].frames / SAMPLE_RATE) < 1e-9);
	assert.ok(analyses[0].reductionDb < 0);
	assert.equal(analyses[0].effectType, 'audacity-compressor');
});

test('the live worklet stays silent for effects that report no analysis', () => {
	const posted = [];
	const processor = new AudacityLiveEffectProcessor({
		processorOptions: { sampleRate: SAMPLE_RATE, effectType: 'audacity-invert', params: {} },
	});
	processor.port.postMessage = (message) => { posted.push(message); };
	for (let block = 0; block < 200; block += 1) {
		processor.process([[new Float32Array(BLOCK).fill(0.5)]], [[new Float32Array(BLOCK)]]);
	}
	assert.deepEqual(posted.filter((message) => message.type === 'analysis'), []);
});
