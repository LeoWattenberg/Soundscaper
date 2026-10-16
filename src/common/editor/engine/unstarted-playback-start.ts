/* SPDX-License-Identifier: AGPL-3.0-only */

import { throwIfAborted } from './async-utils.ts';
import { assertSharedPlaybackStart } from './clip-scheduler-live-chunks.ts';
import type { ProjectGainParams } from './project-graph.ts';
import type { ScheduledParameterRegistry } from './scheduled-parameter-registry.ts';

/** A single replacement is allowed before any source start/play is committed. */
export function prepareUnstartedPlaybackStart({
	context, candidate, leadSeconds, checkDeadline, allowRebase, signal, prepare, cancel,
}: {
	readonly context: BaseAudioContext;
	readonly candidate: number;
	readonly leadSeconds: number;
	readonly checkDeadline: boolean;
	readonly allowRebase: boolean;
	readonly signal: AbortSignal | null;
	readonly prepare: (startTime: number) => void;
	readonly cancel: (startTime: number) => void;
}): number {
	let startTime = candidate;
	for (let attempt = 0; ; attempt += 1) {
		throwIfAborted(signal);
		prepare(startTime);
		throwIfAborted(signal);
		if (!checkDeadline) return startTime;
		try { assertSharedPlaybackStart(context, startTime); return startTime; }
		catch (error) {
			if (!allowRebase || attempt !== 0) throw error;
			cancel(startTime);
			throwIfAborted(signal);
			startTime = Math.max(startTime, context.currentTime + leadSeconds);
		}
	}
}

/** Clear the abandoned native windows from their original anchor, including delayed targets. */
export function cancelUnstartedProjectAutomation(startTime: number, gains: Partial<ProjectGainParams>, registry: ScheduledParameterRegistry | null): void {
	const params = new Set<AudioParam>();
	for (const group of [gains.tracks, gains.groups, gains.sends]) for (const scheduled of group?.values() ?? []) params.add(scheduled.param);
	if (gains.master) params.add(gains.master.param);
	for (const target of registry?.entries() ?? []) {
		if (target.binding.kind === 'audio-param') for (const binding of target.binding.params) params.add(binding.param);
	}
	for (const param of params) param.cancelScheduledValues?.(startTime);
}
