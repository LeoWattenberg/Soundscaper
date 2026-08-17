/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	encodeRenderedAudio,
	type RenderedAudioEncodingPlan,
	type RenderedAudioEncodingRuntime,
} from '../src/common/editor/controller/rendered-audio-encoding.ts';
import { normalizeRenderedLoudness } from '../src/common/editor/loudness-normalization-render.ts';
import { measureBextLoudness } from '../src/common/editor/broadcast-loudness.ts';

const SAMPLE_RATE = 48_000;
const R128 = { integratedLufs: -23, truePeakCeilingDb: -1 };

/** A steady tone, long enough for the R128 gate to have something to integrate. */
function tone(amplitude: number, seconds = 4): Float32Array {
	const frames = Math.round(SAMPLE_RATE * seconds);
	const channel = new Float32Array(frames);
	for (let index = 0; index < frames; index += 1) {
		channel[index] = amplitude * Math.sin(2 * Math.PI * 1_000 * index / SAMPLE_RATE);
	}
	return channel;
}

const stereo = (amplitude: number, seconds?: number) => [tone(amplitude, seconds), tone(amplitude, seconds)];

test('a quiet render is raised to the target, and the delivered measurement proves it', () => {
	const channels = stereo(0.02);
	const before = measureBextLoudness(channels, SAMPLE_RATE);
	assert.ok(before.loudnessValue != null && before.loudnessValue < -23);

	const normalized = normalizeRenderedLoudness({
		channels, sampleRate: SAMPLE_RATE, target: R128, captureLoudness: true,
	});
	assert.equal(normalized.decision?.outcome, 'target-met');
	// The whole point of the second pass: the number stamped into the delivery is
	// measured from the samples that were written, not projected from the first.
	assert.ok(
		Math.abs(normalized.delivered!.loudnessValue! - (-23)) <= 0.2,
		`delivered ${normalized.delivered!.loudnessValue} must land on the target within the budget`,
	);
	assert.ok(normalized.delivered!.maxTruePeakLevel! <= R128.truePeakCeilingDb + 0.2);
});

test('the delivered measurement agrees with the decision it was projected from', () => {
	// `delivery.integratedLoudnessErrorLu lte 0.2` and `truePeakErrorDb lte 0.2`
	// are the acceptance budgets; this is the same comparison in miniature.
	for (const amplitude of [0.005, 0.05, 0.2, 0.6]) {
		const normalized = normalizeRenderedLoudness({
			channels: stereo(amplitude), sampleRate: SAMPLE_RATE, target: R128, captureLoudness: true,
		});
		const decision = normalized.decision!;
		assert.ok(
			Math.abs(normalized.delivered!.loudnessValue! - decision.projectedLoudnessLufs!) <= 0.2,
			`amplitude ${amplitude}: delivered ${normalized.delivered!.loudnessValue} vs projected ${decision.projectedLoudnessLufs}`,
		);
		assert.ok(
			Math.abs(normalized.delivered!.maxTruePeakLevel! - decision.projectedTruePeakDb!) <= 0.2,
			`amplitude ${amplitude}: peak ${normalized.delivered!.maxTruePeakLevel} vs projected ${decision.projectedTruePeakDb}`,
		);
	}
});

test('the ceiling holds in the delivered samples, not just in the arithmetic', () => {
	// Loud, peaky material where reaching -23 LUFS would overshoot the ceiling.
	const channels = stereo(0.95);
	const normalized = normalizeRenderedLoudness({
		channels, sampleRate: SAMPLE_RATE, target: R128, captureLoudness: true,
	});
	assert.ok(
		normalized.delivered!.maxTruePeakLevel! <= R128.truePeakCeilingDb + 0.2,
		`delivered peak ${normalized.delivered!.maxTruePeakLevel} must respect the ceiling`,
	);
});

