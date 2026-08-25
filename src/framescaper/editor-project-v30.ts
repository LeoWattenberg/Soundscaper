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
	reconcileFramescaperProjectFeatureRequirementsV30,
} from './editor-project-feature-requirements-v30.ts';
import { assertFramescaperProjectV30Profile } from './editor-project-runtime-profile-v30.ts';
import {
	FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION,
	validateFramescaperProjectV30,
	type FramescaperProjectV30,
} from './editor-project-v30-validation.ts';

export {
	FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION,
	validateFramescaperProjectV30,
	type FramescaperProjectV30,
} from './editor-project-v30-validation.ts';

export type FramescaperProjectV30Options = FramescaperProjectV28Options;

export interface LoadedFramescaperProjectV30 {
	readonly project: FramescaperProjectV30 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'known-dormant-custody' | 'newer-schema' | null;
}

export class FramescaperProjectV30ReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	constructor(readonly schemaVersion: number) {
		super(schemaVersion === 28
			? 'Framescaper V28 requires explicit reimport into V30.'
			: `Framescaper schema ${String(schemaVersion)} is not an admitted V30 reimport source.`);
		this.name = 'FramescaperProjectV30ReimportRequiredError';
	}
}

export function createFramescaperProjectV30(
	profile: unknown,
	options: FramescaperProjectV30Options = {},
): FramescaperProjectV30 {
	assertFramescaperProjectV30Profile(profile);
	const foundation = createFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		options,
	);
	return upgradeV28(profile, foundation);
}

export function cloneFramescaperProjectV30(profile: unknown, project: unknown): FramescaperProjectV30 {
	assertFramescaperProjectV30Profile(profile);
	validateFramescaperProjectV30(profile, project);
	const clone = structuredClone(project) as FramescaperProjectV30;
	validateFramescaperProjectV30(profile, clone);
	return clone;
}

export function loadFramescaperProjectV30(profile: unknown, value: unknown): LoadedFramescaperProjectV30 {
	assertFramescaperProjectV30Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion === 25 || schemaVersion === 26) return Object.freeze({
		project: snapshotFramescaperOpaqueProject(value), readOnly: true,
		intrinsicReadOnly: true, reason: 'known-dormant-custody' as const,
	});
	if (schemaVersion > FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION) return Object.freeze({
		project: snapshotFramescaperOpaqueProject(value), readOnly: true,
		intrinsicReadOnly: true, reason: 'newer-schema' as const,
	});
	if (schemaVersion !== FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION) {
		throw new FramescaperProjectV30ReimportRequiredError(schemaVersion);
	}
	return Object.freeze({
		project: cloneFramescaperProjectV30(profile, value), readOnly: false,
		intrinsicReadOnly: false, reason: null,
	});
}

/** The only route that turns validated selected V28 state into writable V30 authority. */
export function reimportFramescaperProjectV30(profile: unknown, value: unknown): FramescaperProjectV30 {
	assertFramescaperProjectV30Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion === 25 || schemaVersion === 26) {
		throw new RangeError(`Dormant Framescaper V${String(schemaVersion)} remains opaque read-only custody.`);
	}
	if (schemaVersion !== 28) throw new FramescaperProjectV30ReimportRequiredError(schemaVersion);
	return upgradeV28(
		profile,
		cloneFramescaperProjectV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, value),
	);
}

function upgradeV28(profile: unknown, foundation: FramescaperProjectV28): FramescaperProjectV30 {
	const project = structuredClone(foundation) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_V30_SCHEMA_VERSION;
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV30(profile, project);
	validateFramescaperProjectV30(profile, project);
	return project as unknown as FramescaperProjectV30;
}
