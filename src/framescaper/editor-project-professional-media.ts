/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeNativeMediaImageSequenceSourceV25,
} from '../common/editor/native-media-image-sequence-v25.ts';
import {
	normalizeVideoSourceCharacteristicsV25,
} from '../common/editor/video-source-professional-characteristics-v25.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsProfessionalMedia,
} from './editor-project-feature-requirements-professional-media.ts';
import {
	framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia,
	framescaperVideoSourceRateProfessionalMedia,
} from './editor-project-professional-media-foundation.ts';
import { assertFramescaperProjectProfessionalMediaCandidateProfile } from './editor-domain-runtime-profile.ts';
import { FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectVisual,
	createFramescaperProjectVisual,
	type FramescaperProjectVisualOptions,
} from './editor-project-visual.ts';
import {
	FRAMESCAPER_PROJECT_PROFESSIONAL_MEDIA_SCHEMA_VERSION,
	framescaperProjectVisualFoundationProfessionalMedia,
	normalizeFramescaperProjectProfessionalMediaProfessionalMedia,
	validateFramescaperProjectProfessionalMedia,
	type FramescaperProjectProfessionalMedia,
} from './editor-project-professional-media-validation.ts';

export {
	FRAMESCAPER_PROJECT_PROFESSIONAL_MEDIA_SCHEMA_VERSION,
	framescaperProjectVisualFoundationProfessionalMedia,
	normalizeFramescaperProjectProfessionalMediaProfessionalMedia,
	normalizeFramescaperProfessionalVideoSourceProfessionalMedia,
	validateFramescaperProjectProfessionalMedia,
	type FramescaperProfessionalVideoSourceProfessionalMedia,
	type FramescaperProjectProfessionalMedia,
} from './editor-project-professional-media-validation.ts';

export type FramescaperProjectProfessionalMediaOptions = FramescaperProjectVisualOptions;

export function createFramescaperProjectProfessionalMedia(
	profile: unknown,
	options: FramescaperProjectProfessionalMediaOptions = {},
): FramescaperProjectProfessionalMedia {
	assertFramescaperProjectProfessionalMediaCandidateProfile(profile);
	const input = structuredClone(options) as Record<string, unknown>;
	const professionalById = captureProfessionalState(input.sources);
	input.sources = recordsOrEmpty(input.sources).map((source) => {
		if (source.kind !== 'video') return source;
		delete source.imageSequence;
		if (source.characteristics !== undefined) {
			source.characteristics = framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia(source);
		}
		return source;
	});
	const project = createFramescaperProjectVisual(
		FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE,
		input as FramescaperProjectVisualOptions,
	) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_PROFESSIONAL_MEDIA_SCHEMA_VERSION;
	for (const source of records(project.sources, 'sources')) {
		if (source.kind !== 'video') continue;
		const state = professionalById.get(String(source.id));
		source.characteristics = normalizeVideoSourceCharacteristicsV25(
			state?.characteristics ?? source.characteristics,
			{ rate: framescaperVideoSourceRateProfessionalMedia(source) },
		);
		source.imageSequence = state?.imageSequence === undefined || state.imageSequence === null
			? null
			: normalizeNativeMediaImageSequenceSourceV25(state.imageSequence);
	}
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsProfessionalMedia(profile, project);
	validateFramescaperProjectProfessionalMedia(profile, project);
	return project as FramescaperProjectProfessionalMedia;
}

export function cloneFramescaperProjectProfessionalMedia(profile: unknown, project: unknown): FramescaperProjectProfessionalMedia {
	assertFramescaperProjectProfessionalMediaCandidateProfile(profile);
	validateFramescaperProjectProfessionalMedia(profile, project);
	const source = project as FramescaperProjectProfessionalMedia;
	const state = captureProfessionalState(source.sources);
	const clone = cloneFramescaperProjectVisual(
		FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE,
		framescaperProjectVisualFoundationProfessionalMedia(profile, source),
	) as unknown as Record<string, unknown>;
	clone.schemaVersion = FRAMESCAPER_PROJECT_PROFESSIONAL_MEDIA_SCHEMA_VERSION;
	clone.featureRequirements = structuredClone(source.featureRequirements);
	for (const value of records(clone.sources, 'sources')) {
		if (value.kind !== 'video') continue;
		const owned = state.get(String(value.id));
		if (!owned) throw new ReferenceError(`visual clone dropped professionalMedia source ${String(value.id)}.`);
		value.characteristics = structuredClone(owned.characteristics);
		value.imageSequence = structuredClone(owned.imageSequence);
	}
	normalizeFramescaperProjectProfessionalMediaProfessionalMedia(profile, clone);
	validateFramescaperProjectProfessionalMedia(profile, clone);
	return clone as FramescaperProjectProfessionalMedia;
}

interface ProfessionalState {
	readonly characteristics: unknown;
	readonly imageSequence: unknown;
}

function captureProfessionalState(value: unknown): ReadonlyMap<string, ProfessionalState> {
	const result = new Map<string, ProfessionalState>();
	for (const source of recordsOrEmpty(value)) {
		if (source.kind !== 'video') continue;
		const id = String(source.id);
		if (result.has(id)) throw new RangeError(`Duplicate professionalMedia source identity ${id}.`);
		result.set(id, Object.freeze({
			characteristics: structuredClone(source.characteristics ?? null),
			imageSequence: structuredClone(source.imageSequence ?? null),
		}));
	}
	return result;
}

function recordsOrEmpty(value: unknown): Record<string, unknown>[] {
	if (value === undefined) return [];
	return records(value, 'sources');
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
