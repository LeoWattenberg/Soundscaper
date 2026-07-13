import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { auditStaffPadWasm } from '../scripts/audit-staffpad-wasm.mjs';
import { StaffPadRenderClient as BarrelStaffPadRenderClient } from '../src/lib/tools/audio-editor/index.js';
import {
	AudacityStaffPadError,
	applyAudacityEffect,
	applyAudacityEffectAsync,
	estimateAudacityEffectOutputFrames,
} from '../src/lib/tools/audio-editor/audacity-effects/index.js';
import {
	STAFFPAD_ALGORITHM_ID,
	STAFFPAD_AUDACITY_REVISION,
	StaffPadRenderClient,
	createStaffPadCacheDescriptor,
	createStaffPadChangePitchTransform,
	createStaffPadChangeSpeedTransform,
	createStaffPadChangeTempoTransform,
	createStaffPadSlidingStretchTransform,
	evaluateStaffPadTransform,
	loadStaffPadWasm,
	normalizeStaffPadRenderRequest,
	normalizeStaffPadTransform,
	pitchCentsToRatio,
	renderStaffPad,
	staffPadRenderCacheKey,
	staffPadTransformOutputFrames,
} from '../src/lib/tools/audio-editor/staffpad/index.js';
import { STAFFPAD_NATIVE_GOLDEN } from './fixtures/staffpad-native-golden.js';

const WASM_PATH = new URL('../src/lib/tools/audio-editor/staffpad/staffpad.wasm', import.meta.url);

test('StaffPad mappings preserve Audacity pitch, tempo, speed, and sliding duration semantics', () => {
	assert.equal(BarrelStaffPadRenderClient, StaffPadRenderClient);
	assert.equal(STAFFPAD_AUDACITY_REVISION, '908ad0a526e5bfdab68de780e893cebe172d27eb');
	assert.equal(pitchCentsToRatio(1200), 2);
	assert.equal(pitchCentsToRatio(-1200), 0.5);

	const pitch = createStaffPadChangePitchTransform({ cents: 700, preserveFormants: true });
	assert.deepEqual(evaluateStaffPadTransform(pitch, 0.5), {
		timeRatio: 1,
		pitchRatio: 2 ** (700 / 1200),
	});
	assert.equal(staffPadTransformOutputFrames(48_000, pitch), 48_000);

	const tempo = createStaffPadChangeTempoTransform({ percent: -50 });
	assert.deepEqual(evaluateStaffPadTransform(tempo, 0.5), { timeRatio: 2, pitchRatio: 1 });
	assert.equal(staffPadTransformOutputFrames(48_000, tempo), 96_000);

	const speed = createStaffPadChangeSpeedTransform({ rate: 2 });
	assert.deepEqual(evaluateStaffPadTransform(speed, 0.5), { timeRatio: 0.5, pitchRatio: 2 });
	assert.equal(staffPadTransformOutputFrames(48_000, speed), 24_000);

	const sliding = createStaffPadSlidingStretchTransform({
		startTempoPercent: -50,
		endTempoPercent: 100,
		startPitchCents: -1200,
		endPitchCents: 1200,
	});
	assert.equal(sliding.durationRatio, 0.8, '2 / (0.5 + 2)');
	assert.deepEqual(evaluateStaffPadTransform(sliding, 0), { timeRatio: 2, pitchRatio: 0.5 });
	assert.deepEqual(evaluateStaffPadTransform(sliding, 1), { timeRatio: 0.5, pitchRatio: 2 });
	assert.equal(staffPadTransformOutputFrames(10_000, sliding), 8_000);
});

