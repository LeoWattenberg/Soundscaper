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

const WASM_URL = new URL(
	'../src/common/editor/parametric-eq/parametric-eq.wasm',
	import.meta.url,
);

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

test('native semantic one-poles and bypass transitions keep independent 5 ms and 10 ms timing', async () => {
	const runtime = await loadRuntime(48_000, 1);
	const params = (gain, enabled) => ({
		outputGain: 0,
		bands: [{
			id: 'transition-band', enabled, type: 'peaking',
			frequency: 1_000, gain, q: 1, slope: 12,
		}],
	});
	configure(runtime.exports, designParametricEq(params(6, true), 48_000), 0, 0);
	configure(runtime.exports, designParametricEq(params(12, false), 48_000), 1, 480);
	processNative(runtime, [new Float32Array(240)], 240);
	const halfwayDb = runtime.exports.peq_response_db(0, 1_000);
	const smoothedGain = 12 + (6 - 12) * Math.exp(-1);
	const expectedHalfwayDb = 20 * Math.log10(
		1 + 0.5 * (10 ** (smoothedGain / 20) - 1),
	);
	assert.ok(
		Math.abs(halfwayDb - expectedHalfwayDb) < 5e-6,
		`halfway bypass response was ${halfwayDb} dB instead of ${expectedHalfwayDb} dB`,
	);
	processNative(runtime, [new Float32Array(240)], 240);
	assert.ok(Math.abs(runtime.exports.peq_response_db(0, 1_000)) < 1e-12);
});

test('semantic automation smooths log frequency, log Q, gain, and output before each 16-sample matched redesign', async () => {
	const sampleRate = 48_000;
	const runtime = await loadRuntime(sampleRate, 1);
	const makeParams = (frequency, gain, q, outputGain) => ({
		outputGain,
		bands: [{
			id: 'semantic-bell', enabled: true, type: 'peaking',
			frequency, gain, q, slope: 12,
		}],
	});
	const initial = { frequency: 80, gain: -18, q: 0.2, outputGain: -12 };
	let target = { frequency: 19_000, gain: 21, q: 24, outputGain: 15 };
	configure(runtime.exports, designParametricEq(makeParams(
		initial.frequency,
		initial.gain,
		initial.q,
		initial.outputGain,
	), sampleRate), 0, 0);
	configure(runtime.exports, designParametricEq(makeParams(
		target.frequency,
		target.gain,
		target.q,
		target.outputGain,
	), sampleRate), 1, 240);

	let state = {
		logFrequency: Math.log2(initial.frequency),
		gain: initial.gain,
		logQ: Math.log(initial.q),
		outputGain: initial.outputGain,
	};
	const advance = (value, targetValue, frames) => (
		targetValue + (value - targetValue) * Math.exp(
			-frames / (0.005 * sampleRate),
		)
	);
	const checkBoundary = (label) => {
		const expected = designParametricEq(makeParams(
			2 ** state.logFrequency,
			state.gain,
			Math.exp(state.logQ),
			state.outputGain,
		), sampleRate);
		for (const frequency of [20, 80, 997, 8_000, 19_000, 23_000]) {
			let expectedDb = expected.outputGainDb;
			for (const section of expected.sections) {
				expectedDb += 10 * Math.log10(sectionMagnitudeSquared(
					section.coefficients,
					frequency,
					sampleRate,
				));
			}
			const actualDb = runtime.exports.peq_response_db(0, frequency);
			assert.ok(
				Math.abs(actualDb - expectedDb) < 3e-8,
				`${label}: ${frequency} Hz response ${actualDb} dB != ${expectedDb} dB`,
			);
		}
	};
	const advanceState = (frames) => {
		state.logFrequency = advance(state.logFrequency, Math.log2(target.frequency), frames);
		state.gain = advance(state.gain, target.gain, frames);
		state.logQ = advance(state.logQ, Math.log(target.q), frames);
		state.outputGain = advance(state.outputGain, target.outputGain, frames);
	};

	for (let slice = 1; slice <= 8; slice += 1) {
		processNative(runtime, [new Float32Array(16)], 16);
		advanceState(16);
		checkBoundary(`slice ${slice}`);
	}

	// Retarget after a non-design-boundary block. The semantic state advances
	// per sample, while the next matched target is still recomputed over one
	// complete 16-frame slice from the current stable TPT values.
	processNative(runtime, [new Float32Array(7)], 7);
	advanceState(7);
	target = { frequency: 330, gain: -9, q: 0.55, outputGain: -3 };
	configure(runtime.exports, designParametricEq(makeParams(
		target.frequency,
		target.gain,
		target.q,
		target.outputGain,
	), sampleRate), 1, 240);
	processNative(runtime, [new Float32Array(16)], 16);
	advanceState(16);
	checkBoundary('mid-slice retarget');
});

