/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDefaultMixerGraphV21, type MixerGraphV21 } from '../mixer-graph-v21.ts';
import {
	hasProductionMixerProjectAuthority,
} from '../project-schema-version.ts';
import type { ProjectFeatureRequirementsManifest } from '../project-feature-requirements.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../track-folder-media-runtime.ts';
import { resolveTerminalChannelWidths } from '../terminal-channel-widths.ts';
import { projectTransientRenderFeatures } from './transient-render-feature-projection.ts';

interface IsolatedTrackRenderTrackV21 extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: 'audio' | 'video' | 'label';
	readonly clipIds: readonly string[];
}

export interface IsolatedTrackRenderProjectV21 extends Readonly<Record<string, unknown>> {
	readonly schemaVersion: number;
	readonly featureRequirements: ProjectFeatureRequirementsManifest;
	readonly masterChannels: number;
	readonly tracks: readonly IsolatedTrackRenderTrackV21[];
	readonly mixer: MixerGraphV21;
	readonly automationLanes: readonly unknown[];
}

export interface IsolatedTrackRenderRequestV21 {
	readonly trackId: string;
	readonly effects: readonly Readonly<Record<string, unknown>>[];
	readonly clipIds?: readonly string[] | null;
	readonly preserveTrackProcessing?: boolean;
}

/**
 * Create an engine-only V21 projection for one pre-master track render.
 * The authored project and mixer remain untouched; the projection owns one
 * closed V21 route and no automation capable of changing that neutral path.
 */
export function createIsolatedTrackRenderProjectV21(
	authored: IsolatedTrackRenderProjectV21,
	request: IsolatedTrackRenderRequestV21,
): IsolatedTrackRenderProjectV21 {
	if (!hasProductionMixerProjectAuthority(authored)) {
		throw new TypeError('An exact production mixer V21 project is required.');
	}
	// Flatten folder state onto the leaves before narrowing to one track. The
	// projection is engine-only and keeps the authored folders and sequence
	// nodes, so a hierarchy that still names the tracks this projection drops is
	// one the engine refuses to load; deriving it once here and inheriting that
	// derivation is what the mix render already does for the same reason.
	const project = projectTrackFolderMediaStateV12(authored) as IsolatedTrackRenderProjectV21;
	const selected = project.tracks.find((track) => track.id === request.trackId && track.type === 'audio');
	if (!selected) throw new ReferenceError(`The V21 render track ${request.trackId} does not exist.`);
	const widths = resolveTerminalChannelWidths(project, project.masterChannels).tracks;
	const requestedClipIds = request.clipIds?.length ? new Set(request.clipIds) : null;
	const track: Record<string, unknown> = request.preserveTrackProcessing ? {
		...selected,
		clipIds: requestedClipIds
			? selected.clipIds.filter((clipId) => requestedClipIds.has(clipId))
			: [...selected.clipIds],
	} : {
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
	if (!request.preserveTrackProcessing) delete track.envelope;
	const isolated = {
		...project,
		tracks: [track as IsolatedTrackRenderTrackV21],
		// A dry projection owns no lanes; an authored projection keeps only the
		// selected strip's processing and cannot address removed mixer authority.
		automationLanes: request.preserveTrackProcessing
			? project.automationLanes.filter((lane) => laneTargetsTrack(lane, request.trackId))
			: [],
		mixer: createDefaultMixerGraphV21([{
			id: request.trackId,
			channelCount: widths.get(request.trackId) ?? project.masterChannels,
		}], project.masterChannels),
	};
	projectTransientRenderFeatures(isolated);
	return inheritTrackFolderMediaStateProjectionV12(project, isolated);
}

function laneTargetsTrack(value: unknown, trackId: string): boolean {
	if (!value || typeof value !== 'object') return false;
	const address = (value as Readonly<{ address?: unknown }>).address;
	if (!address || typeof address !== 'object') return false;
	const candidate = address as Readonly<{ kind?: unknown; strip?: unknown }>;
	if (candidate.kind !== 'strip' && candidate.kind !== 'effect') return false;
	const strip = candidate.strip as Readonly<{ kind?: unknown; id?: unknown }> | null;
	return strip?.kind === 'track' && strip.id === trackId;
}
