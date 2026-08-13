/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveRuntimeProjectProjection,
	type RuntimeProjectProjection,
} from '../common/editor/runtime-clip-projection.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { cloneVideoClipComposition } from '../common/editor/video-clip-composition.ts';
import {
	framescaperProjectForPlaybackFoundationV18,
	type FramescaperProjectRuntimeFoundationV17,
} from './editor-project-v18-runtime.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';
import {
	framescaperProjectV18FoundationV19,
	validateFramescaperProjectV19,
	type FramescaperProjectV19,
} from './editor-project-v19-validation.ts';

/** Resolve V19 through V18 nested/multicamera materialization and the V17 engine. */
export function framescaperProjectForRuntimeConsumersV19(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV19 | unknown,
): RuntimeProjectProjection<FramescaperProjectRuntimeFoundationV17> {
	return resolveRuntimeProjectProjection(framescaperProjectForPlaybackFoundationV19(profile, project));
}

/** Preserve renderer-owned composition extensions across the transient foundation. */
export function framescaperProjectForPlaybackFoundationV19(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectV19 | unknown,
): FramescaperProjectRuntimeFoundationV17 {
	assertFramescaperProjectV19Profile(profile);
	validateFramescaperProjectV19(profile, project);
	const foundation = framescaperProjectV18FoundationV19(profile, project, {
		retainComposition: true,
	});
	const playback = framescaperProjectForPlaybackFoundationV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		foundation,
	);
	return detachPlaybackCompositionOccurrences(playback);
}

/** Nested aliases are distinct rendered occurrences and must not share nested authoring state. */
function detachPlaybackCompositionOccurrences(
	project: FramescaperProjectRuntimeFoundationV17,
): FramescaperProjectRuntimeFoundationV17 {
	const sourceClips = project.clips;
	if (!sourceClips) throw new TypeError('The Framescaper playback foundation requires clips.');
	const clips = sourceClips.map((clip, index) => {
		const value = clip as unknown as Record<string, unknown>;
		const composition = Object.getOwnPropertyDescriptor(value, 'videoComposition');
		if (!composition) return clip;
		if (!composition.enumerable || !Object.hasOwn(composition, 'value')) {
			throw new TypeError(`Playback clip ${String(index)} videoComposition must be a data property.`);
		}
		return {
			...clip,
			videoComposition: cloneVideoClipComposition(
				composition.value,
				`Playback clip ${String(index)} videoComposition`,
			),
		};
	});
	return { ...project, clips } as FramescaperProjectRuntimeFoundationV17;
}
