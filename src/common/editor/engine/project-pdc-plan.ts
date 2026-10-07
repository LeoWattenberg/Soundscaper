/* SPDX-License-Identifier: AGPL-3.0-only */

import { activeRackEffects } from './project-effects.ts';
import { effectRackLatencyFrames } from './effect-rack.ts';
import { DEFAULT_SAMPLE_RATE } from './buffer-math.ts';
import type { EngineProject } from './types.ts';

export interface ProjectPdcPlanOptions {
	readonly trackId?: unknown;
	readonly includeMaster?: boolean;
	readonly sampleRate?: number;
	readonly fallbackTrackIndexIds?: boolean;
}

export interface ProjectPdcPlan {
	readonly trackLatencyFrames: ReadonlyMap<string, number>;
	readonly maximumTrackLatencyFrames: number;
	readonly busLatencyFrames: ReadonlyMap<string, number>;
	readonly maximumBusLatencyFrames: number;
	readonly masterLatencyFrames: number;
	readonly latencyFrames: number;
}

/** Compile the immutable latency facts consumed by live and offline project graphs. */
export function compileProjectPdcPlan(
	project: EngineProject | null | undefined,
	{
		trackId: onlyTrackId = null,
		includeMaster = true,
		sampleRate = project?.sampleRate || DEFAULT_SAMPLE_RATE,
		fallbackTrackIndexIds = false,
	}: ProjectPdcPlanOptions = {},
): ProjectPdcPlan {
	const trackLatencyFrames = new Map<string, number>();
	let index = 0;
	for (const track of project?.tracks || []) {
		if (track.type === 'label' || track.type === 'video') continue;
		const fallbackId = track.id ?? index;
		index += 1;
		if (onlyTrackId != null && String(fallbackTrackIndexIds ? fallbackId : track.id) !== String(onlyTrackId)) continue;
		trackLatencyFrames.set(String(fallbackId), effectRackLatencyFrames(activeRackEffects(track), sampleRate));
	}
	const busLatencyFrames = new Map<string, number>();
	for (const buses of [project?.mixer?.groups || [], project?.mixer?.sends || []]) {
		for (const bus of buses) {
			busLatencyFrames.set(String(bus.id), effectRackLatencyFrames(activeRackEffects(bus), sampleRate));
		}
	}
	const maximumTrackLatencyFrames = maximumLatency(trackLatencyFrames);
	const maximumBusLatencyFrames = maximumLatency(busLatencyFrames);
	const masterLatencyFrames = includeMaster
		? effectRackLatencyFrames(activeRackEffects(project?.master), sampleRate)
		: 0;
	return Object.freeze({
		trackLatencyFrames,
		maximumTrackLatencyFrames,
		busLatencyFrames,
		maximumBusLatencyFrames,
		masterLatencyFrames,
		latencyFrames: maximumTrackLatencyFrames + maximumBusLatencyFrames + masterLatencyFrames,
	});
}

function maximumLatency(latencies: ReadonlyMap<string, number>): number {
	let maximum = 0;
	for (const value of latencies.values()) maximum = Math.max(maximum, value);
	return maximum;
}
