import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
	PARAMETRIC_EQ_WORKLET_NAME,
	ParametricEqProcessor,
	evaluateParametricEqResponse,
	normalizeParametricEqParams,
	packParametricEqParams,
	processParametricEqChannels,
} from '../src/common/editor/parametric-eq/index.js';
import {
	biquadToTpt,
	designMatchedShelf,
	designParametricEq,
	sectionMagnitudeSquared,
} from '../src/common/editor/parametric-eq/design.js';

test('parametric EQ migrates legacy bands and emits a bounded versioned DSP packet', () => {
	const bands = Array.from({ length: 14 }, (_, index) => ({
		id: index < 2 ? 'duplicate' : undefined,
		frequency: index === 0 ? -20 : 50_000,
		gain: index % 2 ? -99 : 99,
		q: index % 2 ? 0 : 99,
		type: index === 0 ? 'bell' : index === 1 ? 'low-cut' : 'unknown',
		slope: 35,
	}));
	const normalized = normalizeParametricEqParams({ outputGain: 99, bands }, 'effect-1');
	assert.equal(normalized.bands.length, 12);
	assert.equal(new Set(normalized.bands.map((band) => band.id)).size, 12);
	assert.deepEqual(normalized.bands[0], {
		id: 'duplicate',
		type: 'peaking',
		enabled: true,
		frequency: 10,
		gain: 24,
		q: 30,
		slope: 36,
	});
	assert.equal(normalized.bands[1].type, 'highpass');
	assert.equal(normalized.bands[1].id, 'effect-1-band-2');
	assert.equal(normalized.outputGain, 24);

	const packet = packParametricEqParams(normalized, 'effect-1');
	assert.equal(packet.version, 1);
	assert.equal(packet.outputGainDb, 24);
	assert.equal(packet.bands[0].frequencyHz, 10);
	assert.equal(packet.bands[0].slopeDbPerOctave, 36);
	assert.deepEqual(packParametricEqParams(packet, 'effect-1'), packet);
});

test('matched response preserves bell peaks, exact notches, reciprocal gain, and cut ordering', () => {
	const sampleRate = 48_000;
	const bell = (gain) => ({
		bands: [{ id: 'bell', enabled: true, type: 'peaking', frequency: 16_000, gain, q: 1, slope: 12 }],
		outputGain: 0,
	});
	assert.ok(Math.abs(evaluateParametricEqResponse(bell(12), sampleRate, [16_000])[0] - 12) < 1e-9);
	assert.ok(Math.abs(evaluateParametricEqResponse(bell(-12), sampleRate, [16_000])[0] + 12) < 1e-9);

	const reciprocal = {
		bands: [bell(24).bands[0], { ...bell(-24).bands[0], id: 'inverse' }],
		outputGain: 0,
	};
	const frequencies = Float64Array.from({ length: 128 }, (_, index) => 10 * (2_352 ** (index / 127)));
	const reciprocalResponse = evaluateParametricEqResponse(reciprocal, sampleRate, frequencies);
	assert.ok(Math.max(...reciprocalResponse, 0) < 1e-10);
	assert.ok(Math.min(...reciprocalResponse, 0) > -1e-10);

	const notch = {
		bands: [{ id: 'notch', enabled: true, type: 'notch', frequency: 17_000, gain: 0, q: 10, slope: 12 }],
		outputGain: 0,
	};
	assert.ok(evaluateParametricEqResponse(notch, sampleRate, [17_000])[0] < -250);

	const highpass = (slope) => ({
		bands: [{ id: 'cut', enabled: true, type: 'highpass', frequency: 2_000, gain: 0, q: 1, slope }],
		outputGain: 0,
	});
	const attenuation12 = evaluateParametricEqResponse(highpass(12), sampleRate, [500])[0];
	const attenuation48 = evaluateParametricEqResponse(highpass(48), sampleRate, [500])[0];
	assert.ok(attenuation12 < -20);
	assert.ok(attenuation48 < attenuation12 - 50);
});

test('matched shelves are reciprocal and remain finite close to Nyquist', () => {
	for (const type of ['lowshelf', 'highshelf']) {
		const params = {
			bands: [
				{ id: 'boost', enabled: true, type, frequency: 16_000, gain: 24, q: 1, slope: 12 },
				{ id: 'cut', enabled: true, type, frequency: 16_000, gain: -24, q: 1, slope: 12 },
			],
			outputGain: 0,
		};
		const response = evaluateParametricEqResponse(params, 48_000, [10, 1_000, 16_000, 23_520]);
		for (const value of response) assert.ok(Number.isFinite(value) && Math.abs(value) < 1e-9);
	}
});

