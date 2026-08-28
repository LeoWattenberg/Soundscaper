/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import { SOUNDSCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { cloneSoundscaperProject, type SoundscaperProject } from './editor-project.ts';

export function assertSoundscaperProjectProfile(
	profile: unknown,
): asserts profile is EditorProjectRuntimeProfile {
	if (profile !== SOUNDSCAPER_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Soundscaper baseline runtime profile is required.');
	}
	editorProjectRuntimeProfileDefinition(profile);
}

export function soundscaperProjectClone(
	profile: unknown,
	project: unknown,
): SoundscaperProject {
	assertSoundscaperProjectProfile(profile);
	return cloneSoundscaperProject(project);
}
