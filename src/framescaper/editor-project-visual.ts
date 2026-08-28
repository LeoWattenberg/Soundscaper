/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	reconcileFramescaperProjectFeatureRequirementsVisual,
} from './editor-project-feature-requirements-visual.ts';
import { FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectVisualCandidateProfile } from './editor-domain-runtime-profile.ts';
import {
	createFramescaperProjectTransitions,
	type FramescaperProjectTransitionsOptions,
} from './editor-project-transitions.ts';
import {
	normalizeFramescaperProjectVisualModelsVisual,
	validateFramescaperProjectVisual,
	type FramescaperProjectVisual,
} from './editor-project-visual-validation.ts';

export {
	FRAMESCAPER_PROJECT_VISUAL_SCHEMA_VERSION,
	validateFramescaperProjectVisual,
	type FramescaperProjectVisual,
} from './editor-project-visual-validation.ts';

export interface FramescaperVisualModelInputVisual {
	readonly stillSources?: readonly unknown[];
	readonly generatorSources?: readonly unknown[];
	readonly adjustmentLayers?: readonly unknown[];
	readonly presets?: readonly unknown[];
	readonly maskMattes?: readonly unknown[];
	readonly freezeFallbacks?: readonly unknown[];
}

export type FramescaperProjectVisualOptions = FramescaperProjectTransitionsOptions & Readonly<{
	readonly visualModel?: FramescaperVisualModelInputVisual;
}>;

export function createFramescaperProjectVisual(
	profile: unknown,
	options: FramescaperProjectVisualOptions = {},
): FramescaperProjectVisual {
	assertFramescaperProjectVisualCandidateProfile(profile);
	const { visualModel = {}, ...v22Options } = structuredClone(options) as FramescaperProjectVisualOptions;
	const visualTimelineClips = recordArray(v22Options.clips).filter(isVisual);
	const visualBinClips = recordArray(v22Options.projectBin?.clips).filter(isVisual);
	const visualIds = new Set([...visualTimelineClips, ...visualBinClips].map(({ id }) => String(id)));
	const baseOptions = {
		...v22Options,
		sources: recordArray(v22Options.sources).filter((source) => !isVisual(source)),
		clips: recordArray(v22Options.clips).filter((clip) => !isVisual(clip)),
		projectBin: {
			...(v22Options.projectBin ?? {}),
			clips: recordArray(v22Options.projectBin?.clips).filter((clip) => !isVisual(clip)),
		},
		tracks: recordArray(v22Options.tracks).map((track) => ({
			...track,
			clipIds: Array.isArray(track.clipIds)
				? track.clipIds.filter((id) => !visualIds.has(String(id))) : track.clipIds,
		})),
	};
	const project = createFramescaperProjectTransitions(
		FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE,
		baseOptions,
	) as unknown as Record<string, unknown>;
	project.schemaVersion =  1;
	project.sources = [
		...recordArray(project.sources),
		...structuredClone(visualModel.stillSources ?? []),
		...structuredClone(visualModel.generatorSources ?? []),
	];
	project.clips = [...recordArray(project.clips), ...visualTimelineClips];
	const projectBin = project.projectBin as Record<string, unknown>;
	projectBin.clips = [...recordArray(projectBin.clips), ...visualBinClips];
	const originalTracks = new Map(recordArray(v22Options.tracks).map((track) => [String(track.id), track]));
	for (const track of recordArray(project.tracks)) {
		const original = originalTracks.get(String(track.id));
		if (original && Array.isArray(original.clipIds)) track.clipIds = structuredClone(original.clipIds);
	}
	project.videoAdjustmentLayers = structuredClone(visualModel.adjustmentLayers ?? []);
	project.videoVisualPresets = structuredClone(visualModel.presets ?? []);
	project.videoMaskMattes = structuredClone(visualModel.maskMattes ?? []);
	project.videoFreezeFallbacks = structuredClone(visualModel.freezeFallbacks ?? []);
	normalizeFramescaperProjectVisualModelsVisual(project);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsVisual(profile, project);
	validateFramescaperProjectVisual(profile, project);
	return project as FramescaperProjectVisual;
}

export function cloneFramescaperProjectVisual(profile: unknown, project: unknown): FramescaperProjectVisual {
	assertFramescaperProjectVisualCandidateProfile(profile);
	validateFramescaperProjectVisual(profile, project);
	const clone = structuredClone(project) as Record<string, unknown>;
	normalizeFramescaperProjectVisualModelsVisual(clone);
	validateFramescaperProjectVisual(profile, clone);
	return clone as FramescaperProjectVisual;
}

function isVisual(value: Record<string, unknown>): boolean {
	return value.kind === 'still' || value.kind === 'generator';
}

function recordArray(value: unknown): Record<string, unknown>[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new TypeError('visual project collections must be arrays.');
	return value.map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('visual collection item must be an object.');
		return item as Record<string, unknown>;
	});
}