test('small low-frequency shelves remain active when their fitted system is numerically small', () => {
	for (const type of ['lowshelf', 'highshelf']) {
		for (const gain of [-0.1, 0.1]) {
			const tpt = biquadToTpt(designMatchedShelf(type, 10, gain, 192_000));
			const endpointDb = 20 * Math.log10(type === 'lowshelf' ? Math.abs(tpt.m2) : Math.abs(tpt.m0));
			assert.ok(Math.abs(endpointDb - gain) < 1e-10, `${type} ${gain} dB endpoint was ${endpointDb} dB`);
		}
	}
});

test('a broad 16 kHz bell keeps its analog half-gain edge where an RBJ bell cramps', () => {
	const sampleRate = 48_000;
	const center = 16_000;
	for (const gain of [-12, 12]) {
		const params = {
			outputGain: 0,
			bands: [{ id: 'bandwidth', enabled: true, type: 'peaking', frequency: center, gain, q: 1, slope: 12 }],
		};
		const section = designParametricEq(params, sampleRate).sections[0];
		const matchedResponse = (frequency) => 10 * Math.log10(
			sectionMagnitudeSquared(section.coefficients, frequency, sampleRate),
		);
		const analogResponse = analogBellResponse(center, 1, gain);
		const rbjResponse = rbjBellResponse(sampleRate, center, 1, gain);
		const target = gain / 2;
		const expectedEdge = lowerHalfGainEdge(analogResponse, target, 10, center);
		const matchedEdge = lowerHalfGainEdge(matchedResponse, target, 10, center);
		const rbjEdge = lowerHalfGainEdge(rbjResponse, target, 10, center);
		const matchedError = Math.abs(matchedEdge - expectedEdge) / expectedEdge;
		const rbjError = Math.abs(rbjEdge - expectedEdge) / expectedEdge;
		assert.ok(Math.abs(matchedResponse(center) - gain) < 0.01);
		assert.ok(matchedError < 0.05, `matched ${gain} dB half-gain error was ${matchedError}`);
		assert.ok(rbjError > 0.15 && rbjError > matchedError * 5, `RBJ error ${rbjError} should materially exceed ${matchedError}`);
	}
});

test('f64 TPT processing is neutral when flat and agrees with the analytic response', () => {
	const sampleRate = 48_000;
	const input = Float32Array.from({ length: sampleRate }, (_, frame) => 0.125 * Math.sin(2 * Math.PI * 16_000 * frame / sampleRate));
	const snapshot = input.slice();
	const flat = processParametricEqChannels([input], sampleRate, {});
	let flatError = 0;
	for (let frame = 0; frame < input.length; frame += 1) flatError = Math.max(flatError, Math.abs(flat[0][frame] - input[frame]));
	assert.ok(flatError < 1e-9);
	assert.deepEqual(input, snapshot);

	const params = {
		bands: [{ id: 'bell', enabled: true, type: 'peaking', frequency: 16_000, gain: 12, q: 1, slope: 12 }],
		outputGain: -3,
	};
	const [output] = processParametricEqChannels([input], sampleRate, params);
	const measuredGain = rms(output.subarray(sampleRate / 2)) / rms(input.subarray(sampleRate / 2));
	const expectedDb = evaluateParametricEqResponse(params, sampleRate, [16_000])[0];
	assert.ok(Math.abs(20 * Math.log10(measuredGain) - expectedDb) < 0.001);
});

test('extreme low-frequency and near-Nyquist sections remain finite at supported rates', () => {
	for (const sampleRate of [44_100, 48_000, 96_000, 192_000]) {
		for (const frequency of [10, sampleRate * 0.49]) {
			for (const q of [0.1, 30]) {
				const params = {
					bands: [{ id: 'edge', enabled: true, type: 'peaking', frequency, gain: 24, q, slope: 48 }],
					outputGain: 0,
				};
				const impulse = new Float32Array(8_192);
				impulse[0] = 1;
				const [output] = processParametricEqChannels([impulse], sampleRate, params);
				for (const value of output) assert.ok(Number.isFinite(value));
				for (const value of evaluateParametricEqResponse(params, sampleRate, [10, sampleRate * 0.49])) {
					assert.ok(Number.isFinite(value));
				}
			}
		}
	}
});

