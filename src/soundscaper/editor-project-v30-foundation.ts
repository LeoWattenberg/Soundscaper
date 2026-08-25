/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAssistanceAssetReferencesV1,
	type AssistanceAssetReferenceV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import {
	SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION,
} from '../common/editor/project-schema-version.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts';
import {
	reconcileSoundscaperProjectFeatureRequirementsV29,
} from './editor-project-feature-requirements-v29.ts';
import {
	reconcileSoundscaperProjectFeatureRequirementsV30,
} from './editor-project-feature-requirements-v30.ts';
import {
	cloneSoundscaperProjectV29,
	type SoundscaperProjectV29,
} from './editor-project-v29.ts';
import {
	validateSoundscaperProjectV30,
	type SoundscaperProjectV30,
} from './editor-project-v30-validation.ts';

export interface BorrowedSoundscaperProjectV29FromV30 {
	readonly project: SoundscaperProjectV29;
	readonly assistanceAssets: readonly Readonly<AssistanceAssetReferenceV1>[];
}

/** Lend inherited V29 owners an exact document while retaining V30's sole added field. */
export function borrowSoundscaperProjectV29FromV30(
	projectValue: SoundscaperProjectV30 | unknown,
): Readonly<BorrowedSoundscaperProjectV29FromV30> {
	validateSoundscaperProjectV30(projectValue);
	const draft = structuredClone(projectValue) as Record<string, unknown>;
	const assistanceAssets = normalizeAssistanceAssetReferencesV1(draft.assistanceAssets);
	delete draft.assistanceAssets;
	draft.schemaVersion = SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION;
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV29(
		draft,
		draft.featureRequirements as never,
	);
	return Object.freeze({
		project: cloneSoundscaperProjectV29(draft),
		assistanceAssets,
	});
}

/** Restore inherited V29 output to exact V30 without interpreting assistance references. */
export function restoreSoundscaperProjectV30FromV29(
	projectValue: SoundscaperProjectV29 | unknown,
	assistanceAssetsValue: readonly Readonly<AssistanceAssetReferenceV1>[] | unknown,
): SoundscaperProjectV30 {
	const draft = structuredClone(cloneSoundscaperProjectV29(projectValue)) as Record<string, unknown>;
	draft.schemaVersion = SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION;
	draft.assistanceAssets = normalizeAssistanceAssetReferencesV1(assistanceAssetsValue);
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	draft.featureRequirements = reconcileSoundscaperProjectFeatureRequirementsV30(
		draft,
		draft.featureRequirements as never,
	);
	validateSoundscaperProjectV30(draft);
	return draft as unknown as SoundscaperProjectV30;
}
