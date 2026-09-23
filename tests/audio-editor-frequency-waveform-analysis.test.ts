/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	FREQUENCY_WAVEFORM_ANALYSIS_VERSION,
	FREQUENCY_WAVEFORM_CACHE_PREFIX,
	FREQUENCY_WAVEFORM_HOP_SIZE,
	FREQUENCY_WAVEFORM_MAX_SOURCE_BYTES,
	frequencyWaveformAnalysisByteLength,
	frequencyWaveformBlockSizes,
	frequencyWaveformCacheKey,
	frequencyWaveformCentroidColor,
	selectFrequencyWaveformLevel,
	validateFrequencyWaveformAnalysis,
	validateFrequencyWaveformWindow,
} from '../src/common/editor/frequency-waveform-contract.ts';
import {
	FrequencyWaveformAnalyzer,
	FrequencyWaveformBandSplitter,
	generateFrequencyWaveformAnalysis,
	generateFrequencyWaveformAnalysisWithFft,
	generateFrequencyWaveformWindowWithFft,
} from '../src/common/editor/frequency-waveform-analysis.ts';
import {
	createFrequencyWaveformWorkerProtocol,
	type FrequencyWaveformWorkerRequest,
	type FrequencyWaveformWorkerResponse,
} from '../src/common/editor/frequency-waveform-worker-protocol.ts';
import {
	generateFrequencyWaveformWindowInWorker,
	generateStoredFrequencyWaveformAnalysis,
	generateStoredFrequencyWaveformAnalysisFallback,
} from '../src/common/editor/frequency-waveform-worker-client.ts';
import { fft, initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

const SAMPLE_RATE = 48_000;
const CROSSOVERS = Object.freeze({ lowMidHz: 250, midHighHz: 4_000 });

test('frequency waveform storage uses a versioned bounded adaptive pyramid', () => {
	assert.equal(FREQUENCY_WAVEFORM_ANALYSIS_VERSION, 1);
	assert.equal(FREQUENCY_WAVEFORM_CACHE_PREFIX, 'audio-editor-frequency-waveform-v1:');
	assert.equal(frequencyWaveformCacheKey('source / one'), `${FREQUENCY_WAVEFORM_CACHE_PREFIX}source / one`);
	for (const frameCount of [4_096, 160_083_000, 10_000_000_000, 1_000_000_000_000]) {
		for (const channelCount of [1, 2, 32]) {
			const blockSizes = frequencyWaveformBlockSizes(frameCount, channelCount);
			assert.ok(blockSizes.length > 1);
			assert.ok(blockSizes.every((size, index) => (
				Number.isSafeInteger(size) && size > (blockSizes[index - 1] || 0)
			)));
			assert.ok(
				frequencyWaveformAnalysisByteLength(frameCount, channelCount, blockSizes)
					<= FREQUENCY_WAVEFORM_MAX_SOURCE_BYTES,
			);
		}
	}
});

test('complementary split bands reconstruct samples and retain state across arbitrary chunks', () => {
	const channels = [tone(83, 4_321, 0.7), tone(7_000, 4_321, 0.4, 0.2)];
	const whole = new FrequencyWaveformBandSplitter(SAMPLE_RATE, channels.length, CROSSOVERS).process(channels);
	for (let channel = 0; channel < channels.length; channel += 1) {
		for (let frame = 0; frame < channels[channel]!.length; frame += 1) {
			assert.ok(Math.abs(
				whole.low[channel]![frame]!
				+ whole.mid[channel]![frame]!
				+ whole.high[channel]![frame]!
				- channels[channel]![frame]!
			) < 1e-6);
		}
	}

	const streamedSplitter = new FrequencyWaveformBandSplitter(SAMPLE_RATE, channels.length, CROSSOVERS);
	const streamed = { low: channels.map(() => [] as number[]), mid: channels.map(() => [] as number[]), high: channels.map(() => [] as number[]) };
	for (const [start, end] of [[0, 7], [7, 1_031], [1_031, 2_050], [2_050, 4_321]]) {
		const chunk = streamedSplitter.process(channels.map((channel) => channel.slice(start, end)));
		for (const band of ['low', 'mid', 'high'] as const) {
			for (let channel = 0; channel < channels.length; channel += 1) {
				streamed[band][channel]!.push(...chunk[band][channel]!);
			}
		}
	}
	for (const band of ['low', 'mid', 'high'] as const) {
		for (let channel = 0; channel < channels.length; channel += 1) {
			assert.deepEqual(Float32Array.from(streamed[band][channel]!), whole[band][channel]);
		}
	}
	const lowRateInput = [Float32Array.of(0.25, -0.5, 0.75)];
	const aboveNyquist = new FrequencyWaveformBandSplitter(8_000, 1, {
		lowMidHz: 5_000,
		midHighHz: 10_000,
	}).process(lowRateInput);
	assert.deepEqual(aboveNyquist.low, lowRateInput);
	assert.deepEqual(aboveNyquist.mid, [new Float32Array(3)]);
	assert.deepEqual(aboveNyquist.high, [new Float32Array(3)]);
});

test('three-band pyramid distinguishes bass, mid, and treble tones', async () => {
	for (const [frequency, expectedBand] of [
		[80, 'low'],
		[1_000, 'mid'],
		[8_000, 'high'],
	] as const) {
		const analysis = await generateFrequencyWaveformAnalysis(
			[tone(frequency, 16_384, 0.8)], SAMPLE_RATE, { crossovers: CROSSOVERS },
		);
		const level = analysis.levels[0]!;
		const bandPeaks = Object.fromEntries((['low', 'mid', 'high'] as const).map((band) => [
			band,
			maximumAbsolute(level.bands[band][0]!.minimums, level.bands[band][0]!.maximums, 2),
		]));
		const otherPeak = Math.max(...Object.entries(bandPeaks)
			.filter(([band]) => band !== expectedBand).map(([, peak]) => peak));
		assert.ok(bandPeaks[expectedBand]! > otherPeak, `${frequency} Hz should emphasize ${expectedBand}`);
	}
});

test('frequency analysis accepts the full persisted source sample-rate range', async () => {
	for (const sampleRate of [1, 6_000, 768_000]) {
		const generated = await generateFrequencyWaveformAnalysis(
			[Float32Array.of(0.25, -0.25, 0.5, -0.5)],
			sampleRate,
			{ crossovers: CROSSOVERS },
		);
		assert.equal(generated.sampleRate, sampleRate);
		assert.equal(validateFrequencyWaveformAnalysis(generated), generated);
	}
	for (const sampleRate of [0, 1.5, 768_001]) {
		await assert.rejects(
			generateFrequencyWaveformAnalysis([new Float32Array(4)], sampleRate),
			/sample rate.*1.*768000/iu,
		);
	}
});

test('rainbow centroid uses centered Hann FFTs and combines stereo magnitudes without phase cancellation', async () => {
	const lowFrequency = 750;
	const highFrequency = 6_000;
	const mono = await generateFrequencyWaveformAnalysis(
		[tone(lowFrequency, 16_384, 0.7)], SAMPLE_RATE, { crossovers: CROSSOVERS },
	);
	assert.ok(Math.abs(interiorCentroid(mono.levels[0]!, 4) - lowFrequency) < 10);
	const phaseOpposed = await generateFrequencyWaveformAnalysis([
		tone(lowFrequency, 16_384, 0.7),
		tone(lowFrequency, 16_384, 0.7, Math.PI),
	], SAMPLE_RATE, { crossovers: CROSSOVERS });
	assert.ok(Math.abs(interiorCentroid(phaseOpposed.levels[0]!, 4) - lowFrequency) < 10);
	assert.ok(totalCentroidWeight(phaseOpposed.levels[0]!) > totalCentroidWeight(mono.levels[0]!) * 1.9);

	const stereo = await generateFrequencyWaveformAnalysis([
		tone(lowFrequency, 16_384, 0.7),
		tone(highFrequency, 16_384, 0.7, Math.PI),
	], SAMPLE_RATE, { crossovers: CROSSOVERS });
	assert.ok(Math.abs(interiorCentroid(stereo.levels[0]!, 4) - (lowFrequency + highFrequency) / 2) < 20);
	assert.equal(stereo.levels[0]!.centroid.weights.length,
		Math.ceil(stereo.frameCount / stereo.levels[0]!.blockSize));
});

test('bounded window generation retains pre-roll state and aligned centroid samples', () => {
	const source = tone(1_000, 5_000, 0.75);
	const window = generateFrequencyWaveformWindowWithFft([source], SAMPLE_RATE, {
		crossovers: CROSSOVERS,
		sourceStartFrame: 10_000,
		visibleStartOffset: 1_024,
		visibleFrameCount: 2_000,
	}, fft);
	assert.equal(validateFrequencyWaveformWindow(window), window);
	assert.equal(window.startFrame, 11_024);
	assert.equal(window.frameCount, 2_000);
	assert.equal(window.bands.mid[0]!.length, 2_000);
	assert.equal(window.centroid.firstCenterFrame, 11_008);
	assert.equal(window.centroid.weights.length, 8);
	assert.ok(window.centroid.weights.every((weight) => weight > 0));

	const boundary = generateFrequencyWaveformWindowWithFft([source.subarray(0, 512)], SAMPLE_RATE, {
		crossovers: CROSSOVERS,
		sourceStartFrame: 0,
		visibleStartOffset: 100,
		visibleFrameCount: 4,
	}, fft);
	assert.equal(validateFrequencyWaveformWindow(boundary), boundary);
	assert.equal(boundary.centroid.firstCenterFrame, 0);
	assert.equal(boundary.centroid.weights.length, 1);
	assert.ok(boundary.centroid.weights[0]! > 0);
});

test('bounded rainbow centroids remain on the source-global hop grid while panning', () => {
	const source = tone(1_375, 6_000, 0.65);
	const full = generateFrequencyWaveformAnalysisWithFft(
		[source], SAMPLE_RATE, { crossovers: CROSSOVERS }, fft,
	);
	const first = generateFrequencyWaveformWindowWithFft([source.slice(500, 4_500)], SAMPLE_RATE, {
		crossovers: CROSSOVERS,
		sourceStartFrame: 500,
		visibleStartOffset: 2_000,
		visibleFrameCount: 800,
	}, fft);
	const panned = generateFrequencyWaveformWindowWithFft([source.slice(700, 4_700)], SAMPLE_RATE, {
		crossovers: CROSSOVERS,
		sourceStartFrame: 700,
		visibleStartOffset: 1_800,
		visibleFrameCount: 800,
	}, fft);

	assert.equal(first.centroid.firstCenterFrame, 2_304);
	assert.equal(panned.centroid.firstCenterFrame, first.centroid.firstCenterFrame);
	assert.deepEqual(panned.centroid.numerators, first.centroid.numerators);
	assert.deepEqual(panned.centroid.weights, first.centroid.weights);
	const firstBucket = first.centroid.firstCenterFrame / FREQUENCY_WAVEFORM_HOP_SIZE;
	assert.deepEqual(
		first.centroid.numerators,
		full.levels[0]!.centroid.numerators.slice(
			firstBucket,
			firstBucket + first.centroid.numerators.length,
		),
	);
	assert.deepEqual(
		first.centroid.weights,
		full.levels[0]!.centroid.weights.slice(
			firstBucket,
			firstBucket + first.centroid.weights.length,
		),
	);
});

test('bounded window worker protocol and client preserve visible source geometry', async () => {
	const channels = [tone(1_500, 2_048, 0.6)];
	const options = {
		crossovers: CROSSOVERS,
		sourceStartFrame: 5_000,
		visibleStartOffset: 512,
		visibleFrameCount: 64,
	};
	const expected = generateFrequencyWaveformWindowWithFft(
		channels,
		SAMPLE_RATE,
		options,
		fft,
	);
	const responses: Array<{ readonly type?: string; readonly result?: unknown }> = [];
	const protocol = createFrequencyWaveformWorkerProtocol({
		postMessage(message) { responses.push(message); },
	}, async () => fft);
	await protocol({
		type: 'window',
		channels: channels.map((channel) => channel.slice().buffer),
		sampleRate: SAMPLE_RATE,
		options,
	});
	assert.equal(responses.at(-1)?.type, 'window-result');
	assert.deepEqual(responses.at(-1)?.result, expected);
	assert.deepEqual(
		await generateFrequencyWaveformWindowInWorker(channels, SAMPLE_RATE, options),
		expected,
	);
});

test('frequency workers copy only visual channels while retaining source channel metadata', async () => {
	const channels = [
		tone(300, 2_048, 0.6),
		tone(1_500, 2_048, 0.5),
		tone(4_000, 2_048, 0.4),
		tone(8_000, 2_048, 0.3),
	];
	const direct = generateFrequencyWaveformAnalysisWithFft(
		channels,
		SAMPLE_RATE,
		{ crossovers: CROSSOVERS },
		fft,
	);
	assert.equal(direct.channelCount, channels.length);
	assert.equal(direct.visualChannelCount, 2);
	const transports: FrequencyWorkerTransport[] = [];
	const restoreWorker = installInProcessFrequencyWorker(transports);
	try {
		const analysis = await generateStoredFrequencyWaveformAnalysis({
			async *readSourceChunks() {
				yield { channels, frames: channels[0]!.length };
			},
		}, {
			id: 'surround-source',
			frameCount: channels[0]!.length,
			channelCount: channels.length,
			sampleRate: SAMPLE_RATE,
		}, { crossovers: CROSSOVERS });
		assert.equal(analysis.channelCount, channels.length);
		assert.equal(analysis.visualChannelCount, 2);

		const window = await generateFrequencyWaveformWindowInWorker(channels, SAMPLE_RATE, {
			crossovers: CROSSOVERS,
			sourceStartFrame: 1_024,
			visibleStartOffset: 256,
			visibleFrameCount: 512,
		});
		assert.equal(window.channelCount, channels.length);
		assert.equal(window.visualChannelCount, 2);
	} finally {
		restoreWorker();
	}

	assert.deepEqual(transports.map(({ type, channelCount, transferCount, transferMatches }) => ({
		type,
		channelCount,
		transferCount,
		transferMatches,
	})), [
		{ type: 'chunk', channelCount: 2, transferCount: 2, transferMatches: true },
		{ type: 'window', channelCount: 2, transferCount: 2, transferMatches: true },
	]);
	for (const transport of transports) {
		assert.notEqual(transport.buffers[0], channels[0]!.buffer);
		assert.notEqual(transport.buffers[1], channels[1]!.buffer);
	}
});

test('streaming analyzer and worker protocol exactly match the direct fallback', async () => {
	const channels = [tone(500, 7_111, 0.7), tone(5_000, 7_111, 0.25)];
	const direct = await generateFrequencyWaveformAnalysis(channels, SAMPLE_RATE, { crossovers: CROSSOVERS });
	const analyzer = new FrequencyWaveformAnalyzer({
		channelCount: channels.length,
		crossovers: CROSSOVERS,
		frameCount: channels[0]!.length,
		sampleRate: SAMPLE_RATE,
	}, fft);
	for (const [start, end] of [[0, 13], [13, 2_049], [2_049, 2_305], [2_305, 7_111]]) {
		analyzer.push(channels.map((channel) => channel.slice(start, end)));
	}
	assert.deepEqual(analyzer.finish(), direct);

	const messages: Array<{ readonly type?: string; readonly result?: unknown }> = [];
	const protocol = createFrequencyWaveformWorkerProtocol({
		postMessage(message) { messages.push(message); },
	}, async () => fft);
	await protocol({ type: 'start', options: {
		channelCount: channels.length,
		crossovers: CROSSOVERS,
		frameCount: channels[0]!.length,
		sampleRate: SAMPLE_RATE,
	} });
	assert.equal(messages.at(-1)?.type, 'ready');
	for (const [start, end] of [[0, 2_000], [2_000, 2_257], [2_257, 7_111]]) {
		const pieces = channels.map((channel) => channel.slice(start, end));
		await protocol({ type: 'chunk', channels: pieces.map((channel) => channel.buffer) });
		assert.equal(messages.at(-1)?.type, 'ack');
	}
	await protocol({ type: 'finish' });
	assert.equal(messages.at(-1)?.type, 'result');
	assert.deepEqual(messages.at(-1)?.result, direct);
});

test('stored fallback streams chunks with progress, parity, and cancellation', async () => {
	const channels = [tone(220, 5_000, 0.6), tone(4_800, 5_000, 0.3)];
	const source = { id: 'stored', frameCount: 5_000, channelCount: 2, sampleRate: SAMPLE_RATE };
	const progress: number[] = [];
	const stored = await generateStoredFrequencyWaveformAnalysisFallback({ async *readSourceChunks() {
		for (const [start, end] of [[0, 17], [17, 2_111], [2_111, 5_000]]) {
			yield { channels: channels.map((channel) => channel.subarray(start, end)), frames: end - start };
		}
	} }, source, { crossovers: CROSSOVERS, onProgress(value) { progress.push(value); } });
	assert.deepEqual(stored, await generateFrequencyWaveformAnalysis(channels, SAMPLE_RATE, { crossovers: CROSSOVERS }));
	assert.deepEqual(progress, [17 / 5_000, 2_111 / 5_000, 1]);

	const controller = new AbortController();
	const pulled: number[] = [];
	await assert.rejects(generateStoredFrequencyWaveformAnalysisFallback({ async *readSourceChunks(_sourceId, options) {
		assert.equal(options?.signal, controller.signal);
		for (const [start, end] of [[0, 100], [100, 200]]) {
			pulled.push(start);
			yield { channels: channels.map((channel) => channel.subarray(start, end)), frames: end - start };
		}
	} }, { ...source, frameCount: 200 }, {
		crossovers: CROSSOVERS,
		signal: controller.signal,
		onProgress() { controller.abort(); },
	}), { name: 'AbortError' });
	assert.deepEqual(pulled, [0]);
});

test('contract validation, level selection, and Freesound palette mapping are deterministic', async () => {
	const analysis = await generateFrequencyWaveformAnalysis(
		[tone(1_500, 4_096, 0.5)], SAMPLE_RATE, { crossovers: CROSSOVERS },
	);
	assert.equal(validateFrequencyWaveformAnalysis(analysis), analysis);
	assert.throws(() => validateFrequencyWaveformAnalysis({ ...analysis, version: 0 }), /version 1/);
	assert.throws(() => validateFrequencyWaveformAnalysis({
		...analysis,
		levels: [{ ...analysis.levels[0], blockSize: 3 }],
	}), /pyramid/);
	assert.equal(selectFrequencyWaveformLevel(analysis.levels, 1), analysis.levels[0]);
	assert.equal(selectFrequencyWaveformLevel(analysis.levels, analysis.levels[2]!.blockSize), analysis.levels[2]);

	const maximum = 22_050;
	const oneThird = Math.exp(Math.log(100) + (Math.log(maximum) - Math.log(100)) / 3);
	const twoThirds = Math.exp(Math.log(100) + 2 * (Math.log(maximum) - Math.log(100)) / 3);
	assert.equal(frequencyWaveformCentroidColor(0, 0, SAMPLE_RATE), 'rgb(50, 50, 50)');
	assert.equal(frequencyWaveformCentroidColor(100, 1, SAMPLE_RATE), 'rgb(50, 0, 200)');
	assert.equal(frequencyWaveformCentroidColor(oneThird, 1, SAMPLE_RATE), 'rgb(0, 220, 80)');
	assert.equal(frequencyWaveformCentroidColor(twoThirds, 1, SAMPLE_RATE), 'rgb(255, 224, 0)');
	assert.equal(frequencyWaveformCentroidColor(maximum, 1, SAMPLE_RATE), 'rgb(255, 70, 0)');
	assert.equal(
		frequencyWaveformCentroidColor(4_000, 1, 8_000),
		frequencyWaveformCentroidColor(4_000, 1, SAMPLE_RATE),
		'Freesound keeps one fixed 100–22,050 Hz color scale across source sample rates',
	);
});

function tone(frequency: number, frameCount: number, amplitude: number, phase = 0): Float32Array {
	return Float32Array.from({ length: frameCount }, (_, frame) => (
		amplitude * Math.sin(2 * Math.PI * frequency * frame / SAMPLE_RATE + phase)
	));
}

function totalCentroidWeight(level: Readonly<{
	readonly centroid: Readonly<{ readonly weights: Float32Array }>;
}>): number {
	return level.centroid.weights.reduce((sum, weight) => sum + weight, 0);
}

function maximumAbsolute(minimums: Float32Array, maximums: Float32Array, skip: number): number {
	let maximum = 0;
	for (let index = skip; index < minimums.length; index += 1) {
		maximum = Math.max(maximum, Math.abs(minimums[index]!), Math.abs(maximums[index]!));
	}
	return maximum;
}

function interiorCentroid(level: Readonly<{
	readonly centroid: Readonly<{ readonly numerators: Float32Array; readonly weights: Float32Array }>;
}>, skip: number): number {
	let numerator = 0;
	let weight = 0;
	for (let index = skip; index < level.centroid.weights.length - skip; index += 1) {
		numerator += level.centroid.numerators[index]!;
		weight += level.centroid.weights[index]!;
	}
	return numerator / weight;
}

interface FrequencyWorkerTransport {
	readonly type: 'chunk' | 'window';
	readonly channelCount: number;
	readonly transferCount: number;
	readonly transferMatches: boolean;
	readonly buffers: readonly ArrayBuffer[];
}

function installInProcessFrequencyWorker(transports: FrequencyWorkerTransport[]): () => void {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	class InProcessFrequencyWorker {
		onmessage: ((event: MessageEvent<FrequencyWaveformWorkerResponse>) => void) | null = null;
		onerror: ((event: ErrorEvent) => void) | null = null;
		onmessageerror: ((event: MessageEvent) => void) | null = null;
		private readonly handle: (request: FrequencyWaveformWorkerRequest) => Promise<void>;

		constructor() {
			this.handle = createFrequencyWaveformWorkerProtocol({
				postMessage: (message) => {
					globalThis.queueMicrotask(() => this.onmessage?.({ data: message } as MessageEvent<FrequencyWaveformWorkerResponse>));
				},
			}, async () => fft);
		}

		postMessage(message: FrequencyWaveformWorkerRequest, transfer: Transferable[] = []): void {
			if (message.type === 'chunk' || message.type === 'window') {
				transports.push({
					type: message.type,
					channelCount: message.channels.length,
					transferCount: transfer.length,
					transferMatches: transfer.every((value, index) => value === message.channels[index]),
					buffers: message.channels,
				});
			}
			void this.handle(message).catch((error: unknown) => {
				globalThis.queueMicrotask(() => this.onerror?.({
					error,
					message: error instanceof Error ? error.message : String(error),
				} as ErrorEvent));
			});
		}

		terminate(): void {}
	}
	Object.defineProperty(globalThis, 'Worker', {
		configurable: true,
		writable: true,
		value: InProcessFrequencyWorker,
	});
	return () => {
		if (previous) Object.defineProperty(globalThis, 'Worker', previous);
		else Reflect.deleteProperty(globalThis, 'Worker');
	};
}
