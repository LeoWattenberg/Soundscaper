import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createEbuR128Meter,
} from '../src/common/editor/ebu-r128.js';
import {
	createEbuR128MeterNode,
} from '../src/common/editor/ebu-r128-node.js';

const LOUDNESS_SAMPLE_RATE = 24_000;
const TRUE_PEAK_SAMPLE_RATE = 48_000;

test('Tech 3341 synthetic loudness cases 1-6 meet their minimum tolerances', () => {
	const cases = [
		{ number: 1, segments: [[20, -23]], expected: -23, fields: ['momentaryLufs', 'shortTermLufs', 'integratedLufs'] },
		{ number: 2, segments: [[20, -33]], expected: -33, fields: ['momentaryLufs', 'shortTermLufs', 'integratedLufs'] },
		{ number: 3, segments: [[10, -36], [60, -23], [10, -36]], expected: -23, fields: ['integratedLufs'] },
		{ number: 4, segments: [[10, -72], [10, -36], [60, -23], [10, -36], [10, -72]], expected: -23, fields: ['integratedLufs'] },
		{ number: 5, segments: [[20, -26], [20.1, -20], [20, -26]], expected: -23, fields: ['integratedLufs'] },
	];
	for (const fixture of cases) {
		const meter = createEbuR128Meter({
			sampleRate: LOUDNESS_SAMPLE_RATE,
			channelCount: 2,
			running: true,
		});
		pushToneSegments(meter, fixture.segments);
		const loudness = meter.snapshot().loudness;
		for (const field of fixture.fields) {
			assertNear(loudness[field], fixture.expected, 0.1, `Tech 3341 case ${fixture.number} ${field}`);
		}
	}

	const surround = createEbuR128Meter({
		sampleRate: LOUDNESS_SAMPLE_RATE,
		channelCount: 5,
		running: true,
	});
	pushToneSegments(surround, [[20, [-28, -28, -24, -30, -30]]]);
	assertNear(surround.snapshot().loudness.integratedLufs, -23, 0.1, 'Tech 3341 case 6 I');
});

test('Tech 3341 sliding-window cases 9 and 12 remain constant at -23 LUFS', () => {
	const shortTerm = createEbuR128Meter({
		sampleRate: LOUDNESS_SAMPLE_RATE,
		channelCount: 2,
		running: true,
	});
	pushToneSegments(shortTerm, repeatSegments([[1.34, -20], [1.66, -30]], 5));
	assertNear(shortTerm.snapshot().loudness.shortTermLufs, -23, 0.1, 'Tech 3341 case 9 S');

	const momentary = createEbuR128Meter({
		sampleRate: LOUDNESS_SAMPLE_RATE,
		channelCount: 2,
		running: true,
	});
	pushToneSegments(momentary, repeatSegments([[0.18, -20], [0.22, -30]], 25));
	assertNear(momentary.snapshot().loudness.momentaryLufs, -23, 0.1, 'Tech 3341 case 12 M');
});

test('Tech 3342 synthetic Loudness Range cases 1-4 meet their minimum tolerances', () => {
	const cases = [
		{ number: 1, levels: [-20, -30], expected: 10 },
		{ number: 2, levels: [-20, -15], expected: 5 },
		{ number: 3, levels: [-40, -20], expected: 20 },
		{ number: 4, levels: [-50, -35, -20, -35, -50], expected: 15 },
	];
	for (const fixture of cases) {
		const meter = createEbuR128Meter({
			sampleRate: LOUDNESS_SAMPLE_RATE,
			channelCount: 2,
			running: true,
		});
		pushToneSegments(meter, fixture.levels.map((level) => [20, level]));
		assertNear(
			meter.snapshot().loudness.loudnessRangeLu,
			fixture.expected,
			1,
			`Tech 3342 case ${fixture.number} LRA`,
		);
	}
});

test('Tech 3341 true-peak cases 15-23 meet their minimum tolerances', () => {
	const simpleCases = [
		{ number: 15, divisor: 4, amplitude: 0.5, phase: 0, expected: -6 },
		{ number: 16, divisor: 4, amplitude: 0.5, phase: 45, expected: -6 },
		{ number: 17, divisor: 6, amplitude: 0.5, phase: 60, expected: -6 },
		{ number: 18, divisor: 8, amplitude: 0.5, phase: 67.5, expected: -6 },
		{ number: 19, divisor: 4, amplitude: 1.41, phase: 45, expected: 3 },
	];
	for (const fixture of simpleCases) {
		const tone = taperedTruePeakTone(fixture);
		const meter = createEbuR128Meter({
			sampleRate: TRUE_PEAK_SAMPLE_RATE,
			channelCount: 2,
			running: true,
		});
		meter.push([tone, tone]);
		assertTruePeakTolerance(
			meter.snapshot().loudness.maximumTruePeakDbtp,
			fixture.expected,
			`Tech 3341 case ${fixture.number}`,
		);
	}

	for (const [offset, channels] of phaseOffsetTruePeakFixtures().entries()) {
		const meter = createEbuR128Meter({
			sampleRate: TRUE_PEAK_SAMPLE_RATE,
			channelCount: 2,
			running: true,
		});
		meter.push(channels);
		assertTruePeakTolerance(
			meter.snapshot().loudness.maximumTruePeakDbtp,
			0,
			`Tech 3341 case ${20 + offset}`,
		);
	}
});

