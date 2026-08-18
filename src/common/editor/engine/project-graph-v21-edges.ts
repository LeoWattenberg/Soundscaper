/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AdmTerminalStripKind } from '../adm-project-metadata.ts';
import type {
	MixerEdgeV21,
	MixerGraphV21,
	MixerStripV21,
} from '../mixer-graph-v21.ts';
import type { StripRef } from '../parameter-address.ts';
import { addNode, connect, setParam, type AudioNodeArray } from './audio-node-utils.ts';
import { clamp, DEFAULT_SAMPLE_RATE, positiveInteger } from './buffer-math.ts';
import type { EngineTrack } from './types.ts';

const MAXIMUM_COMPENSATION_SECONDS = 60;

interface AudioTrackV21 extends EngineTrack {
	readonly id: string;
}

export function stripKey(strip: StripRef): string {
	return strip.kind === 'master' ? 'master' : `${strip.kind}:${strip.id}`;
}

/**
 * What an edge of the production mixer graph resolves to in the audio graph.
 *
 * Split out of the graph builder when it passed its size limit: these answer
 * "where does this edge go, how wide is it there, and how are its channels
 * mapped" without knowing anything about strips, effects or automation.
 */

export function applyChannelMap(
	context: BaseAudioContext,
	nodes: AudioNodeArray,
	input: AudioNode,
	sourceWidth: number,
	destinationWidth: number,
	edge: MixerEdgeV21,
): AudioNode {
	const map = edge.channelMap;
	if (!map.length || (
		map.length === destinationWidth
		&& sourceWidth === destinationWidth
		&& map.every((source, destination) => source === destination)
	)) return input;
	if (map.length > destinationWidth) throw new RangeError(`V21 mixer edge ${edge.id} maps beyond its destination width.`);
	if (map.some((source) => source >= sourceWidth)) {
		throw new RangeError(`V21 mixer edge ${edge.id} maps a missing source channel.`);
	}
	if (typeof context.createChannelSplitter !== 'function' || typeof context.createChannelMerger !== 'function') {
		throw new Error('This browser cannot apply an explicit V21 mixer channel map.');
	}
	const splitter = addNode(nodes, context.createChannelSplitter(sourceWidth));
	const merger = addNode(nodes, context.createChannelMerger(destinationWidth));
	connect(input, splitter);
	for (const [destinationChannel, sourceChannel] of map.entries()) {
		if (sourceChannel >= 0) connect(splitter, merger, sourceChannel, destinationChannel);
	}
	return merger;
}

export function applyEdgeCompensation(
	context: BaseAudioContext,
	nodes: AudioNodeArray,
	input: AudioNode,
	frames: number,
): AudioNode {
	if (frames <= 0) return input;
	if (!Number.isSafeInteger(frames)) throw new RangeError('V21 PDC compensation must be an integer frame count.');
	if (typeof context.createDelay !== 'function') {
		throw new Error('This browser cannot apply V21 per-path delay compensation.');
	}
	const seconds = frames / (context.sampleRate || DEFAULT_SAMPLE_RATE);
	if (seconds > MAXIMUM_COMPENSATION_SECONDS) {
		throw new RangeError('V21 per-path delay compensation exceeds the runtime limit.');
	}
	const delay = addNode(nodes, context.createDelay(Math.max(1, seconds)));
	setParam(delay.delayTime, seconds, context.currentTime);
	connect(input, delay);
	return delay;
}

/**
 * The ADM terminal an edge's source names, or null when it has none.
 *
 * The V21 graph calls every bus a `mixer-node`; ADM assignments still say
 * `group` or `send`, because that is the vocabulary the operator authored in.
 * The graph's own group list is what tells the two apart.
 */
export function admTerminalStrip(
	graph: MixerGraphV21,
	source: MixerGraphV21['edges'][number]['source'],
): Readonly<{ kind: AdmTerminalStripKind; id: string }> | null {
	if (source.kind === 'track') return Object.freeze({ kind: 'track' as const, id: source.id });
	if (source.kind !== 'mixer-node') return null;
	return Object.freeze({
		kind: graph.groups.some(({ id }) => id === source.id) ? 'group' as const : 'send' as const,
		id: source.id,
	});
}

export function edgeDestinationInput(
	edge: MixerEdgeV21,
	mixerInputs: ReadonlyMap<string, AudioNode>,
	masterInput: AudioNode,
	outputInputs: ReadonlyMap<string, AudioNode>,
	sidechainInputs: ReadonlyMap<string, ReadonlyMap<string, AudioNode>>,
): AudioNode {
	const destination = edge.destination;
	if (destination.kind === 'master') return masterInput;
	if (destination.kind === 'mixer-node') return mixerInputs.get(destination.id)!;
	if (destination.kind === 'output') return outputInputs.get(destination.id)!;
	return sidechainInputs.get(stripKey(destination.strip))!.get(destination.effectId)!;
}

export function edgeDestinationWidth(
	edge: MixerEdgeV21,
	graph: MixerGraphV21,
	tracks: readonly AudioTrackV21[],
	trackWidths: ReadonlyMap<string, number>,
	masterChannels: unknown,
): number {
	const destination = edge.destination;
	if (destination.kind === 'master') return clamp(positiveInteger(masterChannels, 2), 1, 32);
	if (destination.kind === 'mixer-node') return mixerStrip(graph, destination.id).channelCount;
	if (destination.kind === 'output') return graph.outputs.find(({ id }) => id === destination.id)!.channelCount;
	if (destination.strip.kind === 'master') return clamp(positiveInteger(masterChannels, 2), 1, 32);
	if (destination.strip.kind === 'mixer-node') return mixerStrip(graph, destination.strip.id).channelCount;
	const trackId = destination.strip.kind === 'track' ? destination.strip.id : '';
	return trackWidths.get(tracks.find(({ id }) => id === trackId)?.id ?? '') ?? 2;
}

export function mixerStrip(graph: MixerGraphV21, id: string): MixerStripV21 {
	const strip = [...graph.groups, ...graph.sends, ...graph.cues].find((candidate) => candidate.id === id);
	if (!strip) throw new TypeError(`Unknown V21 mixer node: ${id}.`);
	return strip;
}

export function excludedTrackEdge(edge: MixerEdgeV21, onlyTrackId: unknown): boolean {
	return onlyTrackId != null
		&& edge.kind !== 'sidechain'
		&& edge.source.kind === 'track'
		&& edge.source.id !== String(onlyTrackId);
}

export function endpointKey(endpoint: Exclude<MixerEdgeV21['destination'], { kind: 'effect-sidechain' | 'output' }>
	| MixerEdgeV21['source']): string {
	return endpoint.kind === 'master' ? 'master' : `${endpoint.kind}:${endpoint.id}`;
}