test('aggressive 60 Hz semantic sweeps match a per-sample one-pole and 16-frame TPT reference below -80 dBFS', async () => {
	const sampleRate = 48_000;
	const eventFrames = 800;
	const eventCount = 12;
	const totalFrames = eventFrames * eventCount;
	const targetAt = (index) => ({
		frequency: index % 2 === 0 ? 70 : 18_500,
		gain: index % 2 === 0 ? -24 : 24,
		q: index % 2 === 0 ? 0.1 : 30,
		outputGain: index % 2 === 0 ? -9 : 9,
	});
	const makeParams = (value) => ({
		outputGain: value.outputGain,
		bands: [{
			id: 'sweep', enabled: true, type: 'peaking',
			frequency: value.frequency,
			gain: value.gain,
			q: value.q,
			slope: 12,
		}],
	});
	const input = Float32Array.from({ length: totalFrames }, (_, frame) => (
		0.13 * Math.sin(2 * Math.PI * 89 * frame / sampleRate)
		+ 0.11 * Math.sin(2 * Math.PI * 997 * frame / sampleRate)
		+ 0.09 * Math.sin(2 * Math.PI * 17_111 * frame / sampleRate)
	));
	const runtime = await loadRuntime(sampleRate, 1);
	const initial = targetAt(0);
	configure(runtime.exports, designParametricEq(makeParams(initial), sampleRate), 0, 0);
	const actual = new Float32Array(totalFrames);
	for (let event = 0; event < eventCount; event += 1) {
		if (event > 0) {
			configure(
				runtime.exports,
				designParametricEq(makeParams(targetAt(event)), sampleRate),
				1,
				240,
			);
		}
		const offset = event * eventFrames;
		actual.set(processNative(
			runtime,
			[input.subarray(offset, offset + eventFrames)],
			127,
		)[0], offset);
	}
	for (const blockFrames of [1, 128, 257]) {
		const subdivisionRuntime = await loadRuntime(sampleRate, 1);
		configure(
			subdivisionRuntime.exports,
			designParametricEq(makeParams(initial), sampleRate),
			0,
			0,
		);
		const subdivided = new Float32Array(totalFrames);
		for (let event = 0; event < eventCount; event += 1) {
			if (event > 0) {
				configure(
					subdivisionRuntime.exports,
					designParametricEq(makeParams(targetAt(event)), sampleRate),
					1,
					240,
				);
			}
			const offset = event * eventFrames;
			subdivided.set(processNative(
				subdivisionRuntime,
				[input.subarray(offset, offset + eventFrames)],
				blockFrames,
			)[0], offset);
		}
		assert.deepEqual(
			subdivided,
			actual,
			`60 Hz sweep is sample-identical with ${blockFrames}-frame subdivisions`,
		);
	}

	const reference = new Float32Array(totalFrames);
	const retention = Math.exp(-1 / (0.005 * sampleRate));
	const intervalRetention = Math.exp(-16 / (0.005 * sampleRate));
	let semantic = {
		logFrequency: Math.log2(initial.frequency),
		gain: initial.gain,
		logQ: Math.log(initial.q),
		outputGain: initial.outputGain,
	};
	let target = { ...semantic };
	let values = tptArray(designParametricEq(makeParams(initial), sampleRate).sections[0].tpt);
	let sectionTarget = values.slice();
	let steps = new Float64Array(5);
	let sliceRemaining = 0;
	let state1 = 0;
	let state2 = 0;
	let flushRemaining = 128;
	for (let frame = 0; frame < totalFrames; frame += 1) {
		if (frame > 0 && frame % eventFrames === 0) {
			const next = targetAt(frame / eventFrames);
			target = {
				logFrequency: Math.log2(next.frequency),
				gain: next.gain,
				logQ: Math.log(next.q),
				outputGain: next.outputGain,
			};
			sliceRemaining = 0;
			steps.fill(0);
			sectionTarget.set(values);
		}
		if (sliceRemaining === 0) {
			const boundary = {
				logFrequency: target.logFrequency
					+ (semantic.logFrequency - target.logFrequency) * intervalRetention,
				gain: target.gain + (semantic.gain - target.gain) * intervalRetention,
				logQ: target.logQ + (semantic.logQ - target.logQ) * intervalRetention,
			};
			const designed = designParametricEq(makeParams({
				frequency: 2 ** boundary.logFrequency,
				gain: boundary.gain,
				q: Math.exp(boundary.logQ),
				outputGain: target.outputGain,
			}), sampleRate);
			sectionTarget = tptArray(designed.sections[0].tpt);
			for (let index = 0; index < values.length; index += 1) {
				steps[index] = (sectionTarget[index] - values[index]) / 16;
			}
			sliceRemaining = 16;
		}
		semantic.logFrequency = target.logFrequency
			+ (semantic.logFrequency - target.logFrequency) * retention;
		semantic.gain = target.gain + (semantic.gain - target.gain) * retention;
		semantic.logQ = target.logQ + (semantic.logQ - target.logQ) * retention;
		semantic.outputGain = target.outputGain
			+ (semantic.outputGain - target.outputGain) * retention;
		for (let index = 0; index < values.length; index += 1) values[index] += steps[index];
		sliceRemaining -= 1;
		if (sliceRemaining === 0) values.set(sectionTarget);
		const [g, k, m0, m1, m2] = values;
		const high = (input[frame] - (g + k) * state1 - state2)
			/ (1 + g * (g + k));
		const band = state1 + g * high;
		const low = state2 + g * band;
		state1 = 2 * band - state1;
		state2 = 2 * low - state2;
		reference[frame] = (m0 * high + m1 * band + m2 * low)
			* 10 ** (semantic.outputGain / 20);
		flushRemaining -= 1;
		if (flushRemaining === 0) {
			if (Math.abs(state1) < 1e-30) state1 = 0;
			if (Math.abs(state2) < 1e-30) state2 = 0;
			flushRemaining = 128;
		}
	}

	let squaredResidual = 0;
	let maximumResidual = 0;
	for (let frame = 0; frame < totalFrames; frame += 1) {
		const residual = actual[frame] - reference[frame];
		squaredResidual += residual * residual;
		maximumResidual = Math.max(maximumResidual, Math.abs(residual));
	}
	const residualDbFs = 20 * Math.log10(Math.sqrt(squaredResidual / totalFrames));
	assert.ok(
		residualDbFs < -80,
		`60 Hz sweep residual was ${residualDbFs.toFixed(2)} dBFS (peak ${maximumResidual})`,
	);
});

