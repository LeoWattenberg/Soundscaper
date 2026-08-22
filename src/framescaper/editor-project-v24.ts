/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	reconcileFramescaperProjectFeatureRequirementsV24,
} from './editor-project-feature-requirements-v24.ts';
import { readFramescaperProjectSchemaVersion, snapshotFramescaperOpaqueProject } from './editor-project-v18.ts';
import { FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v22.ts';
import { assertFramescaperProjectV24CandidateProfile } from './editor-project-runtime-profile-v24.ts';
import {
	createFramescaperProjectV22,
	type FramescaperProjectV22Options,
} from './editor-project-v22.ts';
import {
	normalizeFramescaperProjectVisualModelsV24,
	validateFramescaperProjectV24,
	type FramescaperProjectV24,
} from './editor-project-v24-validation.ts';

export {
	FRAMESCAPER_PROJECT_V24_SCHEMA_VERSION,
	validateFramescaperProjectV24,
	type FramescaperProjectV24,
} from './editor-project-v24-validation.ts';

export interface FramescaperVisualModelInputV24 {
	readonly stillSources?: readonly unknown[];
	readonly generatorSources?: readonly unknown[];
	readonly adjustmentLayers?: readonly unknown[];
	readonly presets?: readonly unknown[];
	readonly maskMattes?: readonly unknown[];
	readonly freezeFallbacks?: readonly unknown[];
}

export type FramescaperProjectV24Options = FramescaperProjectV22Options & Readonly<{
	readonly visualModel?: FramescaperVisualModelInputV24;
}>;

export interface LoadedFramescaperProjectV24 {
	readonly project: FramescaperProjectV24 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'newer-schema' | null;
}

export class FramescaperProjectV24ReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	constructor(readonly schemaVersion: number) {
		super(`Framescaper schema ${String(schemaVersion)} requires typed media re-import for V24.`);
		this.name = 'FramescaperProjectV24ReimportRequiredError';
	}
}

export function createFramescaperProjectV24(
	profile: unknown,
	options: FramescaperProjectV24Options = {},
): FramescaperProjectV24 {
	assertFramescaperProjectV24CandidateProfile(profile);
	const { visualModel = {}, ...v22Options } = structuredClone(options) as FramescaperProjectV24Options;
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
	const project = createFramescaperProjectV22(
		FRAMESCAPER_V22_PROJECT_CANDIDATE_PROFILE,
		baseOptions,
	) as unknown as Record<string, unknown>;
	project.schemaVersion = 24;
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
	normalizeFramescaperProjectVisualModelsV24(project);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV24(profile, project);
	validateFramescaperProjectV24(profile, project);
	return project as FramescaperProjectV24;
}

export function cloneFramescaperProjectV24(profile: unknown, project: unknown): FramescaperProjectV24 {
	assertFramescaperProjectV24CandidateProfile(profile);
	validateFramescaperProjectV24(profile, project);
	const clone = structuredClone(project) as Record<string, unknown>;
	normalizeFramescaperProjectVisualModelsV24(clone);
	validateFramescaperProjectV24(profile, clone);
	return clone as FramescaperProjectV24;
}

export function loadFramescaperProjectV24(profile: unknown, value: unknown): LoadedFramescaperProjectV24 {
	assertFramescaperProjectV24CandidateProfile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion < 24) throw new FramescaperProjectV24ReimportRequiredError(schemaVersion);
	if (schemaVersion > 24) return {
		project: snapshotFramescaperOpaqueProject(value), readOnly: true,
		intrinsicReadOnly: true, reason: 'newer-schema',
	};
	return {
		project: cloneFramescaperProjectV24(profile, value), readOnly: false,
		intrinsicReadOnly: false, reason: null,
	};
}

function isVisual(value: Record<string, unknown>): boolean {
	return value.kind === 'still' || value.kind === 'generator';
}

function recordArray(value: unknown): Record<string, unknown>[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new TypeError('V24 project collections must be arrays.');
	return value.map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('V24 collection item must be an object.');
		return item as Record<string, unknown>;
	});
}
