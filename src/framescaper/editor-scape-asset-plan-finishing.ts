/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeManifest } from '../common/editor/scape-archive-envelope.ts';
import type { PlannedScapeExportAsset } from '../common/editor/scape-export-plan.ts';
import type { VideoCubeLutReferenceV1 } from '../common/editor/video-color-management-v27.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import {
	collectFramescaperDurableScapeAssetReferences,
	FRAMESCAPER_DURABLE_SCAPE_ASSET_KINDS,
	planFramescaperDurableScapeExportAssets,
	type FramescaperDurableScapeAssetKind,
	type FramescaperDurableScapeAssetReference,
	type FramescaperDurableScapeImportValidation,
	type FramescaperDurableScapeMetadataStore,
	validateFramescaperDurableScapeAssetReferenceBytes,
	validateFramescaperDurableScapeExportAssetBody,
	validateFramescaperDurableScapeImportAssets,
} from './editor-scape-durable-asset-plan-core.ts';

export const FRAMESCAPER_SCAPE_ASSET_KINDS_FINISHING = FRAMESCAPER_DURABLE_SCAPE_ASSET_KINDS;
export type FramescaperScapeAssetKindFinishing = FramescaperDurableScapeAssetKind;

export interface FramescaperScapeAssetReferenceFinishing extends FramescaperDurableScapeAssetReference {
	readonly kind: FramescaperScapeAssetKindFinishing;
}

export interface FramescaperScapeImportValidationFinishing extends FramescaperDurableScapeImportValidation {
	readonly references: readonly FramescaperScapeAssetReferenceFinishing[];
}

export async function planFramescaperScapeExportAssetsFinishing(
	project: FramescaperProjectFinishing,
	store: FramescaperDurableScapeMetadataStore,
	signal?: AbortSignal,
): Promise<readonly PlannedScapeExportAsset[]> {
	return planFramescaperDurableScapeExportAssets(
		collectFramescaperScapeAssetReferencesFinishing(project), store, 'finishing', signal,
	);
}

export function validateFramescaperScapeImportAssetsFinishing(
	project: FramescaperProjectFinishing,
	manifest: ScapeManifest,
): Readonly<FramescaperScapeImportValidationFinishing> {
	return validateFramescaperDurableScapeImportAssets(
		collectFramescaperScapeAssetReferencesFinishing(project), manifest, 'finishing',
	) as Readonly<FramescaperScapeImportValidationFinishing>;
}

export async function validateFramescaperScapeExportAssetBodyFinishing(
	asset: PlannedScapeExportAsset,
	body: Blob,
	signal?: AbortSignal,
): Promise<void> {
	return validateFramescaperDurableScapeExportAssetBody(asset, body, 'finishing', signal);
}

export function validateFramescaperScapeAssetReferenceBytesFinishing(
	reference: FramescaperScapeAssetReferenceFinishing,
	bytes: Uint8Array,
): void {
	validateFramescaperDurableScapeAssetReferenceBytes(reference, bytes, 'finishing');
}

export function collectFramescaperScapeAssetReferencesFinishing(
	project: FramescaperProjectFinishing,
): readonly FramescaperScapeAssetReferenceFinishing[] {
	const freezeFallbacks = project.videoFreezeFallbacks as readonly Readonly<{ renderedSourceId: string }>[];
	return collectFramescaperDurableScapeAssetReferences({
		sources: project.sources as unknown as readonly Readonly<Record<string, unknown>>[],
		freezeRenderedSourceIds: new Set(freezeFallbacks.map(({ renderedSourceId }) => renderedSourceId)),
		luts: () => projectLuts(project),
		processorStacks: () => project.videoProcessorStacks,
		motionAnalyses: () => project.videoMotionAnalyses,
	}, 'finishing') as readonly FramescaperScapeAssetReferenceFinishing[];
}

function projectLuts(project: FramescaperProjectFinishing): readonly VideoCubeLutReferenceV1[] {
	return [
		...project.videoVisualPresentations.map(({ grade }) => grade?.lut ?? null),
		...project.videoFinishingPresets.map(({ template }) => template.grade?.lut ?? null),
	].filter((value): value is VideoCubeLutReferenceV1 => value !== null);
}