test('StaffPad validation enforces safe scalar-engine limits and exact output lengths', () => {
	const mono = [new Float32Array(100)];
	assert.throws(() => normalizeStaffPadTransform({ pitchRatio: 2.001 }), /between 0.5 and 2/);
	assert.throws(() => normalizeStaffPadTransform({ tempoRatio: 0.499 }), /between 0.5 and 2/);
	assert.throws(() => normalizeStaffPadTransform({ timeRatio: 1, tempoRatio: 1 }), /either tempoRatio or timeRatio/);
	assert.throws(() => normalizeStaffPadTransform({
		keyframes: [
			{ position: 0, tempoRatio: 1 },
			{ position: 0.5, tempoRatio: 1 },
			{ position: 0.4, tempoRatio: 1 },
			{ position: 1, tempoRatio: 1 },
		],
	}), /strictly increasing/);
	assert.throws(() => normalizeStaffPadRenderRequest({
		channels: [...mono, ...mono, ...mono], sampleRate: 48_000, transform: {},
	}), /one or two/);
	assert.throws(() => normalizeStaffPadRenderRequest({
		channels: [Float32Array.of(Number.NaN)], sampleRate: 48_000, transform: {},
	}), /non-finite sample/);
	assert.throws(() => normalizeStaffPadRenderRequest({
		channels: mono, sampleRate: 48_000, transform: {}, outputFrames: 99,
	}), /must equal the StaffPad transform length \(100\)/);
	assert.throws(() => normalizeStaffPadRenderRequest({
		channels: mono, sampleRate: 7999, transform: {},
	}), /between 8000 and 192000/);
});

test('StaffPad cache keys are canonical and cover source identity, range, direction, and transform', async () => {
	const request = {
		channels: [new Float32Array(32)],
		sampleRate: 48_000,
		selection: { startFrame: 4, frameCount: 16 },
		transform: createStaffPadChangePitchTransform({ cents: 200 }),
	};
	const sourceA = { assetId: 'asset-1', revision: 7, direction: 'forward', etag: null };
	const sourceReordered = { direction: 'forward', etag: null, revision: 7, assetId: 'asset-1' };
	const key = await staffPadRenderCacheKey(request, sourceA);
	assert.match(key, new RegExp(`^${STAFFPAD_ALGORITHM_ID}:[0-9a-f]{64}$`));
	assert.equal(key, await staffPadRenderCacheKey(request, sourceReordered));
	assert.notEqual(key, await staffPadRenderCacheKey(request, { ...sourceA, revision: 8 }));
	assert.notEqual(key, await staffPadRenderCacheKey(request, { ...sourceA, direction: 'reverse' }));
	assert.notEqual(key, await staffPadRenderCacheKey({
		...request,
		transform: createStaffPadChangePitchTransform({ cents: 201 }),
	}, sourceA));

	const descriptor = createStaffPadCacheDescriptor(request, sourceA);
	assert.equal(descriptor.range.startFrame, 4);
	assert.equal(descriptor.range.frameCount, 16);
	assert.equal(descriptor.channelCount, 1);
	assert.equal(descriptor.version.includes(STAFFPAD_AUDACITY_REVISION), true);
});

test('the pinned scalar StaffPad WASM performs deterministic real pitch shifting', async () => {
	const audit = await auditStaffPadWasm();
	assert.deepEqual(audit.findings, []);
	assert.equal(audit.ok, true);
	assert.equal(audit.wasmSha256, STAFFPAD_NATIVE_GOLDEN.wasmSha256);

	const sampleRate = 8_000;
	const frameCount = 8_000;
	const input = new Float32Array(frameCount);
	for (let frame = 0; frame < frameCount; frame += 1) {
		input[frame] = 0.3 * Math.sin(2 * Math.PI * 220 * frame / sampleRate);
	}
	const runtime = await loadStaffPadWasm(await readFile(WASM_PATH));
	const transform = createStaffPadChangePitchTransform({ cents: 1200, preserveFormants: false });
	const first = await collectRender(runtime, { channels: [input], sampleRate, transform });
	const second = await collectRender(runtime, { channels: [input], sampleRate, transform });
	assert.equal(first.length, frameCount);
	assert.deepEqual(first, second, 'StaffPad keeps its seeded imaging reduction deterministic');
	assert.ok(first.every(Number.isFinite));
	assert.ok(Math.max(...first) > 0.1);

	let positiveCrossings = 0;
	for (let frame = 2_001; frame < 7_000; frame += 1) {
		if (first[frame - 1] <= 0 && first[frame] > 0) positiveCrossings += 1;
	}
	const measuredHz = positiveCrossings / (4_999 / sampleRate);
	assert.ok(measuredHz > 430 && measuredHz < 450, `expected roughly 440 Hz, measured ${measuredHz}`);
});

