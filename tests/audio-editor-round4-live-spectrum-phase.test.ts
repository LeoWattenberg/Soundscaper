/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readMasterMeter } from '../src/common/editor/engine/engine-meter-reading.ts';
import { ensureLiveAnalysisTap, releaseLiveAnalysisTap } from '../src/common/editor/engine/live-analysis-tap.ts';
import type { ProjectGraph } from '../src/common/editor/engine/project-graph.ts';

function analyser(db: number, sign = 1): AnalyserNode {
	const bins = new Float32Array(2_048).fill(-120);
	bins[35] = db;
	return { fftSize: 256, frequencyBinCount: bins.length,
		getFloatFrequencyData(output: Float32Array): void { output.set(bins); },
		getFloatTimeDomainData(output: Float32Array): void {
			for (let frame = 0; frame < output.length; frame++) output[frame] = (frame % 2 ? -1 : 1) * sign;
		} } as unknown as AnalyserNode;
}

test('live spectrum pools channel power before opposite polarity can cancel', () => {
	const left = analyser(-6);
	const right = analyser(-6, -1);
	const tap = { spectrum: analyser(-120), spectrumChannels: [left, right], splitter: null, stereo: [left, right] };
	const reading = readMasterMeter(null, tap);
	assert.equal(reading.stereoCorrelation, -1);
	assert.ok(reading.spectrumDb?.some(db => Math.abs(db + 6) < 0.000_01));
	assert.equal(reading.spectrumDb?.length, 128);
});

test('the spectrum lease splits the declared master channels and releases every side tap', () => {
	const nodes: Array<AudioNode & { disconnections: number }> = [];
	const createNode = (): AudioNode & { disconnections: number } => {
		const node = { disconnections: 0, connect() {}, disconnect(this: { disconnections: number }) { this.disconnections++; } } as unknown as AudioNode & { disconnections: number };
		nodes.push(node);
		return node;
	};
	const source = createNode();
	const widths: number[] = [];
	const graph = { nodes: [], masterAnalyser: source,
		productionStripAnalysersV21: new Map([['master', { analysers: [source, source, source, source] }]]) } as unknown as ProjectGraph;
	const context = { createAnalyser: () => createNode(), createChannelSplitter: (width: number) => {
		widths.push(width); return createNode();
	} } as unknown as BaseAudioContext;
	const tap = ensureLiveAnalysisTap(context, graph);
	assert.ok(tap);
	assert.deepEqual(widths, [4]);
	assert.equal(tap.spectrumChannels?.length, 4);
	assert.ok(tap.spectrumChannels?.every(channel => channel.fftSize === 4_096));
	assert.equal(ensureLiveAnalysisTap(context, graph), tap);
	releaseLiveAnalysisTap(graph);
	assert.ok(nodes.every(node => node.disconnections > 0));
	ensureLiveAnalysisTap(context, graph);
	assert.deepEqual(widths, [4, 4]);
	releaseLiveAnalysisTap(graph);
});

test('a silent channel participates in average spectrum power without silencing the active channel', () => {
	const tap = { spectrum: analyser(-120), spectrumChannels: [analyser(-120), analyser(-6)], splitter: null, stereo: [] };
	const reading = readMasterMeter(null, tap);
	assert.ok(reading.spectrumDb?.some(db => Math.abs(db - 10 * Math.log10((10 ** (-12) + 10 ** (-0.6)) / 2)) < 0.000_01));
	assert.ok(Object.isFrozen(reading.spectrumDb));
});
