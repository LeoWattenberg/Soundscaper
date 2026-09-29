/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectGraph } from './project-graph.ts';
import type { EngineProject } from './types.ts';
import { throwIfAborted } from './async-utils.ts';

export interface ParallelStackPlaybackRequest {
	readonly context: AudioContext;
	readonly destination: AudioNode;
	readonly project: EngineProject;
	readonly metering: boolean;
	readonly playbackMode: string;
	readonly playbackRate: number;
	readonly fromFrame: number;
	readonly onFailure: (error: Error) => void;
}

export type ParallelStackPlaybackFactory = (
	request: ParallelStackPlaybackRequest,
	signal: AbortSignal,
) => Promise<ProjectGraph | null>;

interface Registration {
	readonly factory: ParallelStackPlaybackFactory;
	readonly enabled: () => boolean;
	pending: AbortController | null;
}

const registrations = new WeakMap<object, Registration>();
const sourceStartTimes = new WeakMap<ProjectGraph, number>();
const workerCounts = new WeakMap<ProjectGraph, number>();
const endFrameWriters = new WeakMap<ProjectGraph, (frame: number) => void>();

export function registerParallelStackEndFrame(graph: ProjectGraph, write: (frame: number) => void): void {
	endFrameWriters.set(graph, write);
}

export function setParallelStackEndFrame(graph: ProjectGraph, frame: () => number): void {
	const write = endFrameWriters.get(graph);
	if (write && !graph.abortController.signal.aborted) write(frame());
}

export function setParallelStackSourceStartTime(graph: ProjectGraph, time: number, workerCount?: number): void {
	sourceStartTimes.set(graph, time);
	if (workerCount !== undefined) workerCounts.set(graph, workerCount);
}

export function parallelStackWorkerCount(graph: ProjectGraph): number | undefined { return workerCounts.get(graph); }

export function parallelStackSourceStartTime(graph: ProjectGraph, requestedTime: number): number {
	return Math.max(requestedTime, sourceStartTimes.get(graph) ?? requestedTime);
}

/** The owning controller supplies browser resources; render/export engines have no registration. */
export function registerParallelStackPlayback(engine: object, factory: ParallelStackPlaybackFactory, enabled: () => boolean = () => true): void {
	cancelParallelStackPreparation(engine);
	registrations.set(engine, { factory, enabled, pending: null });
}

export function parallelStackPlaybackEnabled(engine: object): boolean { return registrations.get(engine)?.enabled() ?? false; }

export function cancelParallelStackPreparation(engine: object): void {
	const registration = registrations.get(engine);
	registration?.pending?.abort();
	if (registration) registration.pending = null;
}

export async function prepareParallelStackPlayback(
	engine: object,
	request: ParallelStackPlaybackRequest,
): Promise<ProjectGraph | null> {
	const registration = registrations.get(engine);
	if (!registration) return null;
	registration.pending?.abort();
	const pending = new AbortController();
	registration.pending = pending;
	try {
		const graph = await registration.factory(request, pending.signal);
		if (pending.signal.aborted) graph?.abortController.abort();
		throwIfAborted(pending.signal);
		return graph;
	} finally {
		if (registration.pending === pending) registration.pending = null;
	}
}