test('streaming state is chunk-invariant and pause, continue, and reset retain the specified state', () => {
	const sampleRate = 16_000;
	const signal = Float32Array.from({ length: sampleRate * 8 }, (_, frame) => (
		10 ** (-23 / 20) * Math.sin(2 * Math.PI * 1_000 * frame / sampleRate)
	));
	const oneShot = createEbuR128Meter({ sampleRate, channelCount: 2, running: true });
	oneShot.push([signal, signal]);
	const chunked = createEbuR128Meter({ sampleRate, channelCount: 2, running: true });
	for (let start = 0; start < signal.length; start += 733) {
		const end = Math.min(signal.length, start + 733);
		chunked.push([signal.subarray(start, end), signal.subarray(start, end)]);
	}
	assert.deepEqual(chunked.snapshot(), oneShot.snapshot());

	chunked.setRunning(false);
	const loudIdle = Float32Array.from({ length: sampleRate * 2 }, (_, frame) => (
		10 ** (-10 / 20) * Math.sin(2 * Math.PI * 1_000 * frame / sampleRate)
	));
	chunked.push([loudIdle, loudIdle]);
	let snapshot = chunked.snapshot();
	assert.equal(snapshot.loudness.measuredSeconds, 8);
	assert.equal(snapshot.loudness.state, 'standby');
	assertNear(snapshot.loudness.momentaryLufs, -10, 0.15, 'idle live Momentary');
	assertNear(snapshot.loudness.integratedLufs, -23, 0.15, 'paused Integrated');

	chunked.setRunning(true);
	chunked.push([signal.subarray(0, sampleRate), signal.subarray(0, sampleRate)]);
	assert.equal(chunked.snapshot().loudness.measuredSeconds, 9);
	chunked.reset();
	snapshot = chunked.snapshot();
	assert.equal(snapshot.loudness.state, 'running');
	assert.equal(snapshot.loudness.measuredSeconds, 0);
	assert.equal(snapshot.loudness.integratedLufs, null);
	assert.equal(snapshot.loudness.loudnessRangeLu, null);
	assert.equal(snapshot.loudness.maximumMomentaryLufs, null);
	assert.equal(snapshot.loudness.maximumShortTermLufs, null);
	assert.equal(snapshot.loudness.maximumTruePeakDbtp, null);
});

test('silence, mono/stereo summation, sample-rate variation, telemetry cadence, and LRA stability are explicit', () => {
	for (const sampleRate of [16_000, 44_100, 48_000, 96_000]) {
		const silence = new Float32Array(Math.round(sampleRate * 3));
		const silent = createEbuR128Meter({ sampleRate, channelCount: 1, running: true });
		silent.push([silence]);
		const result = silent.snapshot();
		assert.equal(result.loudness.integratedLufs, null);
		assert.equal(result.loudness.maximumTruePeakDbtp, -120);
	}

	const sampleRate = 16_000;
	const tone = Float32Array.from({ length: sampleRate * 4 }, (_, frame) => (
		10 ** (-23 / 20) * Math.sin(2 * Math.PI * 1_000 * frame / sampleRate)
	));
	const mono = createEbuR128Meter({ sampleRate, channelCount: 1, running: true });
	const stereo = createEbuR128Meter({ sampleRate, channelCount: 2, running: true });
	let updates = 0;
	mono.push([tone], () => { updates += 1; });
	stereo.push([tone, tone]);
	assert.equal(updates, 40);
	assertNear(
		stereo.snapshot().loudness.integratedLufs - mono.snapshot().loudness.integratedLufs,
		10 * Math.log10(2),
		0.001,
		'stereo channel summation',
	);

	const longMeter = createEbuR128Meter({ sampleRate, channelCount: 1, running: true });
	const longTone = Float32Array.from({ length: sampleRate * 60 }, (_, frame) => (
		0.05 * Math.sin(2 * Math.PI * 1_000 * frame / sampleRate)
	));
	longMeter.push([longTone.subarray(0, sampleRate * 59)]);
	assert.equal(longMeter.snapshot().loudness.loudnessRangeStable, false);
	longMeter.push([longTone.subarray(sampleRate * 59)]);
	assert.equal(longMeter.snapshot().loudness.loudnessRangeStable, true);
});