test('realtime smoothing advances once per frame, preserves channels, and keeps bypass warm', () => {
	const enabled = {
		bands: [{ id: 'bell', enabled: true, type: 'peaking', frequency: 1_000, gain: 18, q: 8, slope: 12 }],
		outputGain: 0,
	};
	const processor = new ParametricEqProcessor(48_000, enabled);
	const input = Float32Array.from({ length: 1_024 }, (_, frame) => 0.1 * Math.sin(2 * Math.PI * 1_000 * frame / 48_000));
	processor.process([input, input]);
	processor.configure({ ...enabled, bands: [{ ...enabled.bands[0], gain: -18 }] }, { transitionFrames: 128 });
	const stereo = processor.process([input, input]);
	assert.deepEqual(stereo[0], stereo[1]);

	processor.configure({ ...enabled, bands: [{ ...enabled.bands[0], enabled: false }] }, { transitionFrames: 128 });
	const bypassed = processor.process([input]);
	for (let frame = 256; frame < input.length; frame += 1) assert.ok(Math.abs(bypassed[0][frame] - input[frame]) < 1e-7);
	processor.configure(enabled, { transitionFrames: 128 });
	const restored = processor.process([input]);
	for (const value of restored[0]) assert.ok(Number.isFinite(value));

	const tooMany = Array.from({ length: 33 }, () => new Float32Array(128));
	assert.throws(() => processor.process(tooMany), /at most 32 channels/);
});

test('worklet wrapper registers the stable processor name and accepts revisioned messages', async () => {
	const module = await import(`../src/common/editor/parametric-eq/worklet.js?test=${Date.now()}`);
	const wasmModule = await WebAssembly.compile(await readFile(new URL(
		'../src/common/editor/parametric-eq/parametric-eq.wasm',
		import.meta.url,
	)));
	assert.equal(PARAMETRIC_EQ_WORKLET_NAME, 'kw-parametric-eq');
	assert.equal(module.PARAMETRIC_EQ_WORKLET_NAME, PARAMETRIC_EQ_WORKLET_NAME);
	assert.throws(() => new module.ParametricEqWorkletProcessor({
		processorOptions: { sampleRate: 48_000, params: { outputGain: 0, bands: [] } },
	}), /precompiled WebAssembly\.Module/);
	const processor = new module.ParametricEqWorkletProcessor({
		processorOptions: {
			sampleRate: 48_000,
			channelCount: 1,
			params: { outputGain: 0, bands: [] },
			revision: 4,
			wasmModule: structuredClone(wasmModule),
		},
	});
	const messages = [];
	processor.port.postMessage = (message) => messages.push(message);
	processor.port.onmessage({
		data: {
			type: 'configure',
			revision: 5,
			transitionFrames: 64,
			params: { outputGain: 3, bands: [] },
		},
	});
	assert.equal(messages.at(-1).status, 'configured');
	assert.equal(messages.at(-1).revision, 5);
	const acknowledgedMessages = messages.length;
	processor.port.onmessage({
		data: {
			type: 'configure',
			revision: 5,
			params: { outputGain: -12, bands: [] },
		},
	});
	assert.equal(messages.length, acknowledgedMessages, 'duplicate revisions are ignored');
	assert.equal(processor.params.outputGain, 3);
	const input = [Float32Array.from({ length: 128 }, () => 0.25)];
	const output = [new Float32Array(128)];
	assert.equal(processor.process([input], [output]), true);
	for (const value of output[0]) assert.ok(Number.isFinite(value));
	processor.port.onmessage({
		data: {
			type: 'configure',
			revision: 6,
			params: { outputGain: Number.NaN, bands: [] },
		},
	});
	assert.equal(messages.at(-1).type, 'error');
	assert.equal(processor.revision, 5, 'invalid configuration retains the active revision');
	input[0][0] = Number.NaN;
	output[0].fill(1);
	assert.equal(processor.process([input], [output]), true);
	assert.ok(output[0].every((value) => value === 0));
	assert.equal(messages.at(-1).type, 'error');
});

