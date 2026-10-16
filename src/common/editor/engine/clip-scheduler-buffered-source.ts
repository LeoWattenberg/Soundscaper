/* SPDX-License-Identifier: AGPL-3.0-only */

import { addNode, connect, getTransientNodes, releaseTransientNodes, setParam, type AudioNodeArray } from './audio-node-utils.ts';
import { clipStart, getReversedBuffer } from './buffer-math.ts';
import { scheduleClipGain } from './clip-gain.ts';
import type { ClipSchedulePlan } from './clip-schedule-plan.ts';
import { createClipGainChain } from './clip-scheduler-chunk-sources.ts';
import type { AudioScheduledSourceNode } from './project-graph.ts';

export interface PreparedBufferedClip {
	prepareStart(contextStartTime: number): void;
	start(beforeStart: ((startTime: number) => void) | null): void;
	cancelStartSchedule(time: number): void;
	cancel(): void;
}

/** Allocate and reverse resident sources before reserving their shared native start. */
export function prepareBufferedClip({
	plan, context, fromFrame, sampleRate, transportRate, reversedBuffers, activeSources, allNodes, mode,
}: {
	readonly plan: ClipSchedulePlan;
	readonly context: BaseAudioContext;
	readonly fromFrame: number;
	readonly sampleRate: number;
	readonly transportRate: number;
	readonly reversedBuffers: WeakMap<AudioBuffer, AudioBuffer>;
	readonly activeSources: Set<AudioScheduledSourceNode>;
	readonly allNodes: AudioNodeArray;
	readonly mode: 'live' | 'offline';
}): PreparedBufferedClip {
	if (!plan.originalBuffer) throw new Error('A buffered clip requires its resident source.');
	const transientNodes = getTransientNodes(allNodes);
	const source = addNode(transientNodes, context.createBufferSource());
	const chain = createClipGainChain(context, plan.trackInput, transientNodes);
	const scheduledNodes = [source, chain.fadeInGain, chain.fadeOutGain, chain.clipGain];
	const buffer = plan.reversed ? getReversedBuffer(context, plan.originalBuffer, reversedBuffers) : plan.originalBuffer;
	source.buffer = buffer;
	if (plan.loopSourceStartFrame !== undefined && plan.loopSourceEndFrame !== undefined) {
		source.loop = true;
		source.loopStart = plan.loopSourceStartFrame / buffer.sampleRate;
		source.loopEnd = plan.loopSourceEndFrame / buffer.sampleRate;
	}
	connect(source, chain.input);
	const timelineRate = sampleRate * transportRate;
	let startTime = 0;
	let started = false;
	return {
		prepareStart(contextStartTime): void {
			startTime = contextStartTime + (plan.segmentStart - fromFrame) / timelineRate;
			setParam(source.playbackRate, plan.playbackRate * transportRate, startTime);
			scheduleClipGain(chain.fadeInGain.gain, chain.fadeOutGain.gain, chain.clipGain.gain,
				plan.clip, plan.relativeStart, plan.segmentEnd - clipStart(plan.clip), plan.duration, startTime, timelineRate, plan);
		},
		start(beforeStart): void {
			beforeStart?.(startTime);
			try {
				source.start(startTime, plan.offsetFrame / buffer.sampleRate, plan.segmentDuration * plan.playbackRate);
				started = true;
				activeSources.add(source);
				source.onended = (): void => {
					activeSources.delete(source);
					if (mode === 'live') releaseTransientNodes(transientNodes, scheduledNodes);
				};
			} catch {
				// Web Audio range errors still skip only the malformed segment.
				releaseTransientNodes(transientNodes, scheduledNodes);
			}
		},
		cancelStartSchedule(time): void {
			for (const param of [source.playbackRate, chain.fadeInGain.gain, chain.fadeOutGain.gain, chain.clipGain.gain]) param.cancelScheduledValues?.(time);
		},
		cancel(): void {
			if (started) { try { source.stop(); } catch { /* Preserve the scheduling error. */ } }
			activeSources.delete(source);
			releaseTransientNodes(transientNodes, scheduledNodes);
		},
	};
}