test('AudioWorklet processing is transparent and emits meter telemetry at 10 Hz', async () => {
	const previousBase = globalThis.AudioWorkletProcessor;
	const previousRegister = globalThis.registerProcessor;
	const previousSampleRate = globalThis.sampleRate;
	let Processor = null;
	class MockProcessorBase {
		constructor() {
			const messages = [];
			this.port = {
				messages,
				onmessage: null,
				postMessage(message) { messages.push(message); },
				start() {},
			};
		}
	}
	globalThis.AudioWorkletProcessor = MockProcessorBase;
	globalThis.registerProcessor = (_name, constructor) => { Processor = constructor; };
	globalThis.sampleRate = TRUE_PEAK_SAMPLE_RATE;
	try {
		await import(`../src/common/editor/ebu-r128-worklet.js?test=${Date.now()}`);
		const processor = new Processor({
			processorOptions: {
				sampleRate: TRUE_PEAK_SAMPLE_RATE,
				channelCount: 2,
				running: true,
			},
		});
		for (let block = 0; block < 38; block += 1) {
			const output = [new Float32Array(128).fill(1), new Float32Array(128).fill(1)];
			assert.equal(processor.process([[]], [output]), true);
			assert.equal(output.every((channel) => channel.every((sample) => sample === 0)), true);
		}
		assert.equal(processor.port.messages.filter(({ type }) => type === 'meter').length, 0);
		for (let block = 0; block < 38; block += 1) {
			const left = Float32Array.from({ length: 128 }, (_, frame) => ((block * 128 + frame) % 31) / 31 - 0.5);
			const right = Float32Array.from(left, (sample) => -sample);
			const output = [new Float32Array(128), new Float32Array(128)];
			assert.equal(processor.process([[left, right]], [output]), true);
			assert.deepEqual(output, [left, right]);
		}
		assert.equal(processor.port.messages[0].type, 'ready');
		assert.equal(processor.port.messages.filter(({ type }) => type === 'meter').length, 1);

		const gained = new Processor({
			processorOptions: {
				sampleRate: TRUE_PEAK_SAMPLE_RATE,
				channelCount: 2,
				inputGain: 0.5,
				running: true,
			},
		});
		for (let block = 0; block < 38; block += 1) {
			const mono = new Float32Array(128).fill(0.5);
			const output = [new Float32Array(128), new Float32Array(128)];
			assert.equal(gained.process([[mono]], [output]), true);
			assert.equal(output.every((channel) => channel.every((sample) => sample === 0.25)), true);
		}
		const gainedReading = gained.port.messages.find(({ type }) => type === 'meter').meter;
		assert.ok(gainedReading.peak >= 0.25 && gainedReading.peak < 0.3);
		assertNear(gainedReading.rms, 0.25, 1e-7, 'worklet input-gain RMS');
		assertNear(gainedReading.dbfs, 20 * Math.log10(gainedReading.peak), 1e-7, 'worklet input-gain dBFS');
	} finally {
		if (previousBase === undefined) delete globalThis.AudioWorkletProcessor;
		else globalThis.AudioWorkletProcessor = previousBase;
		if (previousRegister === undefined) delete globalThis.registerProcessor;
		else globalThis.registerProcessor = previousRegister;
		if (previousSampleRate === undefined) delete globalThis.sampleRate;
		else globalThis.sampleRate = previousSampleRate;
	}
});

test('AudioWorklet node loading is persistent per context and exposes measurement controls', async () => {
	const modules = [];
	const nodes = [];
	const context = {
		sampleRate: TRUE_PEAK_SAMPLE_RATE,
		audioWorklet: { async addModule(url) { modules.push(String(url)); } },
	};
	const nodeFactory = (_context, name, options) => {
		const messages = [];
		const node = {
			name,
			options,
			messages,
			port: {
				onmessage: null,
				postMessage(message) { messages.push(message); },
				start() {},
			},
			disconnect() { this.disconnected = true; },
		};
		nodes.push(node);
		return node;
	};
	const first = await createEbuR128MeterNode(context, { nodeFactory });
	const second = await createEbuR128MeterNode(context, { nodeFactory });
	assert.equal(modules.length, 1);
	assert.equal(nodes.length, 2);
	assert.equal(nodes[0].name, 'kw-ebu-r128-meter');
	first.setRunning(true);
	first.setInputGain(0.5);
	first.reset();
	first.requestSnapshot();
	assert.deepEqual(nodes[0].messages, [
		{ type: 'running', running: true },
		{ type: 'input-gain', value: 0.5 },
		{ type: 'reset' },
		{ type: 'snapshot' },
	]);
	first.dispose();
	second.dispose();
	assert.equal(nodes.every(({ disconnected }) => disconnected), true);
});

