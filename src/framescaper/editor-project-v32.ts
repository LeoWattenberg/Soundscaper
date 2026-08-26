/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFramescaperProjectSchemaVersion, snapshotFramescaperOpaqueProject } from './editor-project-v18.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import {
	cloneFramescaperProjectV28,
	createFramescaperProjectV28,
	type FramescaperProjectV28,
	type FramescaperProjectV28Options,
} from './editor-project-v28.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV32,
} from './editor-project-feature-requirements-v32.ts';
import { FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts';
import { assertFramescaperProjectV32Profile } from './editor-project-runtime-profile-v32.ts';
import {
	FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION,
	validateFramescaperProjectV32,
	type FramescaperProjectV32,
} from './editor-project-v32-validation.ts';

export {
	FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION,
	validateFramescaperProjectV32,
	type FramescaperProjectV32,
} from './editor-project-v32-validation.ts';

export type FramescaperProjectV32Options = FramescaperProjectV28Options;

export interface LoadedFramescaperProjectV32 {
	readonly project: FramescaperProjectV32 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'known-dormant-custody' | 'newer-schema' | null;
}

export class FramescaperProjectV32ReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	constructor(readonly schemaVersion: number) {
		super(schemaVersion === 28
			? 'Framescaper V28 requires explicit reimport into V32.'
			: `Framescaper schema ${String(schemaVersion)} is not an admitted V32 reimport source.`);
		this.name = 'FramescaperProjectV32ReimportRequiredError';
	}
}

export function createFramescaperProjectV32(
	profile: unknown,
	options: FramescaperProjectV32Options = {},
): FramescaperProjectV32 {
	assertFramescaperProjectV32Profile(profile);
	const foundation = createFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		options,
	);
	return upgradeV28(profile, foundation);
}

export function cloneFramescaperProjectV32(profile: unknown, project: unknown): FramescaperProjectV32 {
	assertFramescaperProjectV32Profile(profile);
	validateFramescaperProjectV32(profile, project);
	const clone = structuredClone(project) as FramescaperProjectV32;
	validateFramescaperProjectV32(profile, clone);
	return clone;
}

export function loadFramescaperProjectV32(profile: unknown, value: unknown): LoadedFramescaperProjectV32 {
	assertFramescaperProjectV32Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion === 25 || schemaVersion === 26) return Object.freeze({
		project: snapshotFramescaperOpaqueProject(value), readOnly: true,
		intrinsicReadOnly: true, reason: 'known-dormant-custody' as const,
	});
	// F31 supersedes V32 even though it carries the lower number: 30 was already the
	// Soundscaper assistance generation, so the image generation could not be numbered
	// below capture. Generation order, not the integer, decides what V32 holds opaquely.
	if (schemaVersion === FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION
		|| schemaVersion > FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION) return Object.freeze({
		project: snapshotFramescaperOpaqueProject(value), readOnly: true,
		intrinsicReadOnly: true, reason: 'newer-schema' as const,
	});
	if (schemaVersion !== FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION) {
		throw new FramescaperProjectV32ReimportRequiredError(schemaVersion);
	}
	return Object.freeze({
		project: cloneFramescaperProjectV32(profile, value), readOnly: false,
		intrinsicReadOnly: false, reason: null,
	});
}

/** The only route that turns validated selected V28 state into writable V32 authority. */
export function reimportFramescaperProjectV32(profile: unknown, value: unknown): FramescaperProjectV32 {
	assertFramescaperProjectV32Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion === 25 || schemaVersion === 26) {
		throw new RangeError(`Dormant Framescaper V${String(schemaVersion)} remains opaque read-only custody.`);
	}
	if (schemaVersion !== 28) throw new FramescaperProjectV32ReimportRequiredError(schemaVersion);
	return upgradeV28(
		profile,
		cloneFramescaperProjectV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, value),
	);
}

function upgradeV28(profile: unknown, foundation: FramescaperProjectV28): FramescaperProjectV32 {
	const project = structuredClone(foundation) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_V32_SCHEMA_VERSION;
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV32(profile, project);
	validateFramescaperProjectV32(profile, project);
	return project as unknown as FramescaperProjectV32;
}
