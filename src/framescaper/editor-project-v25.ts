/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeNativeMediaImageSequenceSourceV25,
} from '../common/editor/native-media-image-sequence-v25.ts';
import {
	normalizeVideoSourceCharacteristicsV25,
} from '../common/editor/video-source-professional-characteristics-v25.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV25,
} from './editor-project-feature-requirements-v25.ts';
import {
	framescaperVideoSourceCharacteristicsV24ProjectionV25,
	framescaperVideoSourceRateV25,
} from './editor-project-v25-foundation.ts';
import { readFramescaperProjectSchemaVersion, snapshotFramescaperOpaqueProject } from './editor-project-v18.ts';
import { assertFramescaperProjectV25CandidateProfile } from './editor-project-runtime-profile-v25.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v24.ts';
import {
	cloneFramescaperProjectV24,
	createFramescaperProjectV24,
	type FramescaperProjectV24Options,
} from './editor-project-v24.ts';
import {
	FRAMESCAPER_PROJECT_V25_SCHEMA_VERSION,
	framescaperProjectV24FoundationV25,
	normalizeFramescaperProjectProfessionalMediaV25,
	validateFramescaperProjectV25,
	type FramescaperProjectV25,
} from './editor-project-v25-validation.ts';

export {
	FRAMESCAPER_PROJECT_V25_SCHEMA_VERSION,
	framescaperProjectV24FoundationV25,
	normalizeFramescaperProjectProfessionalMediaV25,
	normalizeFramescaperProfessionalVideoSourceV25,
	validateFramescaperProjectV25,
	type FramescaperProfessionalVideoSourceV25,
	type FramescaperProjectV25,
} from './editor-project-v25-validation.ts';

export type FramescaperProjectV25Options = FramescaperProjectV24Options;

export interface LoadedFramescaperProjectV25 {
	readonly project: FramescaperProjectV25 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'newer-schema' | null;
}

export class FramescaperProjectV25ReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	constructor(readonly schemaVersion: number) {
		super(`Framescaper schema ${String(schemaVersion)} requires typed media re-import for V25.`);
		this.name = 'FramescaperProjectV25ReimportRequiredError';
	}
}

export function createFramescaperProjectV25(
	profile: unknown,
	options: FramescaperProjectV25Options = {},
): FramescaperProjectV25 {
	assertFramescaperProjectV25CandidateProfile(profile);
	const input = structuredClone(options) as Record<string, unknown>;
	const professionalById = captureProfessionalState(input.sources);
	input.sources = recordsOrEmpty(input.sources).map((source) => {
		if (source.kind !== 'video') return source;
		delete source.imageSequence;
		if (source.characteristics !== undefined) {
			source.characteristics = framescaperVideoSourceCharacteristicsV24ProjectionV25(source);
		}
		return source;
	});
	const project = createFramescaperProjectV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		input as FramescaperProjectV24Options,
	) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_V25_SCHEMA_VERSION;
	for (const source of records(project.sources, 'sources')) {
		if (source.kind !== 'video') continue;
		const state = professionalById.get(String(source.id));
		source.characteristics = normalizeVideoSourceCharacteristicsV25(
			state?.characteristics ?? source.characteristics,
			{ rate: framescaperVideoSourceRateV25(source) },
		);
		source.imageSequence = state?.imageSequence === undefined || state.imageSequence === null
			? null
			: normalizeNativeMediaImageSequenceSourceV25(state.imageSequence);
	}
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV25(profile, project);
	validateFramescaperProjectV25(profile, project);
	return project as FramescaperProjectV25;
}

export function cloneFramescaperProjectV25(profile: unknown, project: unknown): FramescaperProjectV25 {
	assertFramescaperProjectV25CandidateProfile(profile);
	validateFramescaperProjectV25(profile, project);
	const source = project as FramescaperProjectV25;
	const state = captureProfessionalState(source.sources);
	const clone = cloneFramescaperProjectV24(
		FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE,
		framescaperProjectV24FoundationV25(profile, source),
	) as unknown as Record<string, unknown>;
	clone.schemaVersion = FRAMESCAPER_PROJECT_V25_SCHEMA_VERSION;
	clone.featureRequirements = structuredClone(source.featureRequirements);
	for (const value of records(clone.sources, 'sources')) {
		if (value.kind !== 'video') continue;
		const owned = state.get(String(value.id));
		if (!owned) throw new ReferenceError(`V24 clone dropped V25 source ${String(value.id)}.`);
		value.characteristics = structuredClone(owned.characteristics);
		value.imageSequence = structuredClone(owned.imageSequence);
	}
	normalizeFramescaperProjectProfessionalMediaV25(profile, clone);
	validateFramescaperProjectV25(profile, clone);
	return clone as FramescaperProjectV25;
}

export function loadFramescaperProjectV25(profile: unknown, value: unknown): LoadedFramescaperProjectV25 {
	assertFramescaperProjectV25CandidateProfile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion < 25) throw new FramescaperProjectV25ReimportRequiredError(schemaVersion);
	if (schemaVersion > 25) return {
		project: snapshotFramescaperOpaqueProject(value), readOnly: true,
		intrinsicReadOnly: true, reason: 'newer-schema',
	};
	return {
		project: cloneFramescaperProjectV25(profile, value), readOnly: false,
		intrinsicReadOnly: false, reason: null,
	};
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
		if (result.has(id)) throw new RangeError(`Duplicate V25 source identity ${id}.`);
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