function pushToneSegments(meter, segments) {
	let cursor = 0;
	for (const [seconds, levelsValue] of segments) {
		const levels = Array.isArray(levelsValue)
			? levelsValue
			: Array.from({ length: meter.snapshot().peak === undefined ? 1 : inferChannelCount(levelsValue, segments) }, () => levelsValue);
		let framesLeft = Math.round(seconds * LOUDNESS_SAMPLE_RATE);
		while (framesLeft > 0) {
			const frames = Math.min(4_096, framesLeft);
			const channels = levels.map((level) => {
				const amplitude = 10 ** (level / 20);
				return Float32Array.from({ length: frames }, (_, frame) => (
					amplitude * Math.sin(2 * Math.PI * 1_000 * (cursor + frame) / LOUDNESS_SAMPLE_RATE)
				));
			});
			meter.push(channels);
			cursor += frames;
			framesLeft -= frames;
		}
	}
}

function inferChannelCount(_level, segments) {
	return segments.some(([, levels]) => Array.isArray(levels)) ? segments.find(([, levels]) => Array.isArray(levels))[1].length : 2;
}

function repeatSegments(segments, count) {
	return Array.from({ length: count }, () => segments).flat();
}

function taperedTruePeakTone({ divisor, amplitude, phase }) {
	const frames = Math.round(TRUE_PEAK_SAMPLE_RATE * 0.25);
	const fadeFrames = Math.round(TRUE_PEAK_SAMPLE_RATE * 0.01);
	return Float32Array.from({ length: frames }, (_, frame) => {
		const taper = Math.max(0, Math.min(1, frame / fadeFrames, (frames - 1 - frame) / fadeFrames));
		return amplitude * Math.sin(2 * Math.PI * frame / divisor + phase * Math.PI / 180) * taper;
	});
}

function phaseOffsetTruePeakFixtures() {
	const oversample = 4;
	const highRateFrames = TRUE_PEAK_SAMPLE_RATE * oversample / 2;
	const taps = 257;
	const middle = (taps - 1) / 2;
	const cutoff = 0.125;
	const filter = new Float64Array(taps);
	let filterSum = 0;
	for (let tap = 0; tap < taps; tap += 1) {
		const offset = tap - middle;
		const window = 0.42
			- 0.5 * Math.cos(2 * Math.PI * tap / (taps - 1))
			+ 0.08 * Math.cos(4 * Math.PI * tap / (taps - 1));
		filter[tap] = (offset === 0
			? 2 * cutoff
			: Math.sin(2 * Math.PI * cutoff * offset) / (Math.PI * offset)) * window;
		filterSum += filter[tap];
	}
	for (let tap = 0; tap < taps; tap += 1) filter[tap] /= filterSum;

	const source = new Float64Array(highRateFrames);
	const centre = highRateFrames / 2;
	for (let frame = 0; frame < highRateFrames; frame += 1) {
		const distance = frame - centre;
		const burstWindow = Math.abs(distance) < 64
			? 0.5 + 0.5 * Math.cos(Math.PI * distance / 64)
			: 0;
		source[frame] = 0.5 * Math.sin(2 * Math.PI * frame / 24)
			+ 0.75 * Math.sin(2 * Math.PI * frame / 16) * burstWindow;
	}
	const filtered = new Float64Array(highRateFrames);
	let maximum = 0;
	for (let frame = middle; frame < highRateFrames - middle; frame += 1) {
		let sample = 0;
		for (let tap = 0; tap < taps; tap += 1) {
			sample += source[frame + tap - middle] * filter[tap];
		}
		filtered[frame] = sample;
		if (frame > 1_000 && frame < highRateFrames - 1_000) maximum = Math.max(maximum, Math.abs(sample));
	}
	const fixtures = [];
	for (let phase = 0; phase < oversample; phase += 1) {
		const frames = Math.floor((highRateFrames - 2_000 - phase) / oversample) - 500;
		const channel = Float32Array.from({ length: frames }, (_, frame) => (
			filtered[1_000 + phase + frame * oversample] / maximum
		));
		fixtures.push([channel, channel]);
	}
	return fixtures;
}

function assertNear(actual, expected, tolerance, label) {
	assert.ok(
		Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
		`${label}: expected ${expected} ±${tolerance}, received ${actual}`,
	);
}

function assertTruePeakTolerance(actual, expected, label) {
	assert.ok(
		Number.isFinite(actual) && actual >= expected - 0.4 && actual <= expected + 0.2,
		`${label}: expected ${expected} +0.2/-0.4 dBTP, received ${actual}`,
	);
}
