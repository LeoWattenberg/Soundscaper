/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeAssistanceAssetReferencesV1,
} from '../common/editor/assistance/assistance-asset-reference-v1.ts';
import { snapshotInertJsonValue } from '../common/editor/inert-json-snapshot.ts';
import {
	SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION,
} from '../common/editor/project-schema-version.ts';
import { reconcileProjectOwnedFeatureRequirements } from '../common/editor/project-owned-feature-requirements.ts';
import {
	reconcileSoundscaperProjectFeatureRequirementsV30,
} from './editor-project-feature-requirements-v30.ts';
import {
	cloneSoundscaperProjectV29,
	createSoundscaperProjectV29,
	type SoundscaperProjectV29Options,
} from './editor-project-v29.ts';
import {
	validateSoundscaperProjectV30,
	type SoundscaperProjectV30,
} from './editor-project-v30-validation.ts';

export {
	SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION,
	validateSoundscaperProjectV30,
	type SoundscaperProjectV30,
} from './editor-project-v30-validation.ts';

export interface SoundscaperProjectV30Options extends SoundscaperProjectV29Options {
	readonly assistanceAssets?: readonly unknown[];
}

export interface LoadedSoundscaperProjectV30 {
	readonly project: SoundscaperProjectV30 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'newer-schema' | null;
}

export class SoundscaperProjectV30ReimportRequiredError extends RangeError {
	readonly sourceSchemaVersion: number;
	readonly currentSchemaVersion = SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION;

	constructor(sourceSchemaVersion: number) {
		super(`Soundscaper schema V${String(sourceSchemaVersion)} requires re-import into exact V30 authority`);
		this.name = 'SoundscaperProjectV30ReimportRequiredError';
		this.sourceSchemaVersion = sourceSchemaVersion;
	}
}

export function createSoundscaperProjectV30(
	options: SoundscaperProjectV30Options = {},
): SoundscaperProjectV30 {
	const { assistanceAssets: assetValues = [], ...v29Options } = options;
	const foundation = createSoundscaperProjectV29(v29Options) as unknown as Record<string, unknown>;
	foundation.schemaVersion = SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION;
	foundation.assistanceAssets = normalizeAssistanceAssetReferencesV1(assetValues);
	return reconcile(foundation);
}

/** Clone exact V30 through the V29 normalizer, then restore V30's owned field. */
export function cloneSoundscaperProjectV30(project: SoundscaperProjectV30 | unknown): SoundscaperProjectV30 {
	validateSoundscaperProjectV30(project);
	const draft = structuredClone(project) as Record<string, unknown>;
	draft.schemaVersion = SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION;
	const assets = draft.assistanceAssets;
	delete draft.assistanceAssets;
	draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(
		draft,
		draft.featureRequirements as never,
	);
	const inherited = cloneSoundscaperProjectV29(draft) as unknown as Record<string, unknown>;
	inherited.schemaVersion = SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION;
	inherited.assistanceAssets = normalizeAssistanceAssetReferencesV1(assets);
	return reconcile(inherited);
}

/** Load exact V30, upgrade only exact V29, and retain future state opaquely. */
export function loadSoundscaperProjectV30(value: unknown): LoadedSoundscaperProjectV30 {
	const version = schemaVersion(value);
	if (version === SOUNDSCAPER_PROJECT_V29_SCHEMA_VERSION) {
		return Object.freeze({
			project: upgradeSoundscaperProjectV29ToV30(value),
			readOnly: false,
			intrinsicReadOnly: false,
			reason: null,
		});
	}
	if (version < SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION) {
		throw new SoundscaperProjectV30ReimportRequiredError(version);
	}
	if (version > SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION) {
		const snapshot = snapshotInertJsonValue(value, 'future Soundscaper project', {
			maximumArrayLength: 100_000,
			maximumNodes: 2_000_000,
		});
		return Object.freeze({
			project: structuredClone(snapshot) as Readonly<Record<string, unknown>>,
			readOnly: true,
			intrinsicReadOnly: true,
			reason: 'newer-schema',
		});
	}
	return Object.freeze({
		project: cloneSoundscaperProjectV30(value),
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	});
}

/** Promote only validated exact V29, adding no invented assistance results. */
export function upgradeSoundscaperProjectV29ToV30(value: unknown): SoundscaperProjectV30 {
	const draft = cloneSoundscaperProjectV29(value) as unknown as Record<string, unknown>;
	draft.schemaVersion = SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION;
	draft.assistanceAssets = normalizeAssistanceAssetReferencesV1([]);
	return reconcile(draft);
}

function reconcile(draft: Record<string, unknown>): SoundscaperProjectV30 {
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

function schemaVersion(value: unknown): number {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('saved Soundscaper project must be an object');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
		|| !Number.isSafeInteger(descriptor.value)) {
		throw new RangeError('Saved Soundscaper project schemaVersion must be an own safe integer');
	}
	return Number(descriptor.value);
}
