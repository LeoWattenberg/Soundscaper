/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSourceRuntimeComposition } from '../src/common/editor/controller/source/source-runtime-composition.ts';
import { createProjectVisualService } from '../src/common/editor/controller/document/project-visual-service.ts';
import {
	FREQUENCY_WAVEFORM_ANALYSIS_VERSION,
	FREQUENCY_WAVEFORM_FFT_SIZE,
	FREQUENCY_WAVEFORM_HOP_SIZE,
	frequencyWaveformBlockSizes,
} from '../src/common/editor/frequency-waveform-contract.ts';

test('an oversized bounded request falls back to usable full-source frequency analysis', async () => {
	const frameCount = 300_000;
	const source = {
		id: 'source', kind: 'audio', storageKey: 'stored-source',
		frameCount, channelCount: 1, sampleRate: 48_000,
	};
	const clip = {
		id: 'clip', kind: 'audio', sourceId: source.id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: frameCount, durationFrames: frameCount,
	};
	const project = {
		id: 'project', schemaVersion: 17, sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [],
	};
	const cached = analysis(frameCount);
	let loads = 0;
	const sourceBuffers = Object.assign(new Map(), { setIfFits: () => false });
	const ports = {
		state: { missingSourceIds: new Set(), recordingStarting: false, recorder: null },
		copy: { ready: 'ready', audioAnalysisWorkerFailed: 'worker failed', audioAnalysisFailed: 'analysis failed' },
		engine: {},
		sourceBuffers,
		sourceChunkProviders: new Map(),
		sourcePeaks: new Map(),
		playbackProjects: {},
		createProjectVisualService,
		getProject: () => project,
		publishDocumentSnapshot: () => undefined,
		store: {
			loadAnalysis: async () => { loads += 1; return cached; },
			saveAnalysis: async () => undefined,
		},
	};
	const dependencies = new Proxy(ports, { get(target, key) {
		return Reflect.get(target, key) ?? (() => { throw new Error(`Unexpected source port ${String(key)}`); });
	} });
	const runtime = createSourceRuntimeComposition(dependencies as never);
	const result = await runtime.frequencyWaveforms.requestFrequencyWaveform('clip', {
		startFrame: 0,
		endFrame: 262_145,
		lowMidCrossoverHz: 250,
		midHighCrossoverHz: 4_000,
	});

	assert.equal(result, cached);
	assert.equal(loads, 1);
});

function analysis(frameCount: number) {
	return {
		version: FREQUENCY_WAVEFORM_ANALYSIS_VERSION,
		sampleRate: 48_000,
		frameCount,
		channelCount: 1,
		visualChannelCount: 1,
		crossovers: { lowMidHz: 250, midHighHz: 4_000 },
		fftSize: FREQUENCY_WAVEFORM_FFT_SIZE,
		hopSize: FREQUENCY_WAVEFORM_HOP_SIZE,
		levels: frequencyWaveformBlockSizes(frameCount, 1).map((blockSize) => {
			const buckets = Math.ceil(frameCount / blockSize);
			const band = [{ minimums: new Float32Array(buckets), maximums: new Float32Array(buckets) }];
			return {
				blockSize,
				bands: { low: band, mid: band, high: band },
				centroid: { numerators: new Float32Array(buckets), weights: new Float32Array(buckets) },
			};
		}),
	};
}
