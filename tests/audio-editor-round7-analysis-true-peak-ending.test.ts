/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAudioChannels, createStreamingAudioAnalyzer } from '../src/common/editor/analysis.js';
import { generateAudioEditorSignal } from '../src/common/editor/generators.js';
import { applyAudacityFadeIn } from '../src/common/editor/audacity-effects/basic.js';
import { createEbuR128Meter } from '../src/common/editor/ebu-r128.js';

const RATE = 48_000;
function fadingTone(durationSeconds: number): Float32Array[] {
	const signal = generateAudioEditorSignal('tone', { sampleRate: RATE, channelCount: 1,
		durationSeconds, frequency: 12_000, amplitude: .5, waveform: 'sine' });
	return applyAudacityFadeIn(signal.channels, RATE);
}

for (const duration of [.001, .01, 1]) {
	test(`Analyze selection includes the pending true peak of a normal ${duration}s Fade In`, () => {
		const channels = fadingTone(duration);
		const padded = channels.map(channel => {
			const result = new Float32Array(channel.length + 12);
			result.set(channel);
			return result;
		});
		const actual = analyzeAudioChannels(channels, RATE);
		const complete = analyzeAudioChannels(padded, RATE);
		assert.ok(complete.truePeakDbtp - actual.peakDbfs > .08,
			'The authored crescendo must have a real ending intersample peak.');
		assert.ok(Math.abs(actual.truePeakAmplitude - complete.truePeakAmplitude) < 1e-12,
			`Analyze must include the final reconstructed peak: ${actual.truePeakDbtp} versus ${complete.truePeakDbtp} dBTP.`);
		assert.equal(actual.frameCount, channels[0]!.length);
		assert.equal(actual.durationSeconds, duration);
		const squares = channels[0]!.reduce((sum, sample) => sum + sample * sample, 0);
		assert.equal(actual.rmsAmplitude, Math.sqrt(squares / channels[0]!.length));
	});
}

test('finishing arbitrarily chunked analysis resolves the same ending peak once', () => {
	const channels = fadingTone(.01);
	const padded = new Float32Array(channels[0]!.length + 12);
	padded.set(channels[0]!);
	const expected = analyzeAudioChannels([padded], RATE).truePeakAmplitude;
	for (const size of [1, 7, 127, 480]) {
		const analyzer = createStreamingAudioAnalyzer({ sampleRate: RATE, channelCount: 1 });
		for (let frame = 0; frame < channels[0]!.length; frame += size) {
			analyzer.push([channels[0]!.subarray(frame, frame + size)]);
		}
		const result = analyzer.finish();
		assert.ok(Math.abs(result.truePeakAmplitude - expected) < 1e-12,
			`Chunk size ${size} must retain the ending true peak.`);
		assert.equal(analyzer.finish(), result);
		assert.throws(() => analyzer.push([new Float32Array(1)]), /finished/u);
	}
});

test('an ending true-peak snapshot preserves live histories, measurement clock and continuation', () => {
	const channels = fadingTone(.01);
	const meter = createEbuR128Meter({ sampleRate: RATE, channelCount: 1, running: true });
	const control = createEbuR128Meter({ sampleRate: RATE, channelCount: 1, running: true });
	meter.push(channels); control.push(channels);
	const before = meter.snapshot();
	const ended = meter.snapshot({ finishTruePeak: true });
	assert.ok(ended.loudness.maximumTruePeakDbtp! - before.loudness.maximumTruePeakDbtp! > .08,
		'The ending snapshot must actually resolve pending reconstructed peaks.');
	assert.equal(ended.loudness.measuredSeconds, before.loudness.measuredSeconds);
	assert.equal(ended.rms, before.rms);
	assert.equal(ended.peak, before.peak);
	assert.deepEqual(meter.snapshot(), before);
	assert.deepEqual(meter.snapshot({ finishTruePeak: true }), ended);
	const continuation = [Float32Array.from({ length: 480 }, (_, frame) => .1 * Math.sin(2 * Math.PI * 440 * frame / RATE))];
	meter.push(continuation); control.push(continuation);
	assert.deepEqual(meter.snapshot(), control.snapshot());
});

test('ending an offline measurement does not count paused live audio or silent frames', () => {
	const meter = createEbuR128Meter({ sampleRate: RATE, channelCount: 1, running: true });
	meter.push([new Float32Array(480).fill(.01)]);
	meter.setRunning(false);
	meter.push(fadingTone(.01));
	const before = meter.snapshot();
	assert.deepEqual(meter.snapshot({ finishTruePeak: true }), before);
	const silent = createStreamingAudioAnalyzer({ sampleRate: RATE, channelCount: 1 }).finish();
	assert.equal(silent.frameCount, 0);
	assert.equal(silent.truePeakAmplitude, 0);
});
