/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDefaultMixerGraphV21, type MixerGraphV21 } from '../mixer-graph-v21.ts';
import {
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	isSoundscaperProductionProjectSchema,
} from '../project-schema-version.ts';
import { resolveTerminalChannelWidths } from '../terminal-channel-widths.ts';

interface IsolatedTrackRenderTrackV21 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly clipIds: readonly string[];
}

export interface IsolatedTrackRenderProjectV21 extends Readonly<Record<string, unknown>> {
	readonly schemaVersion: typeof SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION;
	readonly masterChannels: number;
	readonly tracks: readonly IsolatedTrackRenderTrackV21[];
	readonly mixer: MixerGraphV21;
	readonly automationLanes: readonly unknown[];
}

export interface IsolatedTrackRenderRequestV21 {
	readonly trackId: string;
	readonly effects: readonly Readonly<Record<string, unknown>>[];
	readonly clipIds?: readonly string[] | null;
}

/**
 * Create an engine-only V21 projection for one pre-master track render.
 * The authored project and mixer remain untouched; the projection owns one
 * closed V21 route and no automation capable of changing that neutral path.
 */
export function createIsolatedTrackRenderProjectV21(
	project: IsolatedTrackRenderProjectV21,
	request: IsolatedTrackRenderRequestV21,
): IsolatedTrackRenderProjectV21 {
	if (!isSoundscaperProductionProjectSchema(project.schemaVersion)) {
		throw new TypeError('An exact Soundscaper V21 project is required.');
	}
	const selected = project.tracks.find((track) => track.id === request.trackId && track.type === 'audio');
	if (!selected) throw new ReferenceError(`The V21 render track ${request.trackId} does not exist.`);
	const widths = resolveTerminalChannelWidths(project, project.masterChannels).tracks;
	const requestedClipIds = request.clipIds?.length ? new Set(request.clipIds) : null;
	const track: Record<string, unknown> = {
		...selected,
		clipIds: requestedClipIds
			? selected.clipIds.filter((clipId) => requestedClipIds.has(clipId))
			: [...selected.clipIds],
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
		effectsActive: request.effects.length > 0,
		effects: request.effects.map((effect) => ({ ...effect })),
	};
	delete track.envelope;
	return {
		...project,
		tracks: [track as IsolatedTrackRenderTrackV21],
		// Every authored lane either targets removed authority or could reactivate
		// a neutral strip/edge. The engine-only graph therefore owns no lanes.
		automationLanes: [],
		mixer: createDefaultMixerGraphV21([{
			id: request.trackId,
			channelCount: widths.get(request.trackId) ?? project.masterChannels,
		}], project.masterChannels),
	};
}
