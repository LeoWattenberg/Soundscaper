/* SPDX-License-Identifier: AGPL-3.0-only */

import { setParam } from './audio-node-utils.ts';
import { ENGINE_ASSERT_ACTIVE } from './runtime-symbols.ts';
import type { EngineRuntimeHost, EngineRuntimeMethodMap } from './runtime-types.ts';

/** Normalize the device-listening level without giving it project authority. */
export function normalizePlaybackGain(value: unknown): number {
	const gain = Number(value);
	return Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 1;
}

/**
 * Return the context-local gain downstream of master metering.
 *
 * This node deliberately outlives individual playback graphs: meter creation
 * and exact-preview paths can share it, while offline project renders continue
 * to terminate directly at their capture destinations.
 */
export function playbackOutputDestination(
	engine: EngineRuntimeHost,
	context: BaseAudioContext,
	destination: AudioNode,
): GainNode {
	if (engine.playbackOutputNode && engine.playbackOutputDestination === destination) {
		return engine.playbackOutputNode;
	}
	engine.playbackOutputNode?.disconnect();
	const node = context.createGain();
	setParam(node.gain, engine.playbackGain, context.currentTime);
	node.connect(destination);
	engine.playbackOutputNode = node;
	engine.playbackOutputDestination = destination;
	if (engine.masterLoudnessMeter) {
		engine.masterLoudnessMeter.node.disconnect();
		engine.masterLoudnessMeter.node.connect(node);
	}
	return node;
}

export const enginePlaybackOutputMethods = {
	setPlaybackGain(value) {
		this[ENGINE_ASSERT_ACTIVE]();
		this.playbackGain = normalizePlaybackGain(value);
		if (this.playbackOutputNode && this.context) {
			setParam(this.playbackOutputNode.gain, this.playbackGain, this.context.currentTime);
		}
		return this.playbackGain;
	},

	getPlaybackGain() {
		return this.playbackGain;
	},
} satisfies EngineRuntimeMethodMap<'setPlaybackGain' | 'getPlaybackGain'>;
