import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { auditParametricEqWasm } from '../scripts/audit-parametric-eq-wasm.mjs';
import {
	designParametricEq,
	sectionMagnitudeSquared,
} from '../src/common/editor/parametric-eq/design.js';
import { processParametricEqChannels } from '../src/common/editor/parametric-eq/core.js';
import {
	ParametricEqWasmRuntime,
	compileParametricEqWasm,
} from '../src/common/editor/parametric-eq/wasm-runtime.js';
import {
	WASM_URL,
	configure,
	loadRuntime,
	processNative,
} from './helpers/parametric-eq-wasm-harness.js';

test('the pinned parametric EQ WASM passes its fixed-memory reproducibility audit', async () => {
	const audit = await auditParametricEqWasm();
	assert.deepEqual(audit.findings, []);
	assert.equal(audit.ok, true);
	assert.equal(audit.wasmBytes, 50_489);
	assert.equal(
		audit.wasmSha256,
		'4cfa05e8183c8d992237c6abb62dee4fa33aada9e3e56c31c09f8e03b9523af4',
	);
});

test('the worklet runtime instantiates a structured-cloned module with no DSP fallback', async () => {
	const module = await compileParametricEqWasm(await readFile(WASM_URL));
	const runtime = new ParametricEqWasmRuntime(structuredClone(module), {
		sampleRate: 48_000,
		channelCount: 1,
	});
	runtime.configure({
		outputGain: 6,
		bands: [{
			id: 'bell', enabled: true, type: 'peaking', frequency: 1_000,
			gain: 6, q: 1, slope: 12,
		}],
	});
	const input = Float32Array.of(1, 0, 0, 0, 0, 0, 0, 0);
	const output = new Float32Array(input.length);
	assert.equal(runtime.process([input], [output]), input.length);
	assert.ok(output.every(Number.isFinite));
	assert.ok(output.some((value) => value !== 0));
	assert.ok(Math.abs(runtime.evaluateResponse([1_000])[0] - 12) < 1e-8);
	const responseBeforeInvalidConfiguration = runtime.evaluateResponse([1_000])[0];
	assert.throws(() => runtime.configure({
		outputGain: Number.NaN,
		bands: [],
	}), /finite number/);
	assert.throws(() => runtime.configure({
		outputGain: 0,
		bands: [
			{
				id: 'duplicate', enabled: true, type: 'peaking', frequency: 1_000,
				gain: 0, q: 1, slope: 12,
			},
			{
				id: 'duplicate', enabled: true, type: 'not-a-filter', frequency: 2_000,
				gain: 0, q: 1, slope: 12,
			},
		],
	}), /Duplicate|unsupported/);
	assert.equal(
		runtime.evaluateResponse([1_000])[0],
		responseBeforeInvalidConfiguration,
		'invalid configuration leaves the last valid native cascade active',
	);
});

test('the f64 WASM TPT cascade matches the shared designer and JS reference processor', async () => {
	const runtime = await loadRuntime(48_000, 2);
	const params = {
		outputGain: 2.5,
		bands: [
			{
				id: 'low-cut', enabled: true, type: 'highpass',
				frequency: 31, gain: 0, q: 0.707, slope: 48,
			},
			{
				id: 'presence', enabled: true, type: 'peaking',
				frequency: 16_000, gain: 12, q: 1, slope: 12,
			},
			{
				id: 'notch', enabled: true, type: 'notch',
				frequency: 7_200, gain: 0, q: 10, slope: 12,
			},
			{
				id: 'disabled-shelf', enabled: false, type: 'highshelf',
				frequency: 12_000, gain: -8, q: 1, slope: 12,
			},
		],
	};
	const configuration = designParametricEq(params, 48_000);
	configure(runtime.exports, configuration, 0, 0);

	for (const frequency of [10, 31, 1_000, 7_199, 16_000, 23_000]) {
		let expectedDb = configuration.packet.outputGainDb;
		for (const section of configuration.sections) {
			if (section.bandEnabled) {
				expectedDb += 10 * Math.log10(
					sectionMagnitudeSquared(section.coefficients, frequency, 48_000),
				);
			}
		}
		assert.ok(
			Math.abs(runtime.exports.peq_response_db(0, frequency) - expectedDb) < 2e-8,
			`native response should match at ${frequency} Hz`,
		);
	}
	assert.ok(runtime.exports.peq_response_db(0, 7_200) < -120, 'the matched notch retains a deep exact-center null');

	const frames = 4_096;
	const left = Float32Array.from({ length: frames }, (_, frame) => (
		0.3 * Math.sin(2 * Math.PI * 997 * frame / 48_000)
		+ (frame % 509 === 0 ? 0.2 : 0)
	));
	const right = new Float32Array(frames);
	const reference = processParametricEqChannels([left, right], 48_000, params);
	const actual = processNative(runtime, [left, right], 257);
	let maximumError = 0;
	for (let frame = 0; frame < frames; frame += 1) {
		maximumError = Math.max(
			maximumError,
			Math.abs(actual[0][frame] - reference[0][frame]),
		);
		assert.equal(actual[1][frame], 0, 'channels remain isolated');
	}
	assert.ok(maximumError < 5e-7, `maximum native/reference error was ${maximumError}`);
});

