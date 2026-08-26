/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import { SOUNDSCAPER_V30_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v30.ts';

/** Authenticate the process-local exact V30 runtime authority. */
export function assertSoundscaperProjectV30Profile(
	profile: unknown,
): asserts profile is EditorProjectRuntimeProfile {
	if (profile !== SOUNDSCAPER_V30_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Soundscaper V30 runtime profile is required.');
	}
	editorProjectRuntimeProfileDefinition(profile);
}