test('the pinned scalar StaffPad WASM matches the compact native golden matrix', async () => {
	const runtime = await loadStaffPadWasm(await readFile(WASM_PATH));
	const actual = {};
	for (const fixture of staffPadGoldenCases()) {
		const first = await collectPlanarRender(runtime, fixture.request);
		const second = await collectPlanarRender(runtime, {
			...fixture.request,
			chunkFrames: fixture.request.chunkFrames === 1_024 ? 4_096 : 1_024,
		});
		assert.deepEqual(first.channels, second.channels, `${fixture.id} is independent of transfer chunk size`);
		assert.equal(first.metadata.frameCount, fixture.expectedFrames, `${fixture.id} exact length`);
		assert.equal(first.metadata.channelCount, fixture.request.channels.length, `${fixture.id} channels`);
		let contiguousFrame = 0;
		for (const chunk of first.chunks) {
			assert.equal(chunk.frameOffset, contiguousFrame, `${fixture.id} chunks remain contiguous`);
			contiguousFrame = chunk.endFrame;
		}
		assert.equal(contiguousFrame, fixture.expectedFrames, `${fixture.id} has no latency padding`);
		assert.deepEqual(first.progress.at(0), 0, `${fixture.id} begins at zero progress`);
		assert.deepEqual(first.progress.at(-1), 1, `${fixture.id} completes progress`);
		for (let index = 1; index < first.progress.length; index += 1) {
			assert.ok(first.progress[index] >= first.progress[index - 1], `${fixture.id} progress is monotonic`);
		}
		actual[fixture.id] = summarizeStaffPadRender(runtime, fixture, first.channels);
	}
	if (process.env.UPDATE_STAFFPAD_GOLDEN === '1') {
		process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
	}
	assert.deepEqual(actual, STAFFPAD_NATIVE_GOLDEN.cases);
	assert.equal(STAFFPAD_NATIVE_GOLDEN.audacityRevision, STAFFPAD_AUDACITY_REVISION);
	for (const [id, reference] of Object.entries(STAFFPAD_NATIVE_GOLDEN.nativeReference.cases)) {
		assert.equal(actual[id].latencyFrames, reference.latencyFrames, `${id} native latency`);
		assert.ok(
			Math.abs(actual[id].rms - reference.rms) <= STAFFPAD_NATIVE_GOLDEN.nativeReference.maximumRmsError,
			`${id} RMS remains within the native scalar reference tolerance`,
		);
	}

	assert.notEqual(actual.pitchUpNoFormants.pcmSha256, actual.pitchUpFormants.pcmSha256);
	assert.notEqual(actual.pitchUpNoFormants.pcmSha256, actual.reversedInput.pcmSha256);
	assert.equal(actual.silence.nonZeroFrames, 0);
	assert.ok(actual.sliding.maxAdjacentDelta < 0.15, 'sliding parameters remain continuous at StaffPad hop boundaries');
});

test('real StaffPad cancellation destroys the session and leaves the long-lived runtime reusable', async () => {
	const runtime = await loadStaffPadWasm(await readFile(WASM_PATH));
	const fixture = staffPadGoldenCases().find(({ id }) => id === 'slowBoundaryStereo');
	let cancellationChecks = 0;
	await assert.rejects(
		renderStaffPad(fixture.request, runtime, {
			isCancelled() {
				cancellationChecks += 1;
				return cancellationChecks === 5;
			},
		}),
		(error) => error.name === 'AbortError' && /cancelled/i.test(error.message),
	);
	assert.ok(cancellationChecks >= 5);
	const recovered = await collectPlanarRender(runtime, fixture.request);
	assert.equal(
		summarizeStaffPadRender(runtime, fixture, recovered.channels).pcmSha256,
		STAFFPAD_NATIVE_GOLDEN.cases.slowBoundaryStereo.pcmSha256,
	);
});

