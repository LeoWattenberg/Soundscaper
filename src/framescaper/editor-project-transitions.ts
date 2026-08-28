/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoTransitionCollectionV1,
} from '../common/editor/video-transition-v1.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsTransitions,
} from './editor-project-feature-requirements-transitions.ts';
import { FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectTransitionsCandidateProfile } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectRetime,
	createFramescaperProjectRetime,
	type FramescaperProjectRetimeOptions,
} from './editor-project-retime.ts';
import {
	FRAMESCAPER_PROJECT_TRANSITIONS_SCHEMA_VERSION,
	framescaperProjectProperOverlapsTransitions,
	framescaperProjectRetimeFoundationTransitions,
	validateFramescaperProjectTransitions,
	type FramescaperProjectTransitions,
} from './editor-project-transitions-validation.ts';

export {
	FRAMESCAPER_PROJECT_TRANSITIONS_SCHEMA_VERSION,
	validateFramescaperProjectTransitions,
	type FramescaperProjectTransitions,
} from './editor-project-transitions-validation.ts';

export type FramescaperProjectTransitionsOptions = FramescaperProjectRetimeOptions & Readonly<{
	readonly videoTransitionsByTrackId?: Readonly<Record<string, readonly unknown[]>>;
}>;

export function createFramescaperProjectTransitions(
	profile: unknown,
	options: FramescaperProjectTransitionsOptions = {},
): FramescaperProjectTransitions {
	assertFramescaperProjectTransitionsCandidateProfile(profile);
	const { videoTransitionsByTrackId = {}, ...foundationOptions } = options;
	const project = createFramescaperProjectRetime(
		FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
		foundationOptions,
	) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_TRANSITIONS_SCHEMA_VERSION;
	for (const track of records(project.tracks, 'tracks')) {
		if (track.type !== 'video') continue;
		const trackId = String(track.id);
		track.videoTransitions = structuredClone(videoTransitionsByTrackId[trackId] ?? []);
	}
	normalizeFramescaperProjectTransitionsTransitions(project);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsTransitions(profile, project);
	validateFramescaperProjectTransitions(profile, project);
	return project as FramescaperProjectTransitions;
}

export function cloneFramescaperProjectTransitions(
	profile: unknown,
	project: unknown,
): FramescaperProjectTransitions {
	assertFramescaperProjectTransitionsCandidateProfile(profile);
	validateFramescaperProjectTransitions(profile, project);
	const source = project as FramescaperProjectTransitions;
	const foundation = cloneFramescaperProjectRetime(
		FRAMESCAPER_RETIME_PROJECT_RUNTIME_PROFILE,
		framescaperProjectRetimeFoundationTransitions(profile, source),
	) as unknown as Record<string, unknown>;
	foundation.schemaVersion =  1;
	foundation.featureRequirements = structuredClone(source.featureRequirements);
	const transitions = new Map(source.tracks.filter((track) => track.type === 'video').map((track) => [
		String(track.id), structuredClone(track.videoTransitions),
	]));
	for (const track of records(foundation.tracks, 'tracks')) {
		if (track.type === 'video') track.videoTransitions = transitions.get(String(track.id)) ?? [];
	}
	normalizeFramescaperProjectTransitionsTransitions(foundation);
	validateFramescaperProjectTransitions(profile, foundation);
	return foundation as FramescaperProjectTransitions;
}

export function normalizeFramescaperProjectTransitionsTransitions(project: Record<string, unknown>): void {
	const overlaps = framescaperProjectProperOverlapsTransitions(project);
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
