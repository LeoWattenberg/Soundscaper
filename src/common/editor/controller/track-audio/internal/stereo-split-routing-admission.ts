/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import { defaultMixerChannelMapV21, normalizeMixerGraphV21, type MixerGraphV21 }
	from '../../../mixer-graph-v21.ts';
import { isSoundscaperProductionProject } from '../../../project-schema-version.ts';
import { resolveTerminalChannelWidths } from '../../../terminal-channel-widths.ts';
import type { ControllerProject } from '../track-domain-types.ts';

/** Mono panners cannot preserve an arbitrary stereo channel origin on each copied edge. */
export function assertStereoSplitRoutingRepresentable(
	project: ControllerProject,
	trackId: string,
	copy: object,
): void {
	if (!isSoundscaperProductionProject(project)) return;
	const graph = normalizeMixerGraphV21(project.mixer as unknown as MixerGraphV21);
	const sourceWidth = resolveTerminalChannelWidths(project, Number(project.masterChannels)).tracks.get(trackId) ?? 2;
	for (const edge of graph.edges) {
		if (edge.source.kind !== 'track' || edge.source.id !== trackId
			|| edge.channelMap.every(channel => channel === -1)) continue;
		const defaultMap = defaultMixerChannelMapV21(sourceWidth, edge.channelMap.length);
		if (edge.channelMap.every((channel, index) => channel === defaultMap[index])) continue;
		throw createLocalizedError(RangeError, copy, 'stereoSplitCustomRoutingRequiresReset');
	}
}
