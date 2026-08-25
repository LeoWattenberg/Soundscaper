/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAssistanceAssetReferencesV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import { FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION } from '../common/editor/project-schema-version.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV31,
} from './editor-project-feature-requirements-v31.ts';
import { readFramescaperProjectSchemaVersion, snapshotFramescaperOpaqueProject } from './editor-project-v18.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import {
	cloneFramescaperProjectV28,
	createFramescaperProjectV28,
	type FramescaperProjectV28,
	type FramescaperProjectV28Options,
} from './editor-project-v28.ts';
import {
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31-validation.ts';

export {
	FRAMESCAPER_PROJECT_V31_SCHEMA_VERSION,
	validateFramescaperProjectV31,
	type FramescaperProjectV31,
} from './editor-project-v31-validation.ts';

export type FramescaperProjectV31Options = FramescaperProjectV28Options & Readonly<{
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
		super(schemaVersion === 28
			? 'Framescaper V28 requires explicit reimport into F31.'
			: `Framescaper schema ${String(schemaVersion)} is not an admitted F31 reimport source.`);
		this.name = 'FramescaperProjectV31ReimportRequiredError';
	}
}

export function createFramescaperProjectV31(
	profile: unknown,
	options: FramescaperProjectV31Options = {},
): FramescaperProjectV31 {
	assertFramescaperProjectV31Profile(profile);
	const { assistanceAssets: assetValues = [], ...v28Options } = options;
	const foundation = createFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		v28Options,
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

/** Load exact F31, retain dormant/future custody, and require explicit V28 reimport. */
export function loadFramescaperProjectV31(
	profile: unknown,
	value: unknown,
): LoadedFramescaperProjectV31 {
	assertFramescaperProjectV31Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion === 25 || schemaVersion === 26) return Object.freeze({
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

/** The sole route from exact selected V28 authority into writable F31. */
export function reimportFramescaperProjectV31(
	profile: unknown,
	value: unknown,
): FramescaperProjectV31 {
	assertFramescaperProjectV31Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion !== 28) throw new FramescaperProjectV31ReimportRequiredError(schemaVersion);
	const foundation = cloneFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		value,
	);
	return upgradeV28(profile, foundation);
}

function upgradeV28(profile: unknown, foundation: FramescaperProjectV28): FramescaperProjectV31 {
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