test('a 10 Hz Q 30 tail remains finite and decays to exact digital silence without injected noise', async () => {
	const sampleRate = 44_100;
	const runtime = await loadRuntime(sampleRate, 1);
	configure(runtime.exports, designParametricEq({
		outputGain: 0,
		bands: [{
			id: 'long-tail', enabled: true, type: 'peaking',
			frequency: 10, gain: 24, q: 30, slope: 12,
		}],
	}, sampleRate), 0, 0);
	const blockFrames = 1_024;
	const input = new Float32Array(
		runtime.memory.buffer,
		runtime.exports.peq_input_pointer(0),
		blockFrames,
	);
	const output = new Float32Array(
		runtime.memory.buffer,
		runtime.exports.peq_output_pointer(0),
		blockFrames,
	);
	input.fill(0);
	input[0] = 1;
	assert.equal(runtime.exports.peq_process(blockFrames), blockFrames);
	input.fill(0);
	let silentBlock = -1;
	for (let block = 1; block <= 12_000; block += 1) {
		assert.equal(runtime.exports.peq_process(blockFrames), blockFrames);
		assert.ok(output.every(Number.isFinite));
		if (output.every((sample) => sample === 0)) {
			silentBlock = block;
			break;
		}
	}
	assert.ok(silentBlock > 0, 'the long low-frequency state eventually flushes to exact zero');
	for (let block = 0; block < 8; block += 1) {
		assert.equal(runtime.exports.peq_process(blockFrames), blockFrames);
		assert.ok(output.every((sample) => sample === 0), 'silence stays exact without dither or limit cycles');
	}
});

