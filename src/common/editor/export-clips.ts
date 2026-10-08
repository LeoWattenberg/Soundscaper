/* SPDX-License-Identifier: AGPL-3.0-only */

import { createExportChapterPlan } from './export-chapters.ts';
import { projectForRuntimeConsumers } from './project-current-runtime.ts';
import { brandRuntimeProjectProjection, type RuntimeClipProject } from './runtime-clip-projection.ts';
import { inheritTrackFolderMediaStateProjectionV12 } from './track-folder-media-runtime.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import type { ProjectFeatureRequirementsManifest } from './project-feature-requirements.ts';
import { exportClipMixer } from './export-clip-mixer.ts';
import { mixerEndpointKeyV21, type MixerGraphV21 } from './mixer-graph-v21.ts';
import { hasProductionMixerProjectAuthority } from './project-schema-version.ts';
import { normalizeAutomationLaneV21 } from './automation-lane-v21.ts';

type DataRecord = Readonly<Record<string, unknown>>;

/**
 * Isolate a clip after the caller has projected its track as a stem. Keeping the
 * mixer and track identities preserves graph references; retiring other clip
 * memberships stops overlapping clips and automatic crossfades entering its file.
 */
export function createExportClipProject<Project extends object>(projectValue: Project, output: DataRecord): Project {
	const project = inheritTrackFolderMediaStateProjectionV12(projectValue, projectForRuntimeConsumers(projectValue as RuntimeClipProject));
	const clip = project.clips.find((candidate) => candidate.id === output.clipId
		&& (candidate.kind === undefined || candidate.kind === 'audio'));
	const owner = project.tracks.find((candidate) => {
		const track = candidate as DataRecord;
		return track.id === output.trackId && track.type === 'audio'
			&& Array.isArray(track.clipIds) && track.clipIds.includes(output.clipId);
	});
	if (!clip || !owner) throw new RangeError(`Export clip ${String(output.clipId)} is missing from its audio track.`);
	const mixer = hasProductionMixerProjectAuthority(project)
		? exportClipMixer(project.mixer as MixerGraphV21, String(output.trackId)) : null;
	const lanes = (project as DataRecord).automationLanes;
	const clipIds = new Set([clip.id]);
	for (const value of project.tracks) {
		const track = value as DataRecord;
		if (track.id === output.trackId || track.type !== 'audio'
			|| !mixer?.detectorStrips.has(mixerEndpointKeyV21({ kind: 'track', id: String(track.id) }))) continue;
		for (const id of Array.isArray(track.clipIds) ? track.clipIds : []) clipIds.add(id);
	}
	const snapshot = {
		...project,
		...(mixer ? { mixer: mixer.graph, automationLanes: (Array.isArray(lanes) ? lanes : []).filter(value => {
			const { address } = normalizeAutomationLaneV21(value);
			return address.kind !== 'edge' || mixer.retainedEdges.has(address.edgeId);
		}) } : {}),
		clips: project.clips.filter(candidate => clipIds.has(candidate.id)),
		tracks: project.tracks.map((value) => {
			const track = value as DataRecord;
			return { ...track, clipIds: Array.isArray(track.clipIds) ? track.clipIds.filter(id => clipIds.has(id)) : [] };
		}),
		projectBin: { ...project.projectBin, clips: [] },
	};
	if ('featureRequirements' in snapshot && snapshot.featureRequirements) {
		snapshot.featureRequirements = reconcileProjectOwnedFeatureRequirements(
			snapshot, snapshot.featureRequirements as ProjectFeatureRequirementsManifest,
		);
	}
	return brandRuntimeProjectProjection(inheritTrackFolderMediaStateProjectionV12(project, snapshot)) as unknown as Project;
}

/** The render and conformance plan for one clip's own duration and metadata. */
export function createExportClipPlan<Plan extends DataRecord>(plan: Plan, output: DataRecord): Plan {
	const outputFrames = Number(output.outputFrames);
	const channelCount = Number(plan.channelCount);
	const outputBytesPerRender = outputFrames * channelCount * Float32Array.BYTES_PER_ELEMENT;
	if (!Number.isSafeInteger(outputBytesPerRender) || outputBytesPerRender <= 0) {
		throw new RangeError('A clip output must state a safe positive PCM byte size.');
	}
	return Object.freeze({
		...createExportChapterPlan(plan, output),
		outputBytesPerRender,
	}) as Plan;
}
