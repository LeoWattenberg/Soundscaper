/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from '../../../automation-lane-v21.ts';
import { exportClipMixer } from '../../../export-clip-mixer.ts';
import { mixerEndpointKeyV21, normalizeMixerGraphV21, type MixerGraphV21 } from '../../../mixer-graph-v21.ts';
import type { ProjectFeatureRequirementsManifest } from '../../../project-feature-requirements.ts';
import { projectTransientRenderFeatures } from '../../shared/transient-render-feature-projection.ts';

interface MutableProductionStemProject {
	featureRequirements: ProjectFeatureRequirementsManifest;
	master: Record<string, unknown>;
	mixer: MixerGraphV21;
	automationLanes: unknown[];
	tracks: Readonly<Record<string, unknown>>[];
}

/** Keep authored detector feeds, with no detector or unrelated programme at the output. */
export function projectProductionStemSnapshot(value: unknown, trackId: string): void {
	const project = value as MutableProductionStemProject;
	const graph = normalizeMixerGraphV21(project.mixer);
	const edges = graph.edges.filter(edge => !(edge.destination.kind === 'effect-sidechain'
		&& edge.destination.strip.kind === 'master'));
	const isolation = exportClipMixer(normalizeMixerGraphV21({ ...graph, edges }), trackId);
	project.tracks = project.tracks.map(track => ({ ...track, solo: false,
		mute: track.id === trackId ? false : isolation.detectorStrips.has(mixerEndpointKeyV21({
			kind: 'track', id: String(track.id),
		})) ? track.mute === true : true,
	}));
	project.mixer = isolation.graph;
	project.automationLanes = project.automationLanes.filter(value => {
		const { address } = normalizeAutomationLaneV21(value);
		if (address.kind === 'edge') return isolation.retainedEdges.has(address.edgeId);
		return address.strip.kind !== 'master';
	});
	project.master = { ...project.master, gain: 1, pan: 0, mute: false, solo: false,
		effectsActive: false, effects: [] };
	projectTransientRenderFeatures(project);
}
