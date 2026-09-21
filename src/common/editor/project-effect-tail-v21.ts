/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	hasProductionMixerProjectAuthority,
} from './project-schema-version.ts';
import {
	normalizeMixerGraphV21,
} from './mixer-graph-v21.ts';
import { createMixerSignalTopologyV21 } from './mixer-signal-topology-v21.ts';

interface EffectRackOwner {
	readonly effectsActive?: unknown;
	readonly effects?: readonly Readonly<Record<string, unknown>>[];
}

interface EffectTailTrack extends EffectRackOwner {
	readonly id?: unknown;
	readonly type?: unknown;
}

interface EffectTailProject extends Readonly<Record<string, unknown>> {
	readonly tracks?: readonly EffectTailTrack[];
	readonly master?: EffectRackOwner;
	readonly mixer?: unknown;
}

interface ProjectEffectTailV21Options {
	readonly trackId: unknown;
	readonly includeMaster: boolean;
	readonly maximum: number;
	readonly rackTail: (owner: EffectRackOwner | null | undefined) => number;
}

const NO_OUTPUT_PATH = -1;

/** Resolve the longest audible insert path in an explicit production mixer. */
export function projectEffectTailFramesV21(
	project: EffectTailProject | null | undefined,
	options: ProjectEffectTailV21Options,
): number | null {
	if (!project || !hasProductionMixerProjectAuthority(project)) return null;
	const graph = normalizeMixerGraphV21(project.mixer);
	const mainOutputId = graph.outputs.find(({ role }) => role === 'main')?.id;
	if (!mainOutputId) return 0;

	const nodeTails = new Map<string, number>();
	const trackKeys: string[] = [];
	for (const track of project.tracks ?? []) {
		if (track?.type !== 'audio' || typeof track.id !== 'string') continue;
		if (options.trackId != null && track.id !== String(options.trackId)) continue;
		const key = `track:${track.id}`;
		trackKeys.push(key);
		nodeTails.set(key, options.rackTail(track));
	}
	for (const strip of [...graph.groups, ...graph.sends, ...graph.cues]) {
		nodeTails.set(`mixer-node:${strip.id}`, options.rackTail(strip));
	}
	nodeTails.set('master', options.includeMaster ? options.rackTail(project.master) : 0);

	const topology = createMixerSignalTopologyV21(graph, { includeOutputs: true });
	const mainOutputKey = `output:${mainOutputId}`;

	const cache = new Map<string, number>();
	const visiting = new Set<string>();
	const tailFrom = (key: string): number => {
		const cached = cache.get(key);
		if (cached !== undefined) return cached;
		if (visiting.has(key)) return NO_OUTPUT_PATH;
		visiting.add(key);
		let continuation = NO_OUTPUT_PATH;
		for (const destination of topology.successors(key)) {
			const destinationTail = destination.startsWith('output:')
				? destination === mainOutputKey ? 0 : NO_OUTPUT_PATH
				: tailFrom(destination);
			continuation = Math.max(continuation, destinationTail);
		}
		visiting.delete(key);
		const result = continuation === NO_OUTPUT_PATH
			? NO_OUTPUT_PATH
			: Math.min(options.maximum, (nodeTails.get(key) ?? 0) + continuation);
		cache.set(key, result);
		return result;
	};

	return Math.min(options.maximum, trackKeys.reduce(
		(longest, key) => Math.max(longest, tailFrom(key)),
		0,
	));
}
