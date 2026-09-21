/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeManifest } from '../common/editor/scape-archive-envelope.ts';
import type { PlannedScapeExportAsset } from '../common/editor/scape-export-plan.ts';
import type { VideoCubeLutReferenceV1 } from '../common/editor/video-color-management-v27.ts';
import type {
	VideoMotionAnalysisReferenceV1,
	VideoProcessorStackV1,
} from '../common/editor/video-motion-model-v27.ts';
import type { FramescaperProject } from './editor-project.ts';
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

export const FRAMESCAPER_SCAPE_ASSET_KINDS = FRAMESCAPER_DURABLE_SCAPE_ASSET_KINDS;
export type FramescaperScapeAssetKind = FramescaperDurableScapeAssetKind;

export interface FramescaperScapeAssetReference extends FramescaperDurableScapeAssetReference {
	readonly kind: FramescaperScapeAssetKind;
}

export interface FramescaperScapeImportValidation extends FramescaperDurableScapeImportValidation {
	readonly references: readonly FramescaperScapeAssetReference[];
}

export async function planFramescaperScapeExportAssets(
	project: FramescaperProject,
	store: FramescaperDurableScapeMetadataStore,
	signal?: AbortSignal,
): Promise<readonly PlannedScapeExportAsset[]> {
	return planFramescaperDurableScapeExportAssets(
		collectFramescaperScapeAssetReferences(project), store, 'Framescaper', signal,
	);
}

export function validateFramescaperScapeImportAssets(
	project: FramescaperProject,
	manifest: ScapeManifest,
): Readonly<FramescaperScapeImportValidation> {
	return validateFramescaperDurableScapeImportAssets(
		collectFramescaperScapeAssetReferences(project), manifest, 'Framescaper',
	) as Readonly<FramescaperScapeImportValidation>;
}

export async function validateFramescaperScapeExportAssetBody(
	asset: PlannedScapeExportAsset,
	body: Blob,
	signal?: AbortSignal,
): Promise<void> {
	return validateFramescaperDurableScapeExportAssetBody(asset, body, 'Framescaper', signal);
}

export function validateFramescaperScapeAssetReferenceBytes(
	reference: FramescaperScapeAssetReference,
	bytes: Uint8Array,
): void {
	validateFramescaperDurableScapeAssetReferenceBytes(reference, bytes, 'Framescaper');
}

export function collectFramescaperScapeAssetReferences(
	project: FramescaperProject,
): readonly FramescaperScapeAssetReference[] {
	const freezeFallbacks = project.videoFreezeFallbacks as readonly Readonly<{ renderedSourceId: string }>[];
	const sources = project.sources as readonly Readonly<Record<string, unknown>>[];
	return collectFramescaperDurableScapeAssetReferences({
		sources,
		freezeRenderedSourceIds: new Set(freezeFallbacks.map(({ renderedSourceId }) => renderedSourceId)),
		luts: () => projectLuts(project),
		processorStacks: () => records(project.videoProcessorStacks, 'videoProcessorStacks')
			.map((stack) => stack as unknown as VideoProcessorStackV1),
		motionAnalyses: () => records(project.videoMotionAnalyses, 'videoMotionAnalyses')
			.map((motion) => motion as unknown as VideoMotionAnalysisReferenceV1),
	}, 'Framescaper') as readonly FramescaperScapeAssetReference[];
}

function projectLuts(project: FramescaperProject): readonly VideoCubeLutReferenceV1[] {
	return [
		...records(project.videoVisualPresentations, 'videoVisualPresentations')
			.map((presentation) => recordOrNull(presentation.grade)?.lut ?? null),
		...records(project.videoFinishingPresets, 'videoFinishingPresets')
			.map((preset) => record(preset.template, 'video finishing template').grade)
			.map((grade) => recordOrNull(grade)?.lut ?? null),
	].filter((value): value is VideoCubeLutReferenceV1 => value !== null);
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} is missing.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}
