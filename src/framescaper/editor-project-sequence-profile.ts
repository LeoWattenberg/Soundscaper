/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import { FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';

/** Authenticate the one process-local Framescaper sequence authority without inspecting impostors. */
export function assertFramescaperProjectSequenceProfile(
	profile: unknown,
): asserts profile is EditorProjectRuntimeProfile {
	if (profile !== FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE) {
		throw new TypeError('The exact Framescaper sequence runtime profile is required.');
	}
	editorProjectRuntimeProfileDefinition(profile);
}
