/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../common/editor/project-feature-capabilities.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../common/editor/project-owned-feature-requirements.ts';
import { reconcileFramescaperProjectFeatureRequirementsNativeMedia } from './editor-project-feature-requirements-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';
import type { FramescaperProjectNativeMedia } from './editor-project-native-media.ts';

/** Detach timelineImage and nativeMedia authority before asking an immutable finishing consumer. */
export function framescaperProjectFinishingFoundationShapeTimelineImage(project: unknown): FramescaperProjectFinishing {
	return framescaperProjectFinishingFoundationShapeNativeMedia(framescaperProjectNativeMediaFoundationShapeTimelineImage(project));
}

/** Detach timelineImage image authority before asking the immutable nativeMedia validator. */
export function framescaperProjectNativeMediaFoundationShapeTimelineImage(project: unknown): FramescaperProjectNativeMedia {
	const foundation = structuredClone(record(project, 'Framescaper timelineImage project'));
	const imageClipIds = new Set([
		...records(foundation.clips, 'clips'),
		...records(record(foundation.projectBin, 'projectBin').clips, 'projectBin.clips'),
	].filter(({ kind }) => kind === 'image').map(({ id }) => String(id)));
	foundation.schemaVersion =  1;
	foundation.sources = records(foundation.sources, 'sources').filter(({ kind }) => kind !== 'image');
	foundation.clips = records(foundation.clips, 'clips').filter(({ kind }) => kind !== 'image');
	const bin = record(foundation.projectBin, 'projectBin');
	bin.clips = records(bin.clips, 'projectBin.clips').filter(({ kind }) => kind !== 'image');
	foundation.tracks = records(foundation.tracks, 'tracks').map((track) => (
		Array.isArray(track.clipIds)
			? { ...track, clipIds: track.clipIds.filter((id) => !imageClipIds.has(String(id))) }
			: track
	));
	const selection = record(foundation.selection, 'selection');
	if (Array.isArray(selection.clipIds)) {
		selection.clipIds = selection.clipIds.filter((id) => !imageClipIds.has(String(id)));
	}
	const manifest = record(foundation.featureRequirements, 'featureRequirements');
	manifest.requirements = records(manifest.requirements, 'featureRequirements.requirements')
		.filter((row) => row.id !== PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.timelineImages
			&& row.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.timelineImages);
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
		foundation,
	);
	return foundation as unknown as FramescaperProjectNativeMedia;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
