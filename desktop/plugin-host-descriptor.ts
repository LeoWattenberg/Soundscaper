/* SPDX-License-Identifier: AGPL-3.0-only */

import type { HelperPluginFormat } from './helper-job-grant.ts';

/** Main-private identity needed to bind a hosted instance into project state. */
export interface PluginHostDescriptor {
	readonly entryId: string;
	readonly installationId: string;
	readonly stableId: string;
	readonly format: HelperPluginFormat;
	readonly binarySha256: string;
	readonly inputChannels: number;
	readonly outputChannels: number;
	readonly reportedLatencyFrames: number | null;
}

export function createPluginHostDescriptor(
	descriptor: PluginHostDescriptor,
): Readonly<PluginHostDescriptor> {
	return Object.freeze({ ...descriptor });
}

export function selectPluginHostTopology(value: Readonly<{
	readonly topologies: readonly Readonly<{ inputChannels: number; outputChannels: number }>[];
}>): Readonly<{ inputChannels: number; outputChannels: number }> | null {
	const candidates = value.topologies.filter(({ inputChannels, outputChannels }) => (
		inputChannels >= 1 && inputChannels <= 32 && outputChannels >= 1 && outputChannels <= 32
	));
	candidates.sort((left, right) => topologyRank(left) - topologyRank(right)
		|| Math.abs(left.inputChannels - left.outputChannels) - Math.abs(right.inputChannels - right.outputChannels)
		|| left.inputChannels - right.inputChannels || left.outputChannels - right.outputChannels);
	return candidates[0] ?? null;
}

function topologyRank(topology: Readonly<{ inputChannels: number; outputChannels: number }>): number {
	if (topology.inputChannels === 2 && topology.outputChannels === 2) return 0;
	return topology.inputChannels === topology.outputChannels ? 1 : 2;
}
