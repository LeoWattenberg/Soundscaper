/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAssistanceAssetReferencesV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import { FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV31,
} from './editor-project-feature-requirements-v31.ts';
import { readFramescaperProjectSchemaVersion, snapshotFramescaperOpaqueProject } from './editor-project-v18.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import {
	cloneFramescaperProjectV30,
	createFramescaperProjectV30,
	reimportFramescaperProjectV30,
	type FramescaperProjectV30,
	type FramescaperProjectV30Options,
} from './editor-project-v30.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v30.ts';
import {
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31-validation.ts';

export {
	FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION,
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31-validation.ts';

export type FramescaperProjectV31Options = FramescaperProjectV30Options & Readonly<{
	readonly assistanceAssets?: readonly unknown[];
}>;

export interface LoadedFramescaperProjectV31 {
	readonly project: FramescaperProjectV31 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'known-dormant-custody' | 'newer-schema' | null;
}

export class FramescaperProjectV31ReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;

	constructor(readonly schemaVersion: number) {
		super(schemaVersion === 28 || schemaVersion === 30
			? `Framescaper V${String(schemaVersion)} requires explicit reimport into F31.`
			: `Framescaper schema ${String(schemaVersion)} is not an admitted F31 reimport source.`);
		this.name = 'FramescaperProjectV31ReimportRequiredError';
	}
}

const OPAQUE_CUSTODY_SCHEMA_VERSIONS: readonly number[] = Object.freeze([
	22, 23, 24, 25, 26, 29, 30,
]);

export function createFramescaperProjectV31(
	profile: unknown,
	options: FramescaperProjectV31Options = {},
): FramescaperProjectV31 {
	assertFramescaperProjectV31Profile(profile);
	const { assistanceAssets: assetValues = [], ...v30Options } = options;
	const foundation = createFramescaperProjectV30(
		FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE,
		v30Options,
	) as unknown as Record<string, unknown>;
	foundation.schemaVersion = FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION;
	foundation.assistanceAssets = normalizeAssistanceAssetReferencesV1(assetValues);
	return reconcile(profile, foundation);
}

export function cloneFramescaperProjectV31(
	profile: unknown,
	project: unknown,
): FramescaperProjectV31 {
	validateFramescaperProjectV31(profile, project);
	const draft = structuredClone(project) as Record<string, unknown>;
	draft.assistanceAssets = normalizeAssistanceAssetReferencesV1(draft.assistanceAssets);
	return reconcile(profile, draft);
}

/** Load exact F31, retain historical/unowned/future custody, and require explicit reimport. */
export function loadFramescaperProjectV31(
	profile: unknown,
	value: unknown,
): LoadedFramescaperProjectV31 {
	assertFramescaperProjectV31Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (OPAQUE_CUSTODY_SCHEMA_VERSIONS.includes(schemaVersion)) return Object.freeze({
		project: snapshotFramescaperOpaqueProject(value),
		readOnly: true,
		intrinsicReadOnly: true,
		reason: 'known-dormant-custody' as const,
	});
	if (schemaVersion > FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION) return Object.freeze({
		project: snapshotFramescaperOpaqueProject(value),
		readOnly: true,
		intrinsicReadOnly: true,
		reason: 'newer-schema' as const,
	});
	if (schemaVersion !== FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION) {
		throw new FramescaperProjectV31ReimportRequiredError(schemaVersion);
	}
	return Object.freeze({
		project: cloneFramescaperProjectV31(profile, value),
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	});
}

/** Admit exact V28 or V30 authority into writable F31 without dropping timeline images. */
export function reimportFramescaperProjectV31(
	profile: unknown,
	value: unknown,
): FramescaperProjectV31 {
	assertFramescaperProjectV31Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion !== 28 && schemaVersion !== 30) {
		throw new FramescaperProjectV31ReimportRequiredError(schemaVersion);
	}
	const foundation = schemaVersion === 30
		? cloneFramescaperProjectV30(FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE, value)
		: reimportFramescaperProjectV30(FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE, value);
	return upgradeV30(profile, foundation);
}

function upgradeV30(profile: unknown, foundation: FramescaperProjectV30): FramescaperProjectV31 {
	const project = structuredClone(foundation) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION;
	project.assistanceAssets = normalizeAssistanceAssetReferencesV1([]);
	return reconcile(profile, project);
}

function reconcile(profile: unknown, draft: Record<string, unknown>): FramescaperProjectV31 {
	draft.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV31(profile, draft);
	validateFramescaperProjectV31(profile, draft);
	return draft as unknown as FramescaperProjectV31;
}
