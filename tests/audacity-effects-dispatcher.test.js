import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
	applyAudacityEffect,
	applyAudacityEffectAsync,
	assertAudacityEffectOutput,
	audacityEffectDefaults,
	audacityEffectTypes,
	captureAudacityNoiseProfile,
	estimateAudacityEffectOutputFrames,
	estimateAudacityEffectPeakBytes,
} from '../src/lib/tools/audio-editor/audacity-effects/index.js';

const SAMPLE_RATE = 8_000;

test('the worker dispatcher applies every registered Audacity effect without mutating its input', async () => {
	const types = audacityEffectTypes();
	assert.equal(types.length, 31);
	const noise = testSignal(4_096, 0.01);
	const noiseProfile = captureAudacityNoiseProfile(noise, SAMPLE_RATE, audacityEffectDefaults('audacity-noise-reduction'));

	for (const type of types) {
		const frameCount = type === 'audacity-click-removal'
			? 8_192
			: type === 'audacity-repair'
				? 32
				: 4_096;
		const channels = testSignal(frameCount);
		const before = channels.map((channel) => new Float32Array(channel));
		const context = type === 'audacity-auto-duck'
			? { controlChannels: testSignal(frameCount, 0.6) }
			: type === 'audacity-noise-reduction'
				? { noiseProfile }
				: type === 'audacity-repair'
					? { beforeChannels: testSignal(128), afterChannels: testSignal(128) }
					: type === 'audacity-paulstretch'
						? { seed: 1234 }
						: {};
		const params = audacityEffectDefaults(type);
		const output = await applyAudacityEffectAsync(type, channels, SAMPLE_RATE, params, context);

		assert.equal(output.length, channels.length, `${type} channel count`);
		assert.equal(output[0].length, estimateAudacityEffectOutputFrames(type, frameCount, params), `${type} frame count`);
		assert.ok(output.every((channel) => channel instanceof Float32Array), `${type} output type`);
		assert.ok(output.every((channel) => Array.from(channel).every(Number.isFinite)), `${type} finite output`);
		assert.deepEqual(channels, before, `${type} input mutation`);
	}
});

test('the dispatcher rejects unknown effects and invalid output estimates', () => {
	assert.throws(() => applyAudacityEffect('not-an-effect', testSignal(32), SAMPLE_RATE), /Unsupported Audacity effect/);
	assert.throws(() => estimateAudacityEffectOutputFrames('audacity-invert', 0), /positive safe integer/);
	assert.throws(
		() => estimateAudacityEffectOutputFrames('audacity-repeat', Number.MAX_SAFE_INTEGER, { count: 10_000 }),
		/The effect output is too large/,
	);
});

test('the dispatcher rejects non-finite DSP output before it can leave the worker boundary', () => {
	const nearFloat32Maximum = Float32Array.of(3e38);
	assert.throws(
		() => applyAudacityEffect('audacity-amplify', [nearFloat32Maximum], SAMPLE_RATE, {
			gainDb: 50,
			allowClipping: true,
		}),
		/non-finite sample at frame 0/,
	);
	assert.throws(
		() => assertAudacityEffectOutput([Float32Array.of(0, Number.POSITIVE_INFINITY)]),
		/non-finite sample at frame 1/,
	);
});

test('peak-memory estimates include pipeline copies, contexts, and effect-specific scratch', () => {
	const frames = SAMPLE_RATE * 10;
	const options = { channelCount: 2, sampleRate: SAMPLE_RATE };
	const simple = estimateAudacityEffectPeakBytes('audacity-invert', frames, {}, options);
	const autoDuck = estimateAudacityEffectPeakBytes('audacity-auto-duck', frames, {}, options);
	const repair = estimateAudacityEffectPeakBytes('audacity-repair', 128, {}, {
		...options, beforeFrames: 128, afterFrames: 128,
	});
	const simpleRepairSize = estimateAudacityEffectPeakBytes('audacity-invert', 128, {}, options);
	const equalizer = estimateAudacityEffectPeakBytes('audacity-filter-curve-eq', frames, {}, options);
	const noiseReduction = estimateAudacityEffectPeakBytes('audacity-noise-reduction', frames, {}, options);
	const paulstretch = estimateAudacityEffectPeakBytes('audacity-paulstretch', frames, {
		stretchFactor: 10,
		timeResolution: 0.25,
	}, options);
	const paulstretchOutputBytes = estimateAudacityEffectOutputFrames(
		'audacity-paulstretch', frames, { stretchFactor: 10, timeResolution: 0.25 },
	) * options.channelCount * Float32Array.BYTES_PER_ELEMENT;

	assert.ok(simple > frames * options.channelCount * Float32Array.BYTES_PER_ELEMENT * 2);
	assert.ok(autoDuck > simple, 'Auto Duck includes retained and transferred control audio');
	assert.ok(repair > simpleRepairSize, 'Repair includes before/after context in both realms');
	assert.ok(equalizer > simple, 'EQ includes convolution scratch');
	assert.ok(noiseReduction > equalizer, 'Noise Reduction includes spectra, gains, and overlap-add scratch');
	assert.ok(paulstretch > paulstretchOutputBytes, 'Paulstretch includes output copies and Float64 overlap-add scratch');
	assert.equal(AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES, 256 * 1024 ** 2);
	assert.ok(simple < AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES);
	assert.ok(estimateAudacityEffectPeakBytes('audacity-repeat', frames, { count: 1_000 }, options)
		> AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES);
	assert.throws(
		() => estimateAudacityEffectPeakBytes('audacity-invert', frames, {}, { channelCount: 0 }),
		/channelCount must be a positive integer/,
	);
});

function testSignal(frameCount, amplitude = 0.25) {
	return [0, Math.PI / 3].map((phase) => Float32Array.from(
		{ length: frameCount },
		(_, frame) => amplitude * Math.sin(2 * Math.PI * 330 * frame / SAMPLE_RATE + phase),
	));
}
