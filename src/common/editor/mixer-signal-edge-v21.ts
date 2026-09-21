/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MixerEdgeV21, MixerEndpointV21 } from './mixer-graph-v21.ts';

export function mixerEndpointKeyV21(endpoint: MixerEndpointV21): string {
	return endpoint.kind === 'master' ? 'master' : `${endpoint.kind}:${endpoint.id}`;
}

export function mixerChannelMapCarriesSignalV21(value: readonly number[]): boolean {
	return value.length === 0 || value.some((source) => source !== -1);
}

export function mixerEdgeCarriesSignalV21(
	edge: Pick<MixerEdgeV21, 'enabled' | 'channelMap'>,
): boolean {
	return edge.enabled !== false && mixerChannelMapCarriesSignalV21(edge.channelMap);
}
