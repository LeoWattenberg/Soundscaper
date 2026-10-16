/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAudioChannels, createStreamingAudioAnalyzer } from '../src/common/editor/analysis.js';
import { generateAudioEditorSignal } from '../src/common/editor/generators.js';
import { applyAudacityFadeIn } from '../src/common/editor/audacity-effects/basic.js';
import { createEbuR128Meter } from '../src/common/editor/ebu-r128.js';
import { measureBextLoudness } from '../src/common/editor/broadcast-loudness.ts';

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
		assert.ok(Math.abs(actual.truePeakDbtp - complete.truePeakDbtp) < 1e-12,
			`Analyze must include the final reconstructed peak: ${actual.truePeakDbtp} versus ${complete.truePeakDbtp} dBTP.`);
		assert.equal(actual.frameCount, channels[0]!.length);
		assert.equal(actual.frameCount / actual.sampleRate, duration);
		const squares = channels[0]!.reduce((sum, sample) => sum + sample * sample, 0);
		assert.ok(Math.abs(actual.rmsDbfs - 20 * Math.log10(Math.sqrt(squares / channels[0]!.length))) < 1e-12);
	});
}

test('finishing arbitrarily chunked analysis resolves the same ending peak once', () => {
	const channels = fadingTone(.01);
	const padded = new Float32Array(channels[0]!.length + 12);
	padded.set(channels[0]!);
	const expected = analyzeAudioChannels([padded], RATE).truePeakDbtp;
	for (const size of [1, 7, 127, 480]) {
		const analyzer = createStreamingAudioAnalyzer({ sampleRate: RATE, channelCount: 1 });
		for (let frame = 0; frame < channels[0]!.length; frame += size) {
			analyzer.push([channels[0]!.subarray(frame, frame + size)]);
		}
		const result = analyzer.finish();
		assert.ok(Math.abs(result.truePeakDbtp - expected) < 1e-12,
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
	assert.equal(silent.truePeakDbtp, -120);
});

test('finite loudness and BEXT measurements retain the same ending true peak', () => {
	const channels = fadingTone(1);
	const expected = analyzeAudioChannels(channels, RATE);
	const actual = measureBextLoudness(channels, RATE);
	assert.ok(Math.abs(actual.maxTruePeakLevel! - expected.truePeakDbtp) < 1e-12,
		`Finite loudness must retain the completed peak: ${actual.maxTruePeakLevel} versus ${expected.truePeakDbtp}.`);
	assert.equal(actual.loudnessValue, expected.integratedLufs);
	const control = createEbuR128Meter({ sampleRate: RATE, channelCount: 1, running: true });
	control.push(channels);
	assert.equal(actual.maxMomentaryLoudness, control.snapshot().loudness.maximumMomentaryLufs);
});

test('the actual analysis worker completes a normal interior Fade In selection', async () => {
	const recording = Float32Array.from({ length: RATE }, (_, frame) =>
		Math.round(.5 * Math.sin(2 * Math.PI * 12_000 * frame / RATE) * 32767) / 32768);
	const programme = applyAudacityFadeIn([recording], RATE)[0]!.slice(0, 36_000).map((value: number) => value * Math.SQRT1_2);
	const oldMeter = createEbuR128Meter({ sampleRate: RATE, channelCount: 1, running: true });
	oldMeter.push([programme]);
	assert.equal(oldMeter.snapshot().loudness.maximumTruePeakDbtp!.toFixed(1), '-11.5',
		'The prior unfinished meter misses this ordinary interior-selection ending peak.');
	const padded = new Float32Array(programme.length + 12);
	padded.set(programme);
	const reference = analyzeAudioChannels([padded], RATE);
	assert.equal(reference.truePeakDbtp.toFixed(1), '-11.4');
	const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
	const messages: unknown[] = [];
	const worker = { onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
		postMessage: (message: unknown): void => { messages.push(message); } };
	Object.defineProperty(globalThis, 'self', { configurable: true, value: worker });
	try {
		await import('../src/common/editor/analysis-worker.js');
		const dispatch = (data: unknown): void => { worker.onmessage?.({ data } as MessageEvent<unknown>); };
		dispatch({ type: 'start', options: { sampleRate: RATE, channelCount: 1 } });
		dispatch({ type: 'chunk', channels: [programme.buffer] });
		dispatch({ type: 'finish' });
		const response = messages.at(-1);
		assert.ok(response && typeof response === 'object' && 'result' in response);
		const result = response.result;
		assert.ok(result && typeof result === 'object' && 'truePeakDbtp' in result && 'frameCount' in result);
		assert.ok(typeof result.truePeakDbtp === 'number' && Math.abs(result.truePeakDbtp - reference.truePeakDbtp) < 1e-12);
		assert.equal(result.frameCount, 36_000);
	} finally {
		if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
		else Reflect.deleteProperty(globalThis, 'self');
	}
});