test('192 kHz matched shelves retain 10 Hz endpoints and native reciprocal cancellation', async () => {
	const sampleRate = 192_000;
	const frequencies = [0, 1, 10, 100, 1_000, 24_000, sampleRate / 2];
	for (const type of ['lowshelf', 'highshelf']) {
		const responses = new Map();
		for (const gain of [0.1, -0.1]) {
			const runtime = await loadRuntime(sampleRate, 1);
			configure(runtime.exports, designParametricEq({
				outputGain: 0,
				bands: [{
					id: `${type}-${gain}`,
					enabled: true,
					type,
					frequency: 10,
					gain,
					q: 1,
					slope: 12,
				}],
			}, sampleRate), 0, 0);
			responses.set(gain, frequencies.map((frequency) => (
				runtime.exports.peq_response_db(0, frequency)
			)));
		}

		const boosted = responses.get(0.1);
		const cut = responses.get(-0.1);
		const boostedEndpoint = type === 'lowshelf' ? boosted[0] : boosted.at(-1);
		const unityEndpoint = type === 'lowshelf' ? boosted.at(-1) : boosted[0];
		assert.ok(Math.abs(boostedEndpoint - 0.1) < 2e-12, `${type} boost endpoint is exact`);
		assert.ok(Math.abs(unityEndpoint) < 2e-12, `${type} unity endpoint is exact`);
		assert.ok(
			Math.abs((type === 'lowshelf' ? cut[0] : cut.at(-1)) + 0.1) < 2e-12,
			`${type} cut endpoint is exact`,
		);
		for (let index = 0; index < frequencies.length; index += 1) {
			assert.ok(
				Math.abs(boosted[index] + cut[index]) < 3e-12,
				`${type} reciprocal responses cancel at ${frequencies[index]} Hz`,
			);
		}

		const cancellationRuntime = await loadRuntime(sampleRate, 1);
		configure(cancellationRuntime.exports, designParametricEq({
			outputGain: 0,
			bands: [0.1, -0.1].map((gain) => ({
				id: `${type}-pair-${gain}`,
				enabled: true,
				type,
				frequency: 10,
				gain,
				q: 1,
				slope: 12,
			})),
		}, sampleRate), 0, 0);
		for (const frequency of frequencies) {
			assert.ok(
				Math.abs(cancellationRuntime.exports.peq_response_db(0, frequency)) < 3e-12,
				`${type} reciprocal cascade is unity at ${frequency} Hz`,
			);
		}
	}
});

test('the native 48 kHz 16 kHz Q 1 bell matches its pinned Nyquist response vector', async () => {
	const runtime = await loadRuntime(48_000, 1);
	configure(runtime.exports, designParametricEq({
		outputGain: 0,
		bands: [{
			id: 'nyquist-bell',
			enabled: true,
			type: 'peaking',
			frequency: 16_000,
			gain: 24,
			q: 1,
			slope: 12,
		}],
	}, 48_000), 0, 0);

	const responseVector = [
		[0, 0],
		[8_000, 9.289391784217072],
		[12_000, 16.190501583016328],
		[16_000, 23.999999999999993],
		[20_000, 18.217480972909815],
		[22_000, 16.4037535823223],
		[24_000, 15.817176057995292],
	];
	for (const [frequency, expectedDb] of responseVector) {
		assert.ok(
			Math.abs(runtime.exports.peq_response_db(0, frequency) - expectedDb) < 2e-11,
			`native bell response matches the pinned vector at ${frequency} Hz`,
		);
	}
});

test('native processing and its 128-frame state flush are invariant to block subdivision', async () => {
	const sampleRate = 192_000;
	const params = {
		outputGain: -1.25,
		bands: [
			{
				id: 'subdivision-low-bell', enabled: true, type: 'peaking',
				frequency: 10, gain: 24, q: 30, slope: 12,
			},
			{
				id: 'subdivision-high-bell', enabled: true, type: 'peaking',
				frequency: 24_000, gain: -24, q: 0.1, slope: 12,
			},
			{
				id: 'subdivision-cut', enabled: true, type: 'lowpass',
				frequency: 40_000, gain: 0, q: 0.707, slope: 48,
			},
		],
	};
	const configuration = designParametricEq(params, sampleRate);
	const input = Float32Array.from({ length: 4_097 }, (_, frame) => (
		0.2 * Math.sin(2 * Math.PI * 997 * frame / sampleRate)
		+ 0.13 * Math.sin(2 * Math.PI * 31_337 * frame / sampleRate)
		+ (frame % 509 === 0 ? 0.05 : 0)
	));
	const blockSizes = [1, 7, 127, 128, 129, 257, 1_024];
	let expected;
	for (const blockFrames of blockSizes) {
		const runtime = await loadRuntime(sampleRate, 1);
		configure(runtime.exports, configuration, 0, 0);
		const actual = processNative(runtime, [input], blockFrames)[0];
		if (expected == null) expected = actual;
		else assert.deepEqual(actual, expected, `subdivision ${blockFrames} is sample-identical`);
	}

	const tinyImpulse = new Float32Array(512);
	tinyImpulse[0] = 1e-31;
	let expectedTinyTail;
	for (const blockFrames of blockSizes) {
		const runtime = await loadRuntime(sampleRate, 1);
		configure(runtime.exports, designParametricEq({
			outputGain: 0,
			bands: [params.bands[0]],
		}, sampleRate), 0, 0);
		const actual = processNative(runtime, [tinyImpulse], blockFrames)[0];
		if (expectedTinyTail == null) expectedTinyTail = actual;
		else assert.deepEqual(
			actual,
			expectedTinyTail,
			`state-flush cadence is independent of subdivision ${blockFrames}`,
		);
		assert.ok(actual.subarray(0, 128).some((sample) => sample !== 0));
		assert.ok(
			actual.subarray(128).every((sample) => sample === 0),
			'the once-per-quantum flush makes a sub-threshold tail exactly zero',
		);
	}
});
