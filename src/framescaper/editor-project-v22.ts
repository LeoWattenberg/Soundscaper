/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoTransitionCollectionV1,
} from '../common/editor/video-transition-v1.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV22,
} from './editor-project-feature-requirements-v22.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';
import { assertFramescaperProjectV22CandidateProfile } from './editor-project-runtime-profile-v22.ts';
import {
	readFramescaperProjectSchemaVersion,
	snapshotFramescaperOpaqueProject,
} from './editor-project-v18.ts';
import {
	cloneFramescaperProjectV20,
	createFramescaperProjectV20,
	type FramescaperProjectV20Options,
} from './editor-project-v20.ts';
import {
	FRAMESCAPER_PROJECT_V22_SCHEMA_VERSION,
	framescaperProjectProperOverlapsV22,
	framescaperProjectV20FoundationV22,
	validateFramescaperProjectV22,
	type FramescaperProjectV22,
} from './editor-project-v22-validation.ts';

export {
	FRAMESCAPER_PROJECT_V22_SCHEMA_VERSION,
	validateFramescaperProjectV22,
	type FramescaperProjectV22,
} from './editor-project-v22-validation.ts';

export type FramescaperProjectV22Options = FramescaperProjectV20Options & Readonly<{
	readonly videoTransitionsByTrackId?: Readonly<Record<string, readonly unknown[]>>;
}>;

export interface LoadedFramescaperProjectV22 {
	readonly project: FramescaperProjectV22 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'newer-schema' | null;
}

export class FramescaperProjectV22ReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	constructor(readonly schemaVersion: number) {
		super(`Framescaper schema ${String(schemaVersion)} requires typed media re-import for V22.`);
		this.name = 'FramescaperProjectV22ReimportRequiredError';
	}
}

export function createFramescaperProjectV22(
	profile: unknown,
	options: FramescaperProjectV22Options = {},
): FramescaperProjectV22 {
	assertFramescaperProjectV22CandidateProfile(profile);
	const { videoTransitionsByTrackId = {}, ...foundationOptions } = options;
	const project = createFramescaperProjectV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
		foundationOptions,
	) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_V22_SCHEMA_VERSION;
	for (const track of records(project.tracks, 'tracks')) {
		if (track.type !== 'video') continue;
		const trackId = String(track.id);
		track.videoTransitions = structuredClone(videoTransitionsByTrackId[trackId] ?? []);
	}
	normalizeFramescaperProjectTransitionsV22(project);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV22(profile, project);
	validateFramescaperProjectV22(profile, project);
	return project as FramescaperProjectV22;
}

export function cloneFramescaperProjectV22(
	profile: unknown,
	project: unknown,
): FramescaperProjectV22 {
	assertFramescaperProjectV22CandidateProfile(profile);
	validateFramescaperProjectV22(profile, project);
	const source = project as FramescaperProjectV22;
	const foundation = cloneFramescaperProjectV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE,
		framescaperProjectV20FoundationV22(profile, source),
	) as unknown as Record<string, unknown>;
	foundation.schemaVersion = 22;
	foundation.featureRequirements = structuredClone(source.featureRequirements);
	const transitions = new Map(source.tracks.filter((track) => track.type === 'video').map((track) => [
		String(track.id), structuredClone(track.videoTransitions),
	]));
	for (const track of records(foundation.tracks, 'tracks')) {
		if (track.type === 'video') track.videoTransitions = transitions.get(String(track.id)) ?? [];
	}
	normalizeFramescaperProjectTransitionsV22(foundation);
	validateFramescaperProjectV22(profile, foundation);
	return foundation as FramescaperProjectV22;
}

export function loadFramescaperProjectV22(profile: unknown, value: unknown): LoadedFramescaperProjectV22 {
	assertFramescaperProjectV22CandidateProfile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion < 22) throw new FramescaperProjectV22ReimportRequiredError(schemaVersion);
	if (schemaVersion > 22) return {
		project: snapshotFramescaperOpaqueProject(value),
		readOnly: true,
		intrinsicReadOnly: true,
		reason: 'newer-schema',
	};
	return {
		project: cloneFramescaperProjectV22(profile, value),
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	};
}

export function normalizeFramescaperProjectTransitionsV22(project: Record<string, unknown>): void {
	const overlaps = framescaperProjectProperOverlapsV22(project);
	const startsByTrack = new Map<string, Map<string, number>>();
	for (const overlap of overlaps) {
		const transitionValues = records(project.tracks, 'tracks')
			.find((track) => track.id === overlap.trackId)?.videoTransitions;
		if (!Array.isArray(transitionValues)) continue;
		for (const value of transitionValues) {
			const transition = value as Readonly<Record<string, unknown>>;
			if (transition.outgoingClipId !== overlap.outgoing.id
				|| transition.incomingClipId !== overlap.incoming.id) continue;
			let starts = startsByTrack.get(overlap.trackId);
			if (!starts) {
				starts = new Map();
				startsByTrack.set(overlap.trackId, starts);
			}
			starts.set(String(transition.id), overlap.start);
		}
	}
	for (const track of records(project.tracks, 'tracks')) {
		if (track.type !== 'video') {
			delete track.videoTransitions;
			continue;
		}
		track.videoTransitions = normalizeVideoTransitionCollectionV1(
			track.videoTransitions,
			startsByTrack.get(String(track.id)) ?? new Map(),
			`Framescaper video track ${String(track.id)}.videoTransitions`,
		);
	}
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new TypeError(`${name}[${String(index)}] must be an object.`);
		}
		return item as Record<string, unknown>;
	});
}
