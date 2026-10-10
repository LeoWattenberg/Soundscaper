/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureLiveAnalysisTap, releaseLiveAnalysisTap } from '../src/common/editor/engine/live-analysis-tap.ts';
import { readMasterMeter } from '../src/common/editor/engine/engine-meter-reading.ts';
import type { ProjectGraph } from '../src/common/editor/engine/project-graph.ts';

function nativeGraph(width: number) {
	const nodes: AudioNode[] = [];
	const invalidOutputs: number[] = [];
	const connections: number[] = [];
	const disconnects = new Map<AudioNode, number>();
	function node(outputs = 1): AudioNode {
		const value = {
			connect(_destination: AudioNode, output = 0): void {
				if (output >= outputs) {
					invalidOutputs.push(output);
					throw new DOMException('The output index exceeds the splitter width.', 'IndexSizeError');
				}
				connections.push(output);
			},
			disconnect(): void { disconnects.set(value as unknown as AudioNode, (disconnects.get(value as unknown as AudioNode) ?? 0) + 1); },
		};
		const result = value as unknown as AudioNode;
		nodes.push(result);
		return result;
	}
	const source = node();
	const context = {
		createChannelSplitter: (outputs: number): AudioNode => node(outputs),
		createAnalyser(): AnalyserNode {
			return Object.assign(node(), {
				fftSize: 256, frequencyBinCount: 2_048,
				getFloatTimeDomainData(values: Float32Array): void { values.fill(.5); },
				getFloatFrequencyData(values: Float32Array): void { values.fill(-120); values[35] = -6; },
			}) as unknown as AnalyserNode;
		},
	} as unknown as BaseAudioContext;
	const graph = { nodes: [], masterAnalyser: source,
		productionStripAnalysersV21: new Map([['master', { analysers: Array.from({ length: width }, () => source) }]]) } as unknown as ProjectGraph;
	return { context, graph, nodes, invalidOutputs, connections, disconnects };
}

for (const width of [1, 2, 6, 32]) test(`live Analysis retains the normally authored ${width}-channel master`, () => {
	const fixture = nativeGraph(width);
	const tap = ensureLiveAnalysisTap(fixture.context, fixture.graph);
	assert.ok(tap, 'an admitted mono ADM master must retain its live Analysis lease');
	assert.deepEqual(fixture.invalidOutputs, [], 'every tap must address an actual splitter output');
	assert.equal(tap.spectrumChannels?.length, width);
	assert.equal(ensureLiveAnalysisTap(fixture.context, fixture.graph), tap);
	const reading = readMasterMeter(null, tap);
	assert.equal(reading.spectrumDb?.length, 128);
	assert.ok(reading.spectrumDb.some(level => Math.abs(level + 6) < .000_01));
	if (width === 1) {
		assert.equal(reading.stereoCorrelation, null);
		assert.deepEqual(reading.stereoScope, []);
	} else assert.equal(reading.stereoCorrelation, 1);
	releaseLiveAnalysisTap(fixture.graph);
	assert.equal(fixture.graph.nodes.transientNodes?.size, 0);
	assert.ok(fixture.nodes.every(node => (fixture.disconnects.get(node) ?? 0) > 0));
});