test('nothing is measured when nothing asked for a target or a capture', () => {
	// An ordinary WAV export must not pay for a loudness pass it never uses.
	const channels = stereo(0.1, 0.5);
	const before = channels[0].slice();
	const normalized = normalizeRenderedLoudness({ channels, sampleRate: SAMPLE_RATE });
	assert.equal(normalized.decision, null);
	assert.equal(normalized.delivered, null);
	assert.deepEqual(channels[0], before, 'the samples are untouched');
});

test('a capture with no target measures without changing a sample', () => {
	const channels = stereo(0.1);
	const before = channels[0].slice();
	const normalized = normalizeRenderedLoudness({
		channels, sampleRate: SAMPLE_RATE, captureLoudness: true,
	});
	assert.equal(normalized.decision?.outcome, 'not-requested');
	assert.equal(normalized.decision?.gainDb, 0);
	assert.equal(normalized.delivered?.loudnessValue, normalized.decision?.measuredLoudnessLufs);
	assert.deepEqual(channels[0], before, 'measuring must never move the audio');
});

test('a delivery already on target is not re-measured, and its samples are untouched', () => {
	const channels = stereo(0.1);
	const measured = measureBextLoudness(channels, SAMPLE_RATE);
	const before = channels[0].slice();
	const normalized = normalizeRenderedLoudness({
		channels,
		sampleRate: SAMPLE_RATE,
		// Its own measurement as the target, so the gain is exactly zero.
		target: { integratedLufs: measured.loudnessValue!, truePeakCeilingDb: 0 },
		captureLoudness: true,
	});
	assert.equal(normalized.decision?.gainDb, 0);
	assert.deepEqual(channels[0], before);
	assert.equal(normalized.delivered!.loudnessValue, measured.loudnessValue);
});

test('silence is reported unmeasurable rather than given an invented gain', () => {
	const channels = [new Float32Array(SAMPLE_RATE * 2), new Float32Array(SAMPLE_RATE * 2)];
	const normalized = normalizeRenderedLoudness({
		channels, sampleRate: SAMPLE_RATE, target: R128, captureLoudness: true,
	});
	assert.equal(normalized.decision?.outcome, 'unmeasurable');
	assert.equal(normalized.decision?.gainDb, 0);
	assert.ok(channels[0].every((sample) => sample === 0), 'silence stays silent');
});

test('the gain is applied to the same arrays rather than to copies', () => {
	// A one-hour master is over a gigabyte of float samples; copying it to apply
	// a constant would double peak memory exactly where a delivery is tightest.
	const channels = stereo(0.02, 1);
	const normalized = normalizeRenderedLoudness({
		channels, sampleRate: SAMPLE_RATE, target: R128,
	});
	assert.equal(normalized.channels[0], channels[0], 'the encoder receives the same buffer');
	assert.equal(normalized.channels[1], channels[1]);
});

test('every channel is scaled by the same factor, so the image is unchanged', () => {
	const left = tone(0.02, 1);
	const right = tone(0.01, 1);
	const ratioBefore = right[1_000] / left[1_000];
	const normalized = normalizeRenderedLoudness({
		channels: [left, right], sampleRate: SAMPLE_RATE, target: R128,
	});
	assert.ok(normalized.decision!.gainDb > 0);
	assert.ok(
		Math.abs(right[1_000] / left[1_000] - ratioBefore) < 1e-6,
		'a single gain must not move channels relative to each other',
	);
});

/**
 * The encoder seam. The gain has to land at the one point every format passes
 * through, so what follows checks the samples each encoder is actually handed
 * rather than checking that a function was called.
 */
