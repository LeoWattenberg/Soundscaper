/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	normalizeVideoClipComposition,
	DEFAULT_VIDEO_CLIP_COMPOSITION,
} from '../common/editor/video-clip-composition.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsComposition,
} from './editor-project-feature-requirements-composition.ts';
import { FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectSequence,
	createFramescaperProjectSequence,
	type FramescaperProjectSequenceOptions,
} from './editor-project-sequence.ts';
import { assertFramescaperProjectCompositionProfile } from './editor-domain-runtime-profile.ts';
import {
	FRAMESCAPER_PROJECT_COMPOSITION_SCHEMA_VERSION,
	framescaperProjectSequenceFoundationComposition,
	validateFramescaperProjectComposition,
	type FramescaperProjectComposition,
} from './editor-project-composition-validation.ts';

export {
	FRAMESCAPER_PROJECT_COMPOSITION_SCHEMA_VERSION,
	validateFramescaperProjectComposition,
	type FramescaperProjectComposition,
} from './editor-project-composition-validation.ts';

export type FramescaperProjectCompositionOptions = FramescaperProjectSequenceOptions;

/** Create an exact composition project from the unchanged sequence media foundation. */
export function createFramescaperProjectComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	options: FramescaperProjectCompositionOptions = {},
): FramescaperProjectComposition {
	assertFramescaperProjectCompositionProfile(profile);
	const foundation = createFramescaperProjectSequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
		options,
	) as unknown as Record<string, unknown>;
	foundation.schemaVersion = FRAMESCAPER_PROJECT_COMPOSITION_SCHEMA_VERSION;
	normalizeFramescaperProjectClipCompositionsComposition(foundation);
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsComposition(profile, foundation);
	validateFramescaperProjectComposition(profile, foundation);
	return foundation as FramescaperProjectComposition;
}

/** Validate and detach an exact composition document, including nested composition values. */
export function cloneFramescaperProjectComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectComposition | unknown,
): FramescaperProjectComposition {
	assertFramescaperProjectCompositionProfile(profile);
	validateFramescaperProjectComposition(profile, project);
	const canonical = project as FramescaperProjectComposition;
	const foundation = framescaperProjectSequenceFoundationComposition(profile, canonical, {
		retainComposition: true,
	});
	const clone = cloneFramescaperProjectSequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
		foundation,
	) as unknown as Record<string, unknown>;
	clone.schemaVersion = FRAMESCAPER_PROJECT_COMPOSITION_SCHEMA_VERSION;
	clone.featureRequirements = structuredClone(canonical.featureRequirements);
	normalizeFramescaperProjectClipCompositionsComposition(clone);
	validateFramescaperProjectComposition(profile, clone);
	return clone as FramescaperProjectComposition;
}

export function framescaperProjectCompositionHasProxyAttachment(project: FramescaperProjectComposition): boolean {
	return project.sources.some((source) => (
		source.kind === 'video' && source.proxyAttachment !== null
	));
}

/** Restore the mandatory composition occurrence field after a generic sequence command projection. */
export function normalizeFramescaperProjectClipCompositionsComposition(
	project: Record<string, unknown>,
): void {
	normalizeClipArray(project.clips, 'Framescaper project.clips');
	const projectBin = dataRecord(project.projectBin, 'Framescaper project.projectBin');
	normalizeClipArray(projectBin.clips, 'Framescaper project.projectBin.clips');
}

function normalizeClipArray(value: unknown, name: string): void {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	for (const [index, item] of value.entries()) {
		const clip = dataRecord(item, `${name}[${String(index)}]`);
		if (clip.kind === 'video') {
			clip.videoComposition = normalizeVideoClipComposition(
				clip.videoComposition ?? DEFAULT_VIDEO_CLIP_COMPOSITION,
				`${name}[${String(index)}].videoComposition`,
			);
		} else if (clip.kind === 'audio') {
			delete clip.videoComposition;
		}
	}
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}