test('Audacity dispatcher routes all four pitch-and-tempo effects through StaffPad and fails closed', async () => {
	const runtime = await loadStaffPadWasm(await readFile(WASM_PATH));
	const sampleRate = 8_000;
	const input = Float32Array.from({ length: 4_000 }, (_, frame) => (
		0.2 * Math.sin(2 * Math.PI * 220 * frame / sampleRate)
	));
	const cases = [
		['audacity-change-pitch', { semitones: 5, preserveFormants: false }, 4_000],
		['audacity-change-tempo', { tempoPercent: -50 }, 8_000],
		['audacity-change-speed-pitch', { speedPercent: 100 }, 2_000],
		['audacity-sliding-stretch', {
			startTempoPercent: -50,
			endTempoPercent: 100,
			startPitchSemitones: -2,
			endPitchSemitones: 2,
			preserveFormants: true,
		}, 3_200],
	];
	for (const [type, params, expectedFrames] of cases) {
		assert.equal(estimateAudacityEffectOutputFrames(type, input.length, params), expectedFrames);
		const output = await applyAudacityEffectAsync(type, [input], sampleRate, params, {
			staffPadRuntime: runtime,
			beforeChannels: [new Float32Array(128)],
			afterChannels: [new Float32Array(128)],
		});
		assert.equal(output[0].length, expectedFrames, type);
		assert.ok(output[0].every(Number.isFinite), type);
		assert.ok(Math.max(...output[0]) > 0.01, type);
	}

	assert.throws(
		() => applyAudacityEffect('audacity-change-pitch', [input], sampleRate, { semitones: 1 }),
		(error) => error instanceof AudacityStaffPadError && error.code === 'STAFFPAD_ASYNC_REQUIRED',
	);
	await assert.rejects(
		applyAudacityEffectAsync('audacity-change-pitch', [input], sampleRate, { semitones: 1 }, {
			staffPadWasmSource: Uint8Array.of(0, 1, 2, 3),
		}),
		(error) => error instanceof AudacityStaffPadError
			&& error.code === 'STAFFPAD_WASM_UNAVAILABLE'
			&& error.message === 'StaffPad WebAssembly is unavailable; the effect was not applied.',
	);
});

test('StaffPad worker client assembles contiguous chunks, reports progress, and cancels', async () => {
	const worker = new FakeWorker();
	const client = new StaffPadRenderClient({ workerFactory: () => worker, wasmUrl: '/staffpad.wasm' });
	try {
		const progress = [];
		const rendering = client.render({
			channels: [Float32Array.from([1, 2, 3, 4])],
			sampleRate: 8_000,
			transform: {},
		}, { cacheKey: 'cache-1', onProgress: (value) => progress.push(value) });
		const renderMessage = worker.messages.at(-1).message;
		assert.equal(renderMessage.type, 'render');
		assert.equal(renderMessage.wasmUrl, '/staffpad.wasm');
		worker.emit({ type: 'progress', id: renderMessage.id, progress: 0.5 });
		worker.emit({ type: 'chunk', id: renderMessage.id, frameOffset: 0, channels: [Float32Array.from([1, 2])] });
		worker.emit({ type: 'chunk', id: renderMessage.id, frameOffset: 2, channels: [Float32Array.from([3, 4])] });
		worker.emit({
			type: 'result', id: renderMessage.id,
			metadata: { frameCount: 4, sampleRate: 8_000, channelCount: 1, passThrough: true },
			cacheKey: 'cache-1',
		});
		const result = await rendering;
		assert.deepEqual(Array.from(result.channels[0]), [1, 2, 3, 4]);
		assert.equal(result.cacheKey, 'cache-1');
		assert.deepEqual(progress, [0.5]);

		const controller = new AbortController();
		const cancelled = client.render({
			channels: [new Float32Array(4)], sampleRate: 8_000, transform: {},
		}, { signal: controller.signal });
		const cancelledId = worker.messages.at(-1).message.id;
		controller.abort();
		await assert.rejects(cancelled, (error) => error.name === 'AbortError');
		assert.deepEqual(worker.messages.at(-1).message, { type: 'cancel', id: cancelledId });
	} finally {
		client.dispose();
	}
	assert.equal(worker.terminated, true);
});

