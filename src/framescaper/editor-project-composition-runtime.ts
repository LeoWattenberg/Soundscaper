/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveRuntimeProjectProjection,
	type RuntimeProjectProjection,
} from '../common/editor/runtime-clip-projection.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { cloneVideoClipComposition } from '../common/editor/video-clip-composition.ts';
import {
	framescaperProjectForPlaybackFoundationSequence,
	type FramescaperProjectRuntimeFoundationV17,
} from './editor-project-sequence-runtime.ts';
import { FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectCompositionProfile } from './editor-project-composition-profile.ts';
import {
	framescaperProjectSequenceFoundationComposition,
	validateFramescaperProjectComposition,
	type FramescaperProjectComposition,
} from './editor-project-composition-validation.ts';

/** Resolve composition through sequence nested/multicamera materialization and the V17 engine. */
export function framescaperProjectForRuntimeConsumersComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectComposition | unknown,
): RuntimeProjectProjection<FramescaperProjectRuntimeFoundationV17> {
	return resolveRuntimeProjectProjection(framescaperProjectForPlaybackFoundationComposition(profile, project));
}

/** Preserve renderer-owned composition extensions across the transient foundation. */
export function framescaperProjectForPlaybackFoundationComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	project: FramescaperProjectComposition | unknown,
): FramescaperProjectRuntimeFoundationV17 {
	assertFramescaperProjectCompositionProfile(profile);
	validateFramescaperProjectComposition(profile, project);
	const foundation = framescaperProjectSequenceFoundationComposition(profile, project, {
		retainComposition: true,
	});
	const playback = framescaperProjectForPlaybackFoundationSequence(
		FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE,
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
