/* SPDX-License-Identifier: AGPL-3.0-only */

import { defaultMixerChannelMapV21, normalizeMixerGraphV21, type MixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import type { DawprojectImportRoutingContext } from '../common/editor/dawproject-import-structure.ts';
import type { AudioEditorProjectV17 } from '../common/editor/project-v17.ts';
import { applySoundscaperMixerSurfaceCommand } from './editor-project-mixer-surface.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';

/** Promote validated flat interchange buses and routes through the owning graph adapter. */
export function importSoundscaperAudacityMixer(decoded: AudioEditorProjectV17, project: SoundscaperProject, context?: DawprojectImportRoutingContext): MixerGraphV21 {
	let mixer = project.mixer;
	for (const [kind, buses] of [['group', decoded.mixer.groups], ['send', decoded.mixer.sends]] as const) {
		for (const bus of buses) {
			const changes: Record<string, unknown> = {};
			for (const field of ['name', 'color', 'gain', 'pan', 'mute', 'solo', 'collapsed', 'effectsActive']) {
				if (Object.hasOwn(bus, field)) changes[field] = bus[field as keyof typeof bus];
			}
			const existing = (kind === 'group' ? mixer.groups : mixer.sends).some(value => value.id === bus.id);
			mixer = applySoundscaperMixerSurfaceCommand({ ...project, mixer }, existing
				? { type: 'mixer/bus-update', busType: kind, busId: bus.id, changes }
				: { type: 'mixer/bus-add', busType: kind, bus: { id: bus.id, ...changes } });
			const channelCount = context?.stripChannelCounts?.find(strip => strip.id === bus.id)?.channelCount;
			if (channelCount !== undefined) {
				const collection = kind === 'group' ? 'groups' : 'sends';
				mixer = normalizeMixerGraphV21({ ...mixer,
					[collection]: mixer[collection].map(strip => strip.id === bus.id ? { ...strip, channelCount } : strip),
					edges: mixer.edges.map(edge => edge.source.kind === 'mixer-node' && edge.source.id === bus.id
						&& edge.destination.kind === 'master'
						? { ...edge, channelMap: defaultMixerChannelMapV21(channelCount, project.masterChannels) } : edge),
				});
			}
		}
	}
	for (const [trackId, route] of Object.entries(decoded.mixer.routes)) {
		mixer = applySoundscaperMixerSurfaceCommand({ ...project, mixer }, {
			type: 'mixer/route-update', trackId, changes: { groupId: route.groupId, sends: route.sends },
		});
	}
	if (!context?.sendTaps.length) return mixer;
	return normalizeMixerGraphV21({ ...mixer, edges: mixer.edges.map(edge => {
		if (edge.kind !== 'send' || edge.source.kind !== 'track' || edge.destination.kind !== 'mixer-node') return edge;
		const tap = context.sendTaps.find(({ trackId, sendId }) => (
			edge.source.kind === 'track' && edge.source.id === trackId
			&& edge.destination.kind === 'mixer-node' && edge.destination.id === sendId
		));
		return tap ? { ...edge, position: tap.position } : edge;
	}) });
}
