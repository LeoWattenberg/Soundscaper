/* SPDX-License-Identifier: AGPL-3.0-only */

import type { OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV26,
} from './editor-project-feature-requirements-v26.ts';
import { readFramescaperProjectSchemaVersion, snapshotFramescaperOpaqueProject } from './editor-project-v18.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v25.ts';
import { assertFramescaperProjectV26CandidateProfile } from './editor-project-runtime-profile-v26.ts';
import {
	createFramescaperProjectV25,
	type FramescaperProjectV25Options,
} from './editor-project-v25.ts';
import {
	FRAMESCAPER_PROJECT_V26_SCHEMA_VERSION,
	validateFramescaperProjectV26,
	type FramescaperProjectV26,
} from './editor-project-v26-validation.ts';

export {
	FRAMESCAPER_PROJECT_V26_SCHEMA_VERSION,
	validateFramescaperProjectV26,
	type FramescaperProjectV26,
} from './editor-project-v26-validation.ts';

export type FramescaperProjectV26Options = FramescaperProjectV25Options & Readonly<{
	readonly ofxEffects?: readonly OfxEffectStateV26[];
}>;

export interface LoadedFramescaperProjectV26 {
	readonly project: FramescaperProjectV26 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'newer-schema' | null;
}

export class FramescaperProjectV26ReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	constructor(readonly schemaVersion: number) {
		super(`Framescaper schema ${String(schemaVersion)} requires typed media re-import for V26.`);
		this.name = 'FramescaperProjectV26ReimportRequiredError';
	}
}

export function createFramescaperProjectV26(
	profile: unknown,
	options: FramescaperProjectV26Options = {},
): FramescaperProjectV26 {
	assertFramescaperProjectV26CandidateProfile(profile);
	const { ofxEffects = [], ...v25Options } = options;
	const project = createFramescaperProjectV25(
		FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE,
		v25Options,
	) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_V26_SCHEMA_VERSION;
	project.ofxEffects = structuredClone(ofxEffects);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV26(profile, project);
	validateFramescaperProjectV26(profile, project);
	return project as FramescaperProjectV26;
}

export function cloneFramescaperProjectV26(
	profile: unknown,
	project: unknown,
): FramescaperProjectV26 {
	assertFramescaperProjectV26CandidateProfile(profile);
	validateFramescaperProjectV26(profile, project);
	const clone = structuredClone(project) as FramescaperProjectV26;
	validateFramescaperProjectV26(profile, clone);
	return clone;
}

export function loadFramescaperProjectV26(
	profile: unknown,
	value: unknown,
): LoadedFramescaperProjectV26 {
	assertFramescaperProjectV26CandidateProfile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion < 26) throw new FramescaperProjectV26ReimportRequiredError(schemaVersion);
	if (schemaVersion > 26) return {
		project: snapshotFramescaperOpaqueProject(value),
		readOnly: true,
		intrinsicReadOnly: true,
		reason: 'newer-schema',
	};
	return {
		project: cloneFramescaperProjectV26(profile, value),
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	};
}
