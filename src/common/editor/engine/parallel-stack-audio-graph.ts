/* SPDX-License-Identifier: AGPL-3.0-only */

import { connectSurroundMonitoring } from '../surround-monitoring.ts';
import { addNode, type AudioNodeArray } from './audio-node-utils.ts';
import { createAnalyser } from './effect-rack.ts';
import { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';
import { createStripMeterAnalyserBankV21, type StripMeterAnalyserBankV21 } from './strip-meter-analyser-bank-v21.ts';
import type { ParallelStackPlan } from './parallel-stack-types.ts';
import type { ProjectGraph } from './project-graph.ts';

/** Keep the source scheduler and meter consumers on their existing AudioNode ports. */
export function buildParallelStackAudioGraph(
	context: AudioContext,
	destination: AudioNode,
	collector: AudioWorkletNode,
	plan: ParallelStackPlan,
	latencyFrames: number,
	metering: boolean,
	abortController: AbortController,
): ProjectGraph {
	const nodes: AudioNodeArray = [collector];
	const trackInputs = new Map<string, AudioNode>();
	const trackAnalysers = new Map<string, AnalyserNode>();
	const groupAnalysers = new Map<string, AnalyserNode>();
	const sendAnalysers = new Map<string, AnalyserNode>();
	const productionStripAnalysersV21 = new Map<string, StripMeterAnalyserBankV21>();
	try {
		for (const [index, track] of plan.tracks.entries()) {
			const input = addNode(nodes, context.createGain());
			input.channelCount = track.channels;
			input.channelCountMode = 'explicit';
			// Match the conventional source input's speaker up/down-mixing before the discrete collector.
			input.channelInterpretation = 'speakers';
			input.connect(collector, 0, index);
			trackInputs.set(track.id, input);
		}
		if (metering) for (const [index, tap] of plan.stripTaps.entries()) {
			const output = addNode(nodes, context.createGain());
			output.channelCount = tap.channels;
			output.channelCountMode = 'explicit';
			output.channelInterpretation = 'discrete';
			collector.connect(output, plan.outputs.length + index, 0);
			const bank = createStripMeterAnalyserBankV21(context, nodes, output, tap.ref, tap.channels);
			if (bank) productionStripAnalysersV21.set(tap.key, bank);
			const analyser = createAnalyser(context, nodes);
			if (analyser) {
				output.connect(analyser);
				if (tap.ref.kind === 'track') trackAnalysers.set(tap.ref.id, analyser);
				else if (tap.ref.kind === 'mixer-node') {
					(tap.scope === 'send' ? sendAnalysers : groupAnalysers).set(tap.ref.id, analyser);
				}
			}
		}
		const mainIndex = plan.outputs.findIndex((output) => output.role === 'main');
		if (mainIndex < 0) throw new Error('Parallel playback requires a main output.');
		const output = addNode(nodes, context.createGain());
		output.channelCount = plan.outputs[mainIndex]!.channels;
		output.channelCountMode = 'explicit';
		output.channelInterpretation = 'discrete';
		collector.connect(output, mainIndex, 0);
		const masterAnalyser = metering ? createAnalyser(context, nodes) : null;
		if (masterAnalyser) output.connect(masterAnalyser);
		connectSurroundMonitoring(context, masterAnalyser ?? output, destination, output.channelCount, nodes);
		return {
			nodes, sources: new Set(), abortController, trackInputs,
			trackGainParams: new Map(),
			projectGainParams: { tracks: new Map(), groups: new Map(), sends: new Map(), master: null },
			parameterRegistry: new ScheduledParameterRegistry(),
			trackAnalysers, groupAnalysers, sendAnalysers, masterAnalyser,
			effectNodes: new Map(), effectAnalysers: new Map(), effectMessageSequences: new Map(),
			productionStripAnalysersV21, latencyFrames: latencyFrames + plan.latencyFrames,
		};
	} catch (error) {
		for (const node of nodes) node.disconnect();
		throw error;
	}
}