test('the WASM ABI validates packets, transitions atomically, and fails closed on non-finite PCM', async () => {
	const runtime = await loadRuntime(48_000, 1);
	const identity = designParametricEq({ bands: [], outputGain: 0 }, 48_000);
	configure(runtime.exports, identity, 0, 0);

	assert.equal(runtime.exports.peq_begin_configuration(1, 1, 0), 0);
	assert.equal(runtime.exports.peq_set_band(0, 0, 1, 1), 0);
	assert.equal(
		runtime.exports.peq_set_section(0, Number.NaN, 1, 0, 0, 1),
		-2,
		'non-finite TPT values are rejected before commit',
	);
	assert.equal(runtime.exports.peq_commit_configuration(0, 0), -4);

	const next = designParametricEq({
		bands: [{
			id: 'cut', enabled: true, type: 'lowpass', frequency: 3_000,
			gain: 0, q: 0.707, slope: 24,
		}],
	}, 48_000);
	configure(runtime.exports, next, 2, 32);
	assert.equal(runtime.exports.peq_is_transitioning(), 1);
	assert.equal(runtime.exports.peq_begin_configuration(0, 0, 0), -3);
	processNative(runtime, [new Float32Array(32)], 32);
	assert.equal(runtime.exports.peq_is_transitioning(), 0);

	const inputPointer = runtime.exports.peq_input_pointer(0);
	const outputPointer = runtime.exports.peq_output_pointer(0);
	const input = new Float32Array(runtime.memory.buffer, inputPointer, 8);
	const output = new Float32Array(runtime.memory.buffer, outputPointer, 8);
	input.fill(1);
	input[3] = Number.NaN;
	output.fill(1);
	assert.equal(runtime.exports.peq_process(8), -5);
	assert.deepEqual([...output], Array(8).fill(0), 'a rejected block is completely muted');
	assert.equal(runtime.exports.peq_reset(), 0);
});

async function loadRuntime(sampleRate, channelCount) {
	const bytes = await readFile(WASM_URL);
	const { instance } = await WebAssembly.instantiate(bytes, {});
	instance.exports._initialize?.();
	assert.equal(instance.exports.peq_initialize(sampleRate, channelCount), 0);
	return {
		exports: instance.exports,
		memory: instance.exports.memory,
		channelCount,
	};
}

function tptArray(values) {
	return Float64Array.of(
		values.g,
		values.k,
		values.m0,
		values.m1,
		values.m2,
	);
}

function configure(exports, configuration, mode, transitionFrames) {
	assert.equal(
		exports.peq_begin_semantic_configuration(
			configuration.packet.bands.length,
			configuration.packet.outputGainDb,
		),
		0,
	);
	const nativeTypes = {
		peaking: 0,
		lowshelf: 1,
		highshelf: 2,
		highpass: 3,
		lowpass: 4,
		notch: 5,
	};
	for (let bandIndex = 0; bandIndex < configuration.packet.bands.length; bandIndex += 1) {
		const band = configuration.packet.bands[bandIndex];
		assert.equal(
			exports.peq_set_semantic_band(
				bandIndex,
				nativeTypes[band.type],
				band.slopeDbPerOctave,
				band.frequencyHz,
				band.gainDb,
				band.q,
				band.enabled ? 1 : 0,
			),
			0,
		);
	}
	assert.equal(exports.peq_commit_configuration(mode, transitionFrames), 0);
}

function processNative(runtime, channels, blockFrames) {
	const frames = channels[0].length;
	const output = channels.map(() => new Float32Array(frames));
	for (let offset = 0; offset < frames; offset += blockFrames) {
		const length = Math.min(blockFrames, frames - offset);
		for (let channel = 0; channel < runtime.channelCount; channel += 1) {
			new Float32Array(
				runtime.memory.buffer,
				runtime.exports.peq_input_pointer(channel),
				length,
			).set(channels[channel].subarray(offset, offset + length));
		}
		assert.equal(runtime.exports.peq_process(length), length);
		for (let channel = 0; channel < runtime.channelCount; channel += 1) {
			output[channel].set(new Float32Array(
				runtime.memory.buffer,
				runtime.exports.peq_output_pointer(channel),
				length,
			), offset);
		}
	}
	return output;
}
