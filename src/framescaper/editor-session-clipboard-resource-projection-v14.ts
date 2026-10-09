/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAudioEditorClipboardDescriptor } from '../common/editor/commands/clipboard-codec.ts';
import type { AudioEditorClipboard } from '../common/editor/commands/protocol.ts';
import { normalizeAudioEditorClipboardDescriptorV7 } from '../common/editor/commands/clipboard-codec-v7.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1 } from '../common/editor/video-cube-lut-profile-v1.ts';
import { collectCubeLutProfileProjectReferencesV1 } from '../common/editor/video-cube-lut-project-references-v1.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { validateFramescaperProject, type FramescaperProject } from './editor-project.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';

/** A transient resource-free metadata projection, only AFTER full current
 * admission. It is never a second persisted recipe or a body proof. */
export function framescaperClipboardDescriptorMetadataProjectionV14(value: unknown): AudioEditorClipboard {
	const descriptor = normalizeAudioEditorClipboardDescriptorV7(value);
	return normalizeAudioEditorClipboardDescriptor({ ...descriptor, schemaVersion: 6,
		tracks: descriptor.tracks.map(track => ({ ...track, clips: track.clips.map(withoutCube) })) });
}

/** Existing V13 image/finishing/OpenFX metadata owners see only effects they
 * already admit; the V14 carrier independently retains the complete recipe. */
export function framescaperClipboardProjectMetadataProjectionV14(profile: unknown, value: unknown): FramescaperProjectTimelineImage {
	validateFramescaperProject(profile, value);
	collectCubeLutProfileProjectReferencesV1(value);
	const project = value as FramescaperProject;
	return framescaperProjectTimelineImageFoundationShapeAssistance({ ...project,
		clips: project.clips.map(withoutCube),
		projectBin: { ...project.projectBin, clips: project.projectBin.clips.map(withoutCube) } });
}

function withoutCube<Clip extends Readonly<Record<string, unknown>>>(clip: Clip): Clip {
	if (clip.videoEffects === undefined) return clip;
	const effects = clip.videoEffects as readonly Readonly<Record<string, unknown>>[];
	return { ...clip, videoEffects: effects.filter(effect => effect.type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) };
}
