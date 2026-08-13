/* SPDX-License-Identifier: AGPL-3.0-only */

import { envelopeValueAtFrame } from '../automation.js';
import {
	finite,
	nonNegativeInteger,
	positiveInteger,
} from './buffer-math.ts';
import type { EngineGainOwner } from './types.ts';

export interface ProjectGainEvent {
	readonly kind: 'set' | 'linear';
	readonly value: number;
	readonly time: number;
}

export interface CompileProjectGainEventsOptions {
	readonly fromFrame: number;
	readonly toFrame: number;
	readonly durationFrames: number;
	readonly contextStartTime: number;
	readonly sampleRate: number;
	readonly contextSampleRate: number;
	readonly transportRate: number;
	readonly latencyFrames: number;
}

/** Compile one gain owner's authoritative scheduling events before Web Audio mutation. */
export function compileProjectGainEvents(
	owner: EngineGainOwner,
	options: CompileProjectGainEventsOptions,
): readonly ProjectGainEvent[] {
	if (!Array.isArray(owner.envelope) || owner.envelope.length === 0) return Object.freeze([]);
	const {
		fromFrame,
		toFrame,
		durationFrames,
		contextStartTime,
		sampleRate,
		contextSampleRate,
		transportRate,
		latencyFrames,
	} = options;
	const timelineRate = sampleRate * transportRate;
	const startTime = contextStartTime
		+ nonNegativeInteger(latencyFrames, 0) / positiveInteger(contextSampleRate, sampleRate);
	const baseGain = Math.max(0, finite(owner.gain, 1));
	const events: ProjectGainEvent[] = [{
		kind: 'set',
		value: baseGain * envelopeValueAtFrame(owner.envelope, fromFrame, durationFrames),
		time: startTime,
	}];
	for (const point of owner.envelope) {
		if (point.frame <= fromFrame || point.frame >= toFrame) continue;
		events.push({
			kind: 'linear',
			value: baseGain * Math.max(0, finite(point.value, 1)),
			time: startTime + (point.frame - fromFrame) / timelineRate,
		});
	}
	if (toFrame > fromFrame) {
		events.push({
			kind: 'linear',
			value: baseGain * envelopeValueAtFrame(owner.envelope, toFrame, durationFrames),
			time: startTime + (toFrame - fromFrame) / timelineRate,
		});
	}
	return Object.freeze(events.map((event) => Object.freeze(event)));
}
