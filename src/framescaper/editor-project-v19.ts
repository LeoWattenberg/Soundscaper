/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	normalizeVideoClipComposition,
	DEFAULT_VIDEO_CLIP_COMPOSITION,
} from '../common/editor/video-clip-composition.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV19,
} from './editor-project-feature-requirements-v19.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';
import {
	cloneFramescaperProjectV18,
	createFramescaperProjectV18,
	readFramescaperProjectSchemaVersion,
	snapshotFramescaperOpaqueProject,
	type FramescaperProjectV18Options,
} from './editor-project-v18.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';
import {
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	framescaperProjectV18FoundationV19,
	validateFramescaperProjectV19,
	type FramescaperProjectV19,
} from './editor-project-v19-validation.ts';

export {
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	validateFramescaperProjectV19,
	type FramescaperProjectV19,
} from './editor-project-v19-validation.ts';

export type FramescaperProjectV19Options = FramescaperProjectV18Options;

export interface LoadedFramescaperProjectV19 {
	readonly project: FramescaperProjectV19 | Readonly<Record<string, unknown>>;
	readonly readOnly: boolean;
	readonly intrinsicReadOnly: boolean;
	readonly reason: 'proxy-attached' | 'newer-schema' | null;
}

/** Create an exact V19 project from the unchanged V18 media foundation. */
export function createFramescaperProjectV19(
	profile: EditorProjectRuntimeProfile | unknown,
	options: FramescaperProjectV19Options = {},
): FramescaperProjectV19 {
	assertFramescaperProjectV19Profile(profile);
	const foundation = createFramescaperProjectV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		options,
	) as unknown as Record<string, unknown>;
	foundation.schemaVersion = FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION;
	normalizeFramescaperProjectClipCompositionsV19(foundation);
	foundation.featureRequirements = reconcileFramescaperProjectFeatureRequirementsV19(profile, foundation);
	validateFramescaperProjectV19(profile, foundation);
	return foundation as FramescaperProjectV19;
}

/** Validate and detach an exact V19 document, including nested composition values. */
export function cloneFramescaperProjectV19(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV19 | unknown,
): FramescaperProjectV19 {
	assertFramescaperProjectV19Profile(profile);
	validateFramescaperProjectV19(profile, project);
	const canonical = project as FramescaperProjectV19;
	const foundation = framescaperProjectV18FoundationV19(profile, canonical, {
		retainComposition: true,
	});
	const clone = cloneFramescaperProjectV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		foundation,
	) as unknown as Record<string, unknown>;
	clone.schemaVersion = FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION;
	clone.featureRequirements = structuredClone(canonical.featureRequirements);
	normalizeFramescaperProjectClipCompositionsV19(clone);
	validateFramescaperProjectV19(profile, clone);
	return clone as FramescaperProjectV19;
}

/** Load exact V19 or preserve a descriptor-snapshotted future document opaquely. */
export function loadFramescaperProjectV19(
	profile: EditorProjectRuntimeProfile | unknown,
	value: unknown,
): LoadedFramescaperProjectV19 {
	assertFramescaperProjectV19Profile(profile);
	const schemaVersion = readFramescaperProjectSchemaVersion(value);
	if (schemaVersion > FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION) {
		return {
			project: snapshotFramescaperOpaqueProject(value),
			readOnly: true,
			intrinsicReadOnly: true,
			reason: 'newer-schema',
		};
	}
	validateFramescaperProjectV19(profile, value);
	const project = cloneFramescaperProjectV19(profile, value);
	const attached = framescaperProjectV19HasProxyAttachment(project);
	return {
		project,
		readOnly: attached,
		intrinsicReadOnly: attached,
		reason: attached ? 'proxy-attached' : null,
	};
}

export function framescaperProjectV19HasProxyAttachment(project: FramescaperProjectV19): boolean {
	return project.sources.some((source) => (
		source.kind === 'video' && source.proxyAttachment !== null
	));
}

/** Restore the mandatory V19 occurrence field after a generic V18 command projection. */
export function normalizeFramescaperProjectClipCompositionsV19(
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
