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
import { NATIVE_EFFECT_LATENCY_MAX_SECONDS } from './native-effect-latency-v21.ts';
import type { EngineTrack } from './types.ts';

const MAXIMUM_COMPENSATION_SECONDS = 60;
/**
 * How far above its built compensation a retunable seam must still reach.
 *
 * Web Audio clamps `delayTime` to the `maxDelayTime` the node was constructed
 * with, silently and without an error, so a delay a live PDC revision can retune
 * has to be built for the whole range that revision may ask for — not for the
 * frames the project happened to need when playback started. The range is the
 * latency ledger's own admission bound: a hosted plug-in may claim up to that
 * much delay mid-playback, on top of whatever the path already compensates.
 */
const RETUNABLE_COMPENSATION_HEADROOM_SECONDS = NATIVE_EFFECT_LATENCY_MAX_SECONDS;

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
	declaredWidth: number = sourceWidth,
): AudioNode {
	const map = pannedSourceChannelMap(edge.channelMap, sourceWidth, declaredWidth);
	if (!map.length || (
		map.length === destinationWidth
		&& sourceWidth === destinationWidth
		&& map.every((source, destination) => source === destination)
	)) return input;
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
		// The stored-document validator deliberately admits maps longer than
		// their destination (shipped documents carry them), so the graph keeps
		// those projects playable by routing only the in-range entries.
		if (destinationChannel >= destinationWidth) continue;
		if (sourceChannel >= 0) connect(splitter, merger, sourceChannel, destinationChannel);
	}
	return merger;
}

/**
 * The map an edge applies once its source strip's panner has widened it.
 *
 * A mono strip declares one channel, so its persisted map spreads channel 0
 * across the destination — `[0, 0]` for a stereo master. The stereo panner the
 * strip still receives has already placed that channel across two, so reading
 * channel 0 for both destinations would throw the pan away and, at hard right,
 * mute the strip outright. The panner's own pair reads straight through
 * instead; entries that select channel 0 for any wider destination keep it.
 */
function pannedSourceChannelMap(
	map: readonly number[],
	sourceWidth: number,
	declaredWidth: number,
): readonly number[] {
	if (sourceWidth === declaredWidth) return map;
	return map.map((source, destination) => (source === 0 && destination < sourceWidth ? destination : source));
}

export function applyEdgeCompensation(
	context: BaseAudioContext,
	nodes: AudioNodeArray,
	input: AudioNode,
	frames: number,
	register?: (param: AudioParam) => void,
): AudioNode {
	if (frames <= 0 && !register) return input;
	if (!Number.isSafeInteger(frames)) throw new RangeError('V21 PDC compensation must be an integer frame count.');
	if (typeof context.createDelay !== 'function') {
		throw new Error('This browser cannot apply V21 per-path delay compensation.');
	}
	const seconds = frames / (context.sampleRate || DEFAULT_SAMPLE_RATE);
	if (seconds > MAXIMUM_COMPENSATION_SECONDS) {
		throw new RangeError('V21 per-path delay compensation exceeds the runtime limit.');
	}
	const maximumSeconds = register
		? Math.min(MAXIMUM_COMPENSATION_SECONDS, Math.max(1, seconds + RETUNABLE_COMPENSATION_HEADROOM_SECONDS))
		: Math.max(1, seconds);
	const delay = addNode(nodes, context.createDelay(maximumSeconds));
	setParam(delay.delayTime, seconds, context.currentTime);
	register?.(delay.delayTime);
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
