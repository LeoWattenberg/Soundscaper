/* SPDX-License-Identifier: AGPL-3.0-only */

import { addNode, connect, getTransientNodes, releaseTransientNodes } from './audio-node-utils.ts';
import type { ProjectGraph } from './project-graph.ts';

export interface LiveAnalysisTap {
	readonly spectrum: AnalyserNode | null;
	readonly splitter: ChannelSplitterNode | null;
	readonly stereo: readonly AnalyserNode[];
}

const taps = new WeakMap<ProjectGraph, LiveAnalysisTap>();
const SPECTRUM_FFT_SIZE = 4_096;
const STEREO_FFT_SIZE = 256;

/** Attach side taps to the current playback graph only while a visible panel holds a lease. */
export function ensureLiveAnalysisTap(
	context: BaseAudioContext | null,
	graph: ProjectGraph | null,
): LiveAnalysisTap | null {
	if (!context || !graph?.masterAnalyser) return null;
	const existing = taps.get(graph);
	if (existing) return existing;
	const nodes = getTransientNodes(graph.nodes);
	const source = graph.masterAnalyser;
	let spectrum: AnalyserNode | null = null;
	let splitter: ChannelSplitterNode | null = null;
	const stereo: AnalyserNode[] = [];
	try {
		if (typeof context.createAnalyser === 'function') {
			spectrum = addNode(nodes, context.createAnalyser());
			spectrum.fftSize = SPECTRUM_FFT_SIZE;
			spectrum.smoothingTimeConstant = 0.4;
			spectrum.minDecibels = -120;
			spectrum.maxDecibels = 0;
			connect(source, spectrum);
		}
		if (typeof context.createChannelSplitter === 'function' && typeof context.createAnalyser === 'function') {
			splitter = addNode(nodes, context.createChannelSplitter(2));
			connect(source, splitter);
			for (let channel = 0; channel < 2; channel += 1) {
				const analyser = addNode(nodes, context.createAnalyser());
				analyser.fftSize = STEREO_FFT_SIZE;
				connect(splitter, analyser, channel, 0);
				stereo.push(analyser);
			}
		}
		const tap = Object.freeze({ spectrum, splitter, stereo: Object.freeze(stereo) });
		taps.set(graph, tap);
		return tap;
	} catch {
		try { if (spectrum) source.disconnect(spectrum); } catch { /* The graph may already be closing. */ }
		try { if (splitter) source.disconnect(splitter); } catch { /* The graph may already be closing. */ }
		releaseTransientNodes(nodes, [spectrum, splitter, ...stereo]);
		return null;
	}
}

export function releaseLiveAnalysisTap(graph: ProjectGraph | null): void {
	if (!graph) return;
	const tap = taps.get(graph);
	if (!tap) return;
	const source = graph.masterAnalyser;
	if (tap.spectrum) {
		try { source?.disconnect(tap.spectrum); } catch { /* The graph may already be closing. */ }
	}
	const nodes = getTransientNodes(graph.nodes);
	if (tap.splitter) {
		try { source?.disconnect(tap.splitter); } catch { /* The graph may already be closing. */ }
	}
	releaseTransientNodes(nodes, [tap.spectrum, tap.splitter, ...tap.stereo]);
	taps.delete(graph);
}