function encodingFixture(format: string, channels: readonly Float32Array[]) {
	const encoded: Array<readonly Float32Array[]> = [];
	const wavOptions: Array<Readonly<Record<string, unknown>>> = [];
	const runtime = {
		applyMediaChannelMapping: (input: readonly Float32Array[]) => input,
		audioBufferChannels: () => channels,
		copy: { encoding: 'Encoding' },
		encodeAiff: () => Uint8Array.of(4),
		encodeWav(input: readonly Float32Array[], options: Readonly<Record<string, unknown>>) {
			encoded.push(input.map((channel) => channel.slice()));
			wavOptions.push(options);
			return Uint8Array.of(1);
		},
		ffmpeg: {
			encode: async (_bytes: Uint8Array, encodeFormat: string) => (
				{ bytes: Uint8Array.of(9), mimeType: `encoded/${encodeFormat}` }
			),
		},
		resampleBuffer: () => { throw new Error('The plan rate matches the render rate.'); },
		setStatus: () => undefined,
		throwIfAborted: () => undefined,
	} as unknown as RenderedAudioEncodingRuntime;
	const plan = {
		format,
		mimeType: `audio/${format}`,
		sampleRate: SAMPLE_RATE,
		outputFrames: channels[0].length,
		encoding: { bitDepth: 24, floatingPoint: false, sampleFormat: 'int24' },
		channelMapping: 'preserve',
		ditherMode: 'none',
		metadata: {},
		markers: [],
		ixml: null,
		cart: null,
	} as unknown as RenderedAudioEncodingPlan;
	return { runtime, plan, encoded, wavOptions };
}

test('the encoder is handed normalized samples, whichever format it encodes', async () => {
	// wav writes the samples straight out; flac stages them through WAV for the
	// codec. Both must receive exactly the same gain, because the decision is a
	// plan step rather than something each format arranges for itself.
	for (const format of ['wav', 'flac']) {
		const channels = stereo(0.02, 2);
		const before = channels[0][40_000];
		const fixture = encodingFixture(format, channels);
		const result = await encodeRenderedAudio(fixture.runtime, {
			plan: { ...fixture.plan, loudnessNormalization: R128 },
			rendered: { sampleRate: SAMPLE_RATE },
			settings: {},
			signal: new AbortController().signal,
		});
		const decision = result.loudnessNormalization;
		assert.ok(decision, `${format} must report its normalization decision`);
		assert.ok(decision.gainDb > 0, `${format} should have been turned up`);
		const factor = 10 ** (decision.gainDb / 20);
		assert.ok(
			Math.abs(fixture.encoded[0][0][40_000] - before * factor) < 1e-6,
			`${format} encoded an un-normalized sample`,
		);
	}
});

test('an export without a target reaches the encoder untouched and reports nothing', async () => {
	const channels = stereo(0.02, 1);
	const before = channels[0][20_000];
	const fixture = encodingFixture('wav', channels);
	const result = await encodeRenderedAudio(fixture.runtime, {
		plan: fixture.plan,
		rendered: { sampleRate: SAMPLE_RATE },
		settings: {},
		signal: new AbortController().signal,
	});
	assert.equal(result.loudnessNormalization, undefined);
	assert.equal(fixture.encoded[0][0][20_000], before);
});

test('the BEXT capture records what was written, not what was rendered', async () => {
	// The acceptance is explicit that the capture holds post-normalization
	// values. Stamping the pre-gain measurement would describe a file that
	// does not exist.
	const channels = stereo(0.02, 2);
	const rendered = measureBextLoudness(channels, SAMPLE_RATE);
	const fixture = encodingFixture('bwf', channels);
	await encodeRenderedAudio(fixture.runtime, {
		plan: { ...fixture.plan, loudnessNormalization: R128, bext: { description: 'Master', version: 2 } },
		rendered: { sampleRate: SAMPLE_RATE },
		settings: { measureLoudness: true },
		signal: new AbortController().signal,
	});
	const bext = fixture.wavOptions[0].bext as Readonly<Record<string, number | string>>;
	assert.equal(bext.description, 'Master', 'the authored fields survive');
	assert.ok(
		Math.abs(Number(bext.loudnessValue) - (-23)) <= 0.2,
		`the stamped loudness ${bext.loudnessValue} must be the delivered value, not the rendered ${rendered.loudnessValue}`,
	);
	assert.ok(Number(bext.loudnessValue) - Number(rendered.loudnessValue) > 1, 'and the two must actually differ here');
});
