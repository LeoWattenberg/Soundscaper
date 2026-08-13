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
	const tracks = (project?.tracks || [])
		.filter((track) => track.type !== 'label' && track.type !== 'video')
		.map((track, index) => ({ index, track }))
		.filter(({ index, track }) => (
			onlyTrackId == null || String(
				fallbackTrackIndexIds ? track.id ?? index : track.id,
			) === String(onlyTrackId))
		);
	const trackLatencyFrames = new Map(tracks.map(({ index, track }) => [
		String(track.id ?? index),
		effectRackLatencyFrames(activeRackEffects(track), sampleRate),
	]));
	const buses = [
		...(project?.mixer?.groups || []),
		...(project?.mixer?.sends || []),
	];
	const busLatencyFrames = new Map(buses.map((bus) => [
		String(bus.id),
		effectRackLatencyFrames(activeRackEffects(bus), sampleRate),
	]));
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
	return Math.max(0, ...latencies.values());
}