async function collectRender(runtime, request) {
	const chunks = [];
	await renderStaffPad(request, runtime, {
		onChunk(channels) { chunks.push(channels[0]); },
	});
	const result = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

async function collectPlanarRender(runtime, request) {
	const channelChunks = request.channels.map(() => []);
	const chunks = [];
	const progress = [];
	const metadata = await renderStaffPad(request, runtime, {
		onChunk(channels, frameOffset) {
			for (let channel = 0; channel < channels.length; channel += 1) {
				channelChunks[channel].push(channels[channel]);
			}
			chunks.push({ frameOffset, endFrame: frameOffset + channels[0].length });
		},
		onProgress(value) { progress.push(value); },
	});
	const channels = channelChunks.map((parts) => {
		const output = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
		let offset = 0;
		for (const part of parts) {
			output.set(part, offset);
			offset += part.length;
		}
		return output;
	});
	return { channels, chunks, metadata, progress };
}

function staffPadGoldenCases() {
	const mono = createIntegerProgram(4_096, 1, 0x13579bdf);
	const stereo = createIntegerProgram(4_096, 2, 0x2468ace0);
	const short = createIntegerProgram(31, 1, 0x10203040);
	const selectionProgram = createIntegerProgram(3_072, 1, 0xabcdef01);
	const smooth = createIntegerSmoothProgram(4_096);
	return [
		{
			id: 'pitchDownFormants',
			request: {
				channels: mono,
				sampleRate: 8_000,
				transform: createStaffPadChangePitchTransform({ cents: -1_200, preserveFormants: true }),
				chunkFrames: 1_024,
			},
			expectedFrames: 4_096,
		},
		{
			id: 'pitchUpNoFormants',
			request: {
				channels: mono,
				sampleRate: 8_000,
				transform: createStaffPadChangePitchTransform({ cents: 1_200, preserveFormants: false }),
				chunkFrames: 1_024,
			},
			expectedFrames: 4_096,
		},
		{
			id: 'pitchUpFormants',
			request: {
				channels: mono,
				sampleRate: 8_000,
				transform: createStaffPadChangePitchTransform({ cents: 1_200, preserveFormants: true }),
				chunkFrames: 1_024,
			},
			expectedFrames: 4_096,
		},
		{
			id: 'fastBoundaryStereo',
			request: {
				channels: stereo,
				sampleRate: 8_000,
				transform: normalizeStaffPadTransform({ timeRatio: 0.5, pitchRatio: 1, preserveFormants: false }),
				chunkFrames: 1_024,
			},
			expectedFrames: 2_048,
		},
		{
			id: 'slowBoundaryStereo',
			request: {
				channels: stereo,
				sampleRate: 8_000,
				transform: normalizeStaffPadTransform({ timeRatio: 2, pitchRatio: 1, preserveFormants: false }),
				chunkFrames: 1_024,
			},
			expectedFrames: 8_192,
		},
		{
			id: 'silence',
			request: {
				channels: [new Float32Array(257)],
				sampleRate: 8_000,
				transform: createStaffPadChangePitchTransform({ cents: 700, preserveFormants: true }),
				chunkFrames: 1_024,
			},
			expectedFrames: 257,
		},
		{
			id: 'shortInput',
			request: {
				channels: short,
				sampleRate: 8_000,
				transform: createStaffPadChangePitchTransform({ cents: -700, preserveFormants: false }),
				chunkFrames: 1_024,
			},
			expectedFrames: 31,
		},
		{
			id: 'reversedInput',
			request: {
				channels: mono.map((channel) => channel.slice().reverse()),
				sampleRate: 8_000,
				transform: createStaffPadChangePitchTransform({ cents: 1_200, preserveFormants: false }),
				chunkFrames: 1_024,
			},
			expectedFrames: 4_096,
		},
		{
			id: 'selectionWithContext',
			request: {
				channels: selectionProgram,
				sampleRate: 8_000,
				selection: { startFrame: 512, frameCount: 2_048 },
				transform: normalizeStaffPadTransform({ timeRatio: 2, pitchRatio: 0.5, preserveFormants: false }),
				chunkFrames: 1_024,
			},
			expectedFrames: 4_096,
		},
		{
			id: 'sliding',
			request: {
				channels: [smooth],
				sampleRate: 8_000,
				transform: createStaffPadSlidingStretchTransform({
					startTempoPercent: -50,
					endTempoPercent: 100,
					startPitchCents: -1_200,
					endPitchCents: 1_200,
					preserveFormants: true,
				}),
				chunkFrames: 1_024,
			},
			expectedFrames: 3_277,
		},
	];
}

function createIntegerSmoothProgram(frameCount) {
	const output = new Float32Array(frameCount);
	for (let frame = 0; frame < frameCount; frame += 1) {
		const phaseA = frame % 128;
		const phaseB = frame % 94;
		const triangleA = phaseA < 64 ? phaseA / 32 - 1 : 3 - phaseA / 32;
		const triangleB = phaseB < 47 ? phaseB / 23.5 - 1 : 3 - phaseB / 23.5;
		output[frame] = triangleA * 0.2 + triangleB * 0.08;
	}
	return output;
}

function createIntegerProgram(frameCount, channelCount, seed) {
	return Array.from({ length: channelCount }, (_, channel) => {
		const output = new Float32Array(frameCount);
		let state = (seed + Math.imul(channel + 1, 0x9e3779b1)) >>> 0;
		for (let frame = 0; frame < frameCount; frame += 1) {
			state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
			const noise = ((state >>> 16) - 32_768) / 262_144;
			const ramp = (((Math.imul(frame, 37 + channel * 12) + channel * 43) & 255) - 128) / 512;
			const pulse = frame % (257 + channel * 46) === 0 ? 0.35 : 0;
			output[frame] = noise + ramp + pulse;
		}
		return output;
	});
}

function summarizeStaffPadRender(runtime, fixture, channels) {
	const canonical = new Uint8Array(channels.reduce((sum, channel) => sum + channel.length * 4, 0));
	const view = new DataView(canonical.buffer);
	let byteOffset = 0;
	let peak = 0;
	let squareSum = 0;
	let maxAdjacentDelta = 0;
	let nonZeroFrames = 0;
	for (const channel of channels) {
		for (let frame = 0; frame < channel.length; frame += 1) {
			const sample = channel[frame];
			view.setFloat32(byteOffset, sample, true);
			byteOffset += 4;
			peak = Math.max(peak, Math.abs(sample));
			squareSum += sample * sample;
			if (sample !== 0) nonZeroFrames += 1;
			if (frame > 0) maxAdjacentDelta = Math.max(maxAdjacentDelta, Math.abs(sample - channel[frame - 1]));
		}
	}
	const parameters = evaluateStaffPadTransform(fixture.request.transform, 0);
	const session = runtime.createSession(
		fixture.request.sampleRate,
		fixture.request.channels.length,
		fixture.request.transform.preserveFormants,
	);
	let latencyFrames;
	try {
		session.setParameters(parameters.timeRatio, parameters.pitchRatio);
		latencyFrames = session.latency(parameters.timeRatio * parameters.pitchRatio);
	} finally {
		session.destroy();
	}
	return {
		frameCount: channels[0].length,
		channelCount: channels.length,
		latencyFrames,
		pcmSha256: createHash('sha256').update(canonical).digest('hex'),
		peak: rounded(peak),
		rms: rounded(Math.sqrt(squareSum / (channels[0].length * channels.length))),
		maxAdjacentDelta: rounded(maxAdjacentDelta),
		nonZeroFrames,
	};
}

function rounded(value) {
	return Math.round(value * 1e9) / 1e9;
}

class FakeWorker {
	constructor() {
		this.listeners = new Map();
		this.messages = [];
		this.terminated = false;
	}
	addEventListener(type, listener) { this.listeners.set(type, listener); }
	postMessage(message, transfer = []) { this.messages.push({ message, transfer }); }
	emit(data) { this.listeners.get('message')?.({ data }); }
	terminate() { this.terminated = true; }
}
