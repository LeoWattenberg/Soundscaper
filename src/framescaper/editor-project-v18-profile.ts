/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v18.ts';

/** Authenticate the one process-local Framescaper V18 authority without inspecting impostors. */
export function assertFramescaperProjectV18Profile(
	profile: unknown,
): asserts profile is EditorProjectRuntimeProfile {
	if (profile !== FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper V18 runtime profile is required.');
	}
	editorProjectRuntimeProfileDefinition(profile);
}
