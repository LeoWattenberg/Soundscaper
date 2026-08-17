/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import { SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v23.ts';

/** Authenticate the process-local Soundscaper V23 runtime authority. */
export function assertSoundscaperProjectV23Profile(
	profile: unknown,
): asserts profile is EditorProjectRuntimeProfile {
	if (profile !== SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Soundscaper V23 runtime profile is required.');
	}
	editorProjectRuntimeProfileDefinition(profile);
}
