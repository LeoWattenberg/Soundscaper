/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../common/editor/project-owned-feature-requirements.ts';
import { reconcileFramescaperProjectFeatureRequirementsV28 } from './editor-project-feature-requirements-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import type { FramescaperProjectV27 } from './editor-project-v27.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';

/** Detach V30 and V28 authority before asking an immutable V27 consumer. */
export function framescaperProjectV27FoundationShapeV30(project: unknown): FramescaperProjectV27 {
	return framescaperProjectV27FoundationShapeV28(framescaperProjectV28FoundationShapeV30(project));
}

/** Detach V30 image authority before asking the immutable V28 validator. */
export function framescaperProjectV28FoundationShapeV30(project: unknown): FramescaperProjectV28 {
	const foundation = structuredClone(record(project, 'Framescaper V30 project'));
	const imageClipIds = new Set([
		...records(foundation.clips, 'clips'),
		...records(record(foundation.projectBin, 'projectBin').clips, 'projectBin.clips'),
	].filter(({ kind }) => kind === 'image').map(({ id }) => String(id)));
	foundation.schemaVersion = 28;
	foundation.sources = records(foundation.sources, 'sources').filter(({ kind }) => kind !== 'image');
	foundation.clips = records(foundation.clips, 'clips').filter(({ kind }) => kind !== 'image');
	const bin = record(foundation.projectBin, 'projectBin');
	bin.clips = records(bin.clips, 'projectBin.clips').filter(({ kind }) => kind !== 'image');
	foundation.tracks = records(foundation.tracks, 'tracks').map((track) => ({
		...track,
		clipIds: Array.isArray(track.clipIds)
			? track.clipIds.filter((id) => !imageClipIds.has(String(id)))
			: track.clipIds,
	}));
	const selection = record(foundation.selection, 'selection');
	if (Array.isArray(selection.clipIds)) {
		selection.clipIds = selection.clipIds.filter((id) => !imageClipIds.has(String(id)));
	}
	const manifest = record(foundation.featureRequirements, 'featureRequirements');
	manifest.requirements = records(manifest.requirements, 'featureRequirements.requirements')
		.filter((row) => row.id !== PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.timelineImages
			&& row.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.timelineImages);
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		foundation,
	);
	return foundation as unknown as FramescaperProjectV28;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
