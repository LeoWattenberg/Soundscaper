/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAudioChannels, createStreamingAudioAnalyzer } from '../src/common/editor/analysis.js';
import { createEbuR128Meter } from '../src/common/editor/ebu-r128.js';
import { measureBextLoudness } from '../src/common/editor/broadcast-loudness.ts';
import { generateAudioEditorSignal } from '../src/common/editor/generators.js';
import { applyAudacityFadeIn } from '../src/common/editor/audacity-effects/basic.js';

const RATE = 48_000;
function fadingTone(duration: number): Float32Array[] {
	const recording = generateAudioEditorSignal('tone', { sampleRate: RATE, channelCount: 1,
		frequency: 1000, amplitude: .5, durationSeconds: duration });
	return applyAudacityFadeIn(recording.channels, RATE);
}

for (const duration of [.4, .45, 3, 3.05]) {
	test(`finite Analyze includes the final complete M/S window at ${duration}s`, () => {
		const channels = fadingTone(duration);
		const result = analyzeAudioChannels(channels, RATE);
		assert.ok(result.momentaryLufs !== null);
		assert.ok('maxMomentaryLufs' in result && typeof result.maxMomentaryLufs === 'number');
		assert.ok(Math.abs(result.maxMomentaryLufs - result.momentaryLufs) < 1e-9,
			`A crescendo's final M must be included in its maximum: ${result.momentaryLufs} versus ${result.maxMomentaryLufs}.`);
		if (duration >= 3) {
			assert.ok(result.shortTermLufs !== null);
			assert.ok('maxShortTermLufs' in result && typeof result.maxShortTermLufs === 'number');
			assert.ok(Math.abs(result.maxShortTermLufs - result.shortTermLufs) < 1e-9,
				`The final complete S window must be included: ${result.shortTermLufs} versus ${result.maxShortTermLufs}.`);
		}
		assert.equal(result.frameCount, Math.round(duration * RATE));
		assert.equal(result.sampleRate, RATE);
	});
}

test('finite BEXT maxima include a final complete window without adding integrated or LRA blocks', () => {
	const channels = fadingTone(3.05);
	const meter = createEbuR128Meter({ sampleRate: RATE, channelCount: 1, running: true });
	meter.push(channels);
	const live = meter.snapshot().loudness;
	const result = measureBextLoudness(channels, RATE);
	assert.ok(live.momentaryLufs !== null && live.shortTermLufs !== null);
	assert.ok(typeof result.maxMomentaryLoudness === 'number' && typeof result.maxShortTermLoudness === 'number');
	assert.ok(Math.abs(result.maxMomentaryLoudness - live.momentaryLufs) < 1e-9);
	assert.ok(Math.abs(result.maxShortTermLoudness - live.shortTermLufs) < 1e-9);
	assert.equal(result.loudnessValue, live.integratedLufs);
	assert.equal(result.loudnessRange, live.loudnessRangeLu);
});

test('arbitrarily chunked finite analysis reports identical ending maxima and clocks', () => {
	const channels = fadingTone(3.05);
	const expected = analyzeAudioChannels(channels, RATE);
	for (const block of [127, 4800, 16384]) {
		const analyzer = createStreamingAudioAnalyzer({ sampleRate: RATE, channelCount: 1 });
		for (let start = 0; start < channels[0]!.length; start += block) {
			analyzer.push(channels.map(channel => channel.subarray(start, start + block)));
		}
		const result = analyzer.finish();
		assert.deepEqual(result, expected);
		assert.equal(analyzer.finish(), result);
	}
});

test('completing finite maxima preserves live histories, standby and further measurement', () => {
	const channels = fadingTone(3.05);
	const meter = createEbuR128Meter({ sampleRate: RATE, channelCount: 1, running: true });
	const control = createEbuR128Meter({ sampleRate: RATE, channelCount: 1, running: true });
	meter.push(channels); control.push(channels);
	const before = meter.snapshot();
	const complete = meter.snapshot({ finishTruePeak: true, finishLoudness: true });
	assert.ok(complete.loudness.maximumMomentaryLufs! > before.loudness.maximumMomentaryLufs! + .1);
	assert.ok(complete.loudness.maximumShortTermLufs! > before.loudness.maximumShortTermLufs! + .2);
	assert.equal(complete.loudness.measuredSeconds, 3.05);
	assert.equal(complete.loudness.integratedLufs, before.loudness.integratedLufs);
	assert.equal(complete.loudness.loudnessRangeLu, before.loudness.loudnessRangeLu);
	assert.equal(complete.peak, before.peak);
	assert.equal(complete.rms, before.rms);
	assert.deepEqual(meter.snapshot(), before);
	assert.deepEqual(meter.snapshot({ finishTruePeak: true, finishLoudness: true }), complete);
	const continuation = [new Float32Array(4800).fill(.01)];
	meter.push(continuation); control.push(continuation);
	assert.deepEqual(meter.snapshot(), control.snapshot());
	meter.setRunning(false);
	meter.push([new Float32Array(4800).fill(1)]);
	assert.deepEqual(meter.snapshot({ finishLoudness: true }), meter.snapshot());
});

test('silence and selections shorter than a complete loudness window retain unmeasurable extrema', () => {
	for (const channels of [[new Float32Array(21600)], fadingTone(.35)]) {
		const result = analyzeAudioChannels(channels, RATE);
		assert.ok('maxMomentaryLufs' in result && 'maxShortTermLufs' in result);
		assert.equal(result.maxMomentaryLufs, null);
		assert.equal(result.maxShortTermLufs, null);
	}
});
