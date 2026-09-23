/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFrequencyWaveformWindowService,
	frequencyWaveformWindowPaddingFrames,
} from '../src/common/editor/controller/source/frequency-waveform-window-service.ts';
import {
	FREQUENCY_WAVEFORM_ANALYSIS_VERSION,
	FREQUENCY_WAVEFORM_FFT_SIZE,
	FREQUENCY_WAVEFORM_HOP_SIZE,
	type FrequencyWaveformWindow,
} from '../src/common/editor/frequency-waveform-contract.ts';
import {
	FrequencyWaveformBandSplitter,
	generateFrequencyWaveformAnalysisWithFft,
	generateFrequencyWaveformWindowWithFft,
} from '../src/common/editor/frequency-waveform-analysis.ts';
import { fft, initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

const SOURCE = Object.freeze({
	id: 'source', kind: 'audio', storageKey: 'stored-source', frameCount: 10_000,
	channelCount: 1, sampleRate: 48_000,
});
const CLIP = Object.freeze({ id: 'clip', sourceId: SOURCE.id, kind: 'audio', durationFrames: 1_000 });
const OPTIONS = Object.freeze({
	startFrame: 100,
	endFrame: 108,
	lowMidCrossoverHz: 250,
	midHighCrossoverHz: 4_000,
});
const PADDING_FRAMES = frequencyWaveformWindowPaddingFrames(SOURCE.sampleRate, {
	lowMidHz: 250,
	midHighHz: 4_000,
});

test('frequency waveform windows reuse padded PCM and publish only the visible source range', async () => {
	const fixture = createFixture();
	const first = fixture.service.requestFrequencyWaveformWindow(CLIP.id, OPTIONS);
	const second = fixture.service.requestFrequencyWaveformWindow(CLIP.id, OPTIONS);

	const resolved = await first;
	assert.equal(await second, resolved);
	assert.deepEqual(fixture.pcmRequests, [{
		clipId: CLIP.id,
		options: { startFrame: 100, endFrame: 108, sourcePaddingFrames: PADDING_FRAMES },
	}]);
	assert.equal(fixture.generateCalls.length, 1);
	assert.equal(fixture.generateCalls[0]?.sourceStartFrame, 2_000);
	assert.equal(fixture.generateCalls[0]?.visibleStartOffset, PADDING_FRAMES);
	assert.equal(fixture.generateCalls[0]?.visibleFrameCount, 8);
	assert.equal(fixture.windows.get(CLIP.id)?.window, resolved);
	assert.equal(fixture.publishes(), 1);
});

test('window padding covers worst-case supported low-crossover settling and FFT context', () => {
	assert.ok(PADDING_FRAMES >= FREQUENCY_WAVEFORM_FFT_SIZE / 2 + FREQUENCY_WAVEFORM_HOP_SIZE - 1);
	const worstCase = frequencyWaveformWindowPaddingFrames(768_000, {
		lowMidHz: 20,
		midHighHz: 4_000,
	});
	assert.ok(worstCase >= 56_000);
	assert.ok(worstCase <= 65_536);
});

test('48 kHz service padding keeps panned centroids equal to full-source analysis', () => {
	const crossovers = { lowMidHz: 250, midHighHz: 4_000 };
	const padding = frequencyWaveformWindowPaddingFrames(48_000, crossovers);
	const source = Float32Array.from({ length: 8_000 }, (_, frame) => (
		0.6 * Math.sin(2 * Math.PI * (900 + frame / 20) * frame / 48_000)
	));
	const full = generateFrequencyWaveformAnalysisWithFft(
		[source], 48_000, { crossovers }, fft,
	);
	const serviceWindow = (visibleStartFrame: number) => {
		const visibleFrameCount = 600;
		const sourceStartFrame = visibleStartFrame - padding;
		const channels = [source.slice(
			sourceStartFrame,
			visibleStartFrame + visibleFrameCount + padding,
		)];
		return generateFrequencyWaveformWindowWithFft(channels, 48_000, {
			crossovers,
			sourceStartFrame,
			visibleStartOffset: padding,
			visibleFrameCount,
		}, fft);
	};
	const edgeAligned = serviceWindow(4_095);
	const panned = serviceWindow(4_096);
	const firstBucket = edgeAligned.centroid.firstCenterFrame / FREQUENCY_WAVEFORM_HOP_SIZE;

	assert.equal(padding, FREQUENCY_WAVEFORM_FFT_SIZE / 2 + FREQUENCY_WAVEFORM_HOP_SIZE - 1);
	assert.deepEqual(edgeAligned.centroid.numerators.slice(1), panned.centroid.numerators);
	assert.deepEqual(edgeAligned.centroid.weights.slice(1), panned.centroid.weights);
	assert.deepEqual(edgeAligned.centroid.numerators, full.levels[0]!.centroid.numerators.slice(
		firstBucket,
		firstBucket + edgeAligned.centroid.numerators.length,
	));
	assert.deepEqual(edgeAligned.centroid.weights, full.levels[0]!.centroid.weights.slice(
		firstBucket,
		firstBucket + edgeAligned.centroid.weights.length,
	));
});

test('worst-case padding settles a 20 Hz split to continuous-source parity', () => {
	const sampleRate = 768_000;
	const crossovers = { lowMidHz: 20, midHighHz: 4_000 };
	const padding = frequencyWaveformWindowPaddingFrames(sampleRate, crossovers);
	const contextStart = padding;
	const visibleStart = contextStart + padding;
	const visibleFrames = 64;
	const source = new Float32Array(visibleStart + visibleFrames).fill(1);
	const continuous = new FrequencyWaveformBandSplitter(sampleRate, 1, crossovers).process([source]);
	const bounded = new FrequencyWaveformBandSplitter(sampleRate, 1, crossovers).process([
		source.slice(contextStart),
	]);
	for (const band of ['low', 'mid', 'high'] as const) {
		for (let frame = 0; frame < visibleFrames; frame += 1) {
			assert.ok(Math.abs(
				continuous[band][0]![visibleStart + frame]!
					- bounded[band][0]![padding + frame]!
			) <= 2e-4, `${band} split retained too much reset transient`);
		}
	}
});

test('superseding a frequency waveform window aborts stale generation', async () => {
	const fixture = createFixture({ holdFirstGeneration: true });
	const first = fixture.service.requestFrequencyWaveformWindow(CLIP.id, OPTIONS);
	await fixture.firstGenerationStarted;
	const second = fixture.service.requestFrequencyWaveformWindow(CLIP.id, {
		...OPTIONS,
		startFrame: 110,
		endFrame: 118,
	});

	assert.equal(fixture.firstSignal()?.aborted, true);
	assert.equal(await first, null);
	assert.ok(await second);
	assert.equal(fixture.windows.get(CLIP.id)?.requestStartFrame, 110);
	assert.equal(fixture.windows.size, 1);
});

test('superseding a frequency waveform window aborts its stored PCM read', async () => {
	const fixture = createFixture({ holdFirstPcmRead: true });
	const first = fixture.service.requestFrequencyWaveformWindow(CLIP.id, OPTIONS);
	await fixture.firstPcmReadStarted;
	const second = fixture.service.requestFrequencyWaveformWindow(CLIP.id, {
		...OPTIONS,
		startFrame: 110,
		endFrame: 118,
	});

	assert.equal(fixture.firstPcmSignal()?.aborted, true);
	assert.equal(await first, null);
	assert.ok(await second);
});

test('source invalidation aborts a pending stored PCM read', async () => {
	const fixture = createFixture({ holdFirstPcmRead: true });
	const pending = fixture.service.requestFrequencyWaveformWindow(CLIP.id, OPTIONS);
	await fixture.firstPcmReadStarted;
	await fixture.service.invalidateSource(SOURCE.id);

	assert.equal(fixture.firstPcmSignal()?.aborted, true);
	assert.equal(await pending, null);
});

test('source invalidation clears bounded frequency windows and aborts their work', async () => {
	const fixture = createFixture();
	await fixture.service.requestFrequencyWaveformWindow(CLIP.id, OPTIONS);
	await fixture.service.invalidateSource(SOURCE.id);
	assert.equal(fixture.windows.size, 0);
	assert.equal(fixture.publishes(), 2);

	await fixture.service.requestFrequencyWaveformWindow(CLIP.id, OPTIONS);
	fixture.service.clearRuntime();
	assert.equal(fixture.windows.size, 0);
});

test('clip source remapping cannot reuse a resident window for the old projection', async () => {
	const fixture = createFixture();
	await fixture.service.requestFrequencyWaveformWindow(CLIP.id, OPTIONS);
	fixture.remapClip(500);
	await fixture.service.requestFrequencyWaveformWindow(CLIP.id, OPTIONS);

	assert.equal(fixture.generateCalls.length, 2);
	assert.equal(fixture.pcmRequests.length, 2);
	assert.equal(fixture.windows.get(CLIP.id)?.mappingSignature.includes('500'), true);
});

test('byte-bounded residency keeps more than eight simultaneously visible tiny clips', async () => {
	const sources = Array.from({ length: 12 }, (_, index) => ({
		...SOURCE,
		id: `source-${index}`,
		storageKey: `stored-source-${index}`,
	}));
	const clips = sources.map((source, index) => ({
		...CLIP,
		id: `clip-${index}`,
		sourceId: source.id,
	}));
	const project = { id: 'project', clips, sources };
	const windows = new Map();
	const service = createFrequencyWaveformWindowService({
		findClip: (value, id) => value.clips.find((candidate) => candidate.id === id),
		findSource: (value, id) => value.sources.find((candidate) => candidate.id === id),
		getProject: () => project,
		sourceFrequencyWindows: windows,
		requestPcmWindow: async (clipId) => ({
			clipId,
			sourceId: clips.find((clip) => clip.id === clipId)!.sourceId,
			startFrame: 0,
			endFrame: 8,
			visibleStartFrame: 0,
			visibleEndFrame: 8,
			channels: [new Float32Array(8)],
		}),
		generateWindow: async (_channels, _sampleRate, options) => windowValue(
			options.sourceStartFrame + options.visibleStartOffset,
			options.visibleFrameCount,
		),
		publishDocumentSnapshot() {},
	});

	for (const clip of clips) {
		assert.ok(await service.requestFrequencyWaveformWindow(clip.id, {
			...OPTIONS,
			startFrame: 0,
			endFrame: 8,
		}));
	}
	assert.equal(windows.size, clips.length);
});

function createFixture(options: Readonly<{
	holdFirstGeneration?: boolean;
	holdFirstPcmRead?: boolean;
}> = {}) {
	const windows = new Map();
	const pcmRequests: Array<Readonly<{ clipId: string; options: Readonly<Record<string, number>> }>> = [];
	const generateCalls: Array<Readonly<{
		sourceStartFrame: number;
		visibleStartOffset: number;
		visibleFrameCount: number;
	}>> = [];
	let publishes = 0;
	let firstSignal: AbortSignal | null = null;
	let resolveStarted: () => void = () => undefined;
	const firstGenerationStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
	let firstPcmSignal: AbortSignal | null = null;
	let resolvePcmStarted: () => void = () => undefined;
	const firstPcmReadStarted = new Promise<void>((resolve) => { resolvePcmStarted = resolve; });
	let project = { id: 'project', clips: [{ ...CLIP, sourceStartFrame: 0 }], sources: [SOURCE] };
	const service = createFrequencyWaveformWindowService({
		findClip: (value, id) => value.clips.find((candidate) => candidate.id === id),
		findSource: (value, id) => value.sources.find((candidate) => candidate.id === id),
		getProject: () => project,
		sourceFrequencyWindows: windows,
		requestPcmWindow: async (clipId, requestOptions) => {
			pcmRequests.push({ clipId, options: {
				startFrame: requestOptions.startFrame,
				endFrame: requestOptions.endFrame,
				sourcePaddingFrames: requestOptions.sourcePaddingFrames,
			} });
			if (options.holdFirstPcmRead && !firstPcmSignal) {
				firstPcmSignal = requestOptions.signal ?? null;
				resolvePcmStarted();
				await new Promise<void>((_resolve, reject) => {
					requestOptions.signal?.addEventListener('abort', () => reject(
						requestOptions.signal?.reason,
					), { once: true });
				});
			}
			const shift = requestOptions.startFrame === 100 ? 0 : 10;
			const visibleStartFrame = 2_000 + shift + requestOptions.sourcePaddingFrames;
			return {
				clipId,
				sourceId: SOURCE.id,
				startFrame: 2_000 + shift,
				endFrame: visibleStartFrame + 8 + requestOptions.sourcePaddingFrames,
				visibleStartFrame,
				visibleEndFrame: visibleStartFrame + 8,
				channels: [new Float32Array(requestOptions.sourcePaddingFrames * 2 + 8)],
			};
		},
		generateWindow: async (_channels, _sampleRate, generationOptions) => {
			generateCalls.push(generationOptions);
			if (options.holdFirstGeneration && !firstSignal) {
				firstSignal = generationOptions.signal;
				resolveStarted();
				await new Promise<void>((_resolve, reject) => {
					generationOptions.signal.addEventListener('abort', () => reject(
						generationOptions.signal.reason,
					), { once: true });
				});
			}
			return windowValue(
				generationOptions.sourceStartFrame + generationOptions.visibleStartOffset,
				generationOptions.visibleFrameCount,
			);
		},
		publishDocumentSnapshot() { publishes += 1; },
	});
	return {
		service,
		windows,
		pcmRequests,
		generateCalls,
		publishes: () => publishes,
		firstSignal: () => firstSignal,
		firstGenerationStarted,
		firstPcmSignal: () => firstPcmSignal,
		firstPcmReadStarted,
		remapClip(sourceStartFrame: number) {
			project = { ...project, clips: [{ ...project.clips[0]!, sourceStartFrame }] };
		},
	};
}

function windowValue(startFrame: number, frameCount: number): FrequencyWaveformWindow {
	const channel = () => new Float32Array(frameCount);
	const firstCenterFrame = startFrame;
	const centroidLength = Math.ceil(frameCount / FREQUENCY_WAVEFORM_HOP_SIZE);
	return {
		version: FREQUENCY_WAVEFORM_ANALYSIS_VERSION,
		sampleRate: SOURCE.sampleRate,
		startFrame,
		frameCount,
		channelCount: SOURCE.channelCount,
		visualChannelCount: 1,
		crossovers: { lowMidHz: 250, midHighHz: 4_000 },
		bands: { low: [channel()], mid: [channel()], high: [channel()] },
		centroid: {
			firstCenterFrame,
			hopSize: FREQUENCY_WAVEFORM_HOP_SIZE,
			numerators: new Float32Array(centroidLength),
			weights: new Float32Array(centroidLength),
		},
	};
}