test('WASM worklet uses its fixed channel capacity and coalesces structural edits', async () => {
	const module = await import(`../src/common/editor/parametric-eq/worklet.js?coalesce=${Date.now()}`);
	const wasmModule = await WebAssembly.compile(await readFile(new URL(
		'../src/common/editor/parametric-eq/parametric-eq.wasm',
		import.meta.url,
	)));
	const processor = new module.ParametricEqWorkletProcessor({
		processorOptions: {
			sampleRate: 48_000,
			channelCount: 2,
			params: { outputGain: 0, bands: [] },
			wasmModule,
		},
	});
	const messages = [];
	processor.port.postMessage = (message) => messages.push(message);
	const monoInput = [new Float32Array(128).fill(0.1)];
	const monoOutput = [new Float32Array(128)];
	assert.equal(processor.process([monoInput], [monoOutput]), true);
	assert.equal(processor.channelCount, 2);

	processor.port.onmessage({ data: {
		type: 'configure', revision: 1, transitionFrames: 128,
		params: eqWithBand('first', 'peaking', 1_000, 6),
	} });
	assert.equal(processor.runtime.transitioning, true);
	processor.port.onmessage({ data: {
		type: 'configure', revision: 2, transitionFrames: 128,
		params: eqWithBand('superseded', 'lowpass', 4_000, 0),
	} });
	processor.port.onmessage({ data: {
		type: 'audition', revision: 3, bandId: 'superseded', transitionFrames: 128,
	} });
	processor.port.onmessage({ data: {
		type: 'configure', revision: 4, transitionFrames: 128,
		params: eqWithBand('latest', 'highpass', 120, 0),
	} });
	processor.port.onmessage({ data: {
		type: 'configure', revision: 3,
		params: eqWithBand('stale', 'peaking', 500, 3),
	} });
	assert.equal(processor.queuedConfiguration.configuration.packet.bands[0].id, 'latest');
	assert.equal(processor.revision, 4, 'stale structural edits are ignored');
	assert.equal(messages.filter((message) => message.type === 'error').length, 0);

	processor.process([monoInput], [monoOutput]);
	assert.equal(processor.runtime.transitioning, false);
	assert.ok(processor.queuedConfiguration, 'latest edit waits until the completed transition boundary');
	processor.process([monoInput], [monoOutput]);
	assert.equal(processor.queuedConfiguration, null);
	assert.equal(processor.runtime.configuration.packet.bands[0].id, 'latest');

	const stereoOutput = [new Float32Array(128), new Float32Array(128)];
	assert.equal(processor.process([monoInput], [stereoOutput]), true, 'output may grow within configured capacity');
	const excessiveOutput = Array.from({ length: 3 }, () => new Float32Array(128).fill(1));
	assert.equal(processor.process([monoInput], [excessiveOutput]), true);
	assert.ok(excessiveOutput.every((channel) => channel.every((value) => value === 0)));
	assert.match(messages.at(-1).message, /configured capacity/);
});

function eqWithBand(id, type, frequency, gain) {
	return {
		outputGain: 0,
		bands: [{
			id,
			enabled: true,
			type,
			frequency,
			gain,
			q: 1,
			slope: 12,
		}],
	};
}

function rms(values) {
	let sum = 0;
	for (const value of values) sum += value * value;
	return Math.sqrt(sum / values.length);
}

function analogBellResponse(center, q, gainDb) {
	const amplitude = 10 ** (gainDb / 40);
	return (frequency) => {
		const ratio = frequency / center;
		const common = (1 - ratio * ratio) ** 2;
		const numerator = common + (amplitude * ratio / q) ** 2;
		const denominator = common + (ratio / (q * amplitude)) ** 2;
		return 10 * Math.log10(numerator / denominator);
	};
}

function rbjBellResponse(sampleRate, center, q, gainDb) {
	const amplitude = 10 ** (gainDb / 40);
	const omega = 2 * Math.PI * center / sampleRate;
	const alpha = Math.sin(omega) / (2 * q);
	const scale = 1 + alpha / amplitude;
	const coefficients = {
		b0: (1 + alpha * amplitude) / scale,
		b1: -2 * Math.cos(omega) / scale,
		b2: (1 - alpha * amplitude) / scale,
		a1: -2 * Math.cos(omega) / scale,
		a2: (1 - alpha / amplitude) / scale,
	};
	return (frequency) => {
		const phase = 2 * Math.PI * frequency / sampleRate;
		const numeratorReal = coefficients.b0 + coefficients.b1 * Math.cos(phase)
			+ coefficients.b2 * Math.cos(2 * phase);
		const numeratorImag = -coefficients.b1 * Math.sin(phase)
			- coefficients.b2 * Math.sin(2 * phase);
		const denominatorReal = 1 + coefficients.a1 * Math.cos(phase)
			+ coefficients.a2 * Math.cos(2 * phase);
		const denominatorImag = -coefficients.a1 * Math.sin(phase)
			- coefficients.a2 * Math.sin(2 * phase);
		return 10 * Math.log10(
			(numeratorReal ** 2 + numeratorImag ** 2)
			/ (denominatorReal ** 2 + denominatorImag ** 2),
		);
	};
}

function lowerHalfGainEdge(response, target, minimum, center) {
	let low = minimum;
	let high = center;
	const direction = Math.sign(target) || 1;
	for (let iteration = 0; iteration < 80; iteration += 1) {
		const middle = (low + high) / 2;
		if ((response(middle) - target) * direction < 0) low = middle;
		else high = middle;
	}
	return (low + high) / 2;
}
