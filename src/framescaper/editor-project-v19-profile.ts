/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v19.ts';

/** Authenticate the one process-local Framescaper V19 authority before traversal. */
export function assertFramescaperProjectV19Profile(
	profile: unknown,
): asserts profile is EditorProjectRuntimeProfile {
	if (profile !== FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper V19 runtime profile is required.');
	}
	editorProjectRuntimeProfileDefinition(profile);
}
